import { connect } from "node:net";

/**
 * The Wyoming protocol, which is what Home Assistant's voice services speak.
 *
 * It is deliberately tiny: a line of JSON, then optionally that many bytes of more JSON, then
 * optionally that many bytes of audio.
 *
 * ```
 * {"type": "audio-chunk", "data": {"rate": 16000, ...}, "payload_length": 3200}\n
 * <3200 bytes of little-endian signed 16-bit PCM>
 * ```
 *
 * Small enough that a client is a hundred lines, which is why there isn't a dependency here —
 * the one package on npm is a 0.1.0 with a single publish, and this is less code than reading
 * it would be. Plain TCP, no auth, no TLS: it is built for a trusted network, which is the
 * same assumption min-agent already makes about itself.
 *
 * Two conversations matter. Transcription is `transcribe`, then the audio, then the server
 * answers `transcript`. Speech is `synthesize`, then the server answers with audio. Both are
 * "say everything, then read until the end", which is the whole of `ask` below.
 */

export interface WyomingEvent {
  type: string;
  data: Record<string, unknown>;
  /** Raw audio, for the events that carry it. */
  payload?: Buffer;
}

export interface WyomingAddress {
  host: string;
  port: number;
}

/** What a Wyoming server sends and expects: little-endian signed 16-bit mono at 16 kHz. */
export const PCM_RATE = 16_000;
export const PCM_WIDTH = 2;
export const PCM_CHANNELS = 1;

/**
 * A tenth of a second of audio per `audio-chunk`.
 *
 * The protocol does not care, but the servers are written against a live microphone and size
 * their buffers for it; a whole utterance in one frame is a shape they are never sent in
 * practice, and faster-whisper's VAD works on the chunk boundaries it is given.
 */
const CHUNK = (PCM_RATE / 10) * PCM_WIDTH * PCM_CHANNELS;

/** Long enough for a slow model on a Pi to finish a sentence, short enough to not hang a request. */
const TIMEOUT = 120_000;

const AUDIO_FORMAT = { rate: PCM_RATE, width: PCM_WIDTH, channels: PCM_CHANNELS };

/* ------------------------------------------------------------------------ framing */

/** One event, on the wire. `JSON.stringify` drops the undefined, so a text event is one line. */
function frame({ type, data, payload }: WyomingEvent): Buffer {
  const header = JSON.stringify({ type, data, payload_length: payload?.length });
  return payload
    ? Buffer.concat([Buffer.from(`${header}\n`, "utf8"), payload])
    : Buffer.from(`${header}\n`, "utf8");
}

/**
 * Events out of a byte stream.
 *
 * Held as one growing buffer rather than a list of chunks because the payloads are audio and
 * the reassembly has to be a contiguous read anyway. `data_length` is the protocol's way of
 * sending the data block separately from the header, which the Python servers do not do —
 * but it costs three lines to accept, and a client that ignores it desynchronises the stream
 * rather than failing, which is the worst way to find out.
 */
class Frames {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer) {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
  }

  *take(): Generator<WyomingEvent> {
    for (;;) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline === -1) return;

      const header = JSON.parse(this.buffer.subarray(0, newline).toString("utf8")) as {
        type: string;
        data?: Record<string, unknown>;
        data_length?: number;
        payload_length?: number;
      };
      const dataLength = header.data_length ?? 0;
      const payloadLength = header.payload_length ?? 0;
      const body = newline + 1;
      const end = body + dataLength + payloadLength;
      // The rest of it has not arrived. Leave the header in place and read it again next time.
      if (this.buffer.length < end) return;

      const data = dataLength
        ? {
            ...header.data,
            ...(JSON.parse(this.buffer.subarray(body, body + dataLength).toString("utf8")) as
              | Record<string, unknown>
              | undefined),
          }
        : (header.data ?? {});
      // Copied, not sliced: the subarray shares memory with a buffer this class reassigns.
      const payload = payloadLength
        ? Buffer.from(this.buffer.subarray(body + dataLength, end))
        : undefined;

      this.buffer = this.buffer.subarray(end);
      yield { type: header.type, data, payload };
    }
  }
}

/* ---------------------------------------------------------------------- the exchange */

/**
 * Says `send`, then collects everything the server says back until `done`.
 *
 * The socket is destroyed on every exit, including the ones that throw — a Wyoming server
 * holds the connection open after answering, so nothing here ever ends by itself.
 */
function ask(
  { host, port }: WyomingAddress,
  send: WyomingEvent[],
  done: (event: WyomingEvent) => boolean,
): Promise<WyomingEvent[]> {
  return new Promise((resolve, reject) => {
    const frames = new Frames();
    const heard: WyomingEvent[] = [];
    let settled = false;

    const socket = connect({ host, port });
    socket.setNoDelay(true);

    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(heard);
    };

    const timer = setTimeout(
      () => finish(new Error(`${host}:${port} did not answer within ${TIMEOUT / 1000}s`)),
      TIMEOUT,
    );

    socket.on("connect", () => {
      for (const event of send) socket.write(frame(event));
    });

    socket.on("data", (chunk: Buffer) => {
      frames.push(chunk);
      try {
        for (const event of frames.take()) {
          heard.push(event);
          if (done(event)) {
            finish(null);
            return;
          }
        }
      } catch (error) {
        finish(new Error(`${host}:${port} sent something unreadable: ${(error as Error).message}`));
      }
    });

    // Both are the same failure to a caller: the answer never came.
    socket.on("error", (error: Error) => finish(new Error(`${host}:${port}: ${error.message}`)));
    socket.on("close", () => finish(new Error(`${host}:${port} closed without answering`)));
  });
}

/* -------------------------------------------------------------------------- the two calls */

/**
 * PCM in, the words in it out.
 *
 * `audio-start` and `audio-stop` carry the format as well, because the servers read it from
 * whichever of the three they see first and there is no describing handshake in this path.
 */
export async function transcribe(address: WyomingAddress, pcm: Buffer): Promise<string> {
  const send: WyomingEvent[] = [
    { type: "transcribe", data: {} },
    { type: "audio-start", data: { ...AUDIO_FORMAT, timestamp: 0 } },
  ];

  for (let at = 0; at < pcm.length; at += CHUNK) {
    send.push({
      type: "audio-chunk",
      data: { ...AUDIO_FORMAT, timestamp: Math.floor((at / (PCM_RATE * PCM_WIDTH)) * 1000) },
      payload: pcm.subarray(at, at + CHUNK),
    });
  }

  send.push({ type: "audio-stop", data: { timestamp: 0 } });

  const heard = await ask(address, send, (event) => event.type === "transcript");
  const transcript = heard.find((event) => event.type === "transcript");
  return String(transcript?.data.text ?? "").trim();
}

export interface Synthesized {
  pcm: Buffer;
  rate: number;
  width: number;
  channels: number;
}

/**
 * Text in, audio out.
 *
 * The format is whatever the server announces in its `audio-start` and not what was asked for
 * — Piper's voices are trained at their own sample rates, 22.05 kHz for most of the English
 * ones — so it is read off the wire rather than assumed. Getting that wrong is not an error,
 * it is a chipmunk.
 */
export async function synthesize(
  address: WyomingAddress,
  text: string,
  voice: string,
): Promise<Synthesized> {
  const heard = await ask(
    address,
    [
      {
        type: "synthesize",
        data: voice.trim() ? { text, voice: { name: voice.trim() } } : { text },
      },
    ],
    (event) => event.type === "audio-stop",
  );

  const start = heard.find((event) => event.type === "audio-start")?.data ?? {};
  const chunks = heard.filter((event) => event.type === "audio-chunk" && event.payload);
  if (chunks.length === 0) throw new Error("the speech server sent no audio");

  return {
    pcm: Buffer.concat(chunks.map((event) => event.payload as Buffer)),
    rate: Number(start.rate) || 22_050,
    width: Number(start.width) || 2,
    channels: Number(start.channels) || 1,
  };
}
