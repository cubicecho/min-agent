import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PCM_CHANNELS, PCM_RATE, PCM_WIDTH } from "./wyoming.ts";

/**
 * Turning what a phone records into what a Wyoming server accepts, and back again.
 *
 * Wyoming carries raw PCM and nothing else, while the app records AAC in an MP4 on Android
 * and Opus in a WebM in a browser. Android's `MediaRecorder` has no PCM output — the whole
 * list is `3gp`, `mpeg4`, `amrnb`, `amrwb`, `aac_adts`, `mpeg2ts`, `webm`, every one of them
 * compressed — so this is not a setting that was missed. Something has to decode, and the
 * choice is a system `ffmpeg` here or a second native recorder in all three builds.
 *
 * `ffmpeg` won on the grounds that it is thirty lines and no new native surface. It is needed
 * *only* for dictation against a Wyoming server: speech comes back as PCM already, and the
 * OpenAI-compatible path uploads the recording untouched, as it always has.
 */

/** Long enough for a minute of speech on a slow disk; a clip that takes longer is not decoding. */
const TIMEOUT = 30_000;

const NOT_INSTALLED =
  "ffmpeg is not on the PATH, and a Wyoming server needs the recording decoded to PCM first. " +
  "Install it, or name an OpenAI-compatible model instead of a tcp:// address.";

/**
 * The recording, as the PCM Wyoming wants: 16 kHz, 16-bit, mono.
 *
 * Written to a file rather than piped in, which looks like the long way round and is not: an
 * MP4 from `MediaRecorder` keeps its index at the *end* of the file, so a decoder reading a
 * pipe hits the audio before it has been told how to interpret it and gives up. A path can be
 * seeked. The clip is a few hundred kilobytes and lives for the length of one request.
 */
export async function toPcm(audio: Buffer, extension: string): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "min-agent-voice-"));
  const source = join(directory, `${randomUUID()}.${extension}`);

  try {
    await writeFile(source, audio);
    return await decode(source);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

function decode(source: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      source,
      "-f",
      `s16le`,
      "-acodec",
      "pcm_s16le",
      "-ar",
      String(PCM_RATE),
      "-ac",
      String(PCM_CHANNELS),
      "pipe:1",
    ]);

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;

    const finish = (error: Error | null, pcm?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        ffmpeg.kill("SIGKILL");
        reject(error);
      } else resolve(pcm as Buffer);
    };

    const timer = setTimeout(() => finish(new Error("decoding the recording timed out")), TIMEOUT);

    ffmpeg.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => err.push(chunk));

    ffmpeg.on("error", (error: NodeJS.ErrnoException) =>
      finish(new Error(error.code === "ENOENT" ? NOT_INSTALLED : error.message)),
    );

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        const said = Buffer.concat(err).toString("utf8").trim().split("\n").pop();
        finish(new Error(said || `ffmpeg exited with ${code}`));
        return;
      }
      const pcm = Buffer.concat(out);
      if (pcm.length === 0) finish(new Error("the recording decoded to no audio"));
      else finish(null, pcm);
    });
  });
}

/* ---------------------------------------------------------------------------- wav */

/**
 * PCM with the 44 bytes in front of it that make it a file.
 *
 * Speech from a Wyoming server arrives as bare samples, and neither a browser nor Android
 * will play those. A WAV header is the cheapest thing that turns them into audio — no
 * re-encoding, no second `ffmpeg`, and both runtimes already play `audio/wav`.
 */
export function wav(
  pcm: Buffer,
  { rate = PCM_RATE, width = PCM_WIDTH, channels = PCM_CHANNELS } = {},
): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = width * channels;

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // The size of this chunk, which for plain PCM is always 16.
  header.writeUInt16LE(1, 20); // 1 is uncompressed.
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * blockAlign, 28); // Bytes per second.
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(width * 8, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
