import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { wav } from "../server/audio.ts";
import { synthesize, transcribe } from "../server/wyoming.ts";
import { wyomingAddress } from "../shared/types.ts";

/**
 * The wire, tested against a socket rather than a mock.
 *
 * Wyoming is a framing format before it is anything else, and framing is where a client
 * quietly goes wrong: a header split across two TCP reads, or a payload length counted in
 * the wrong units, both look like "no answer" from the outside. So the fake server here
 * parses what it is sent for real, and the assertions are about the bytes.
 */

interface Frame {
  type: string;
  data: Record<string, unknown>;
  payload?: Buffer;
}

/** The same job as `Frames` in `wyoming.ts`, written again so the test is not the code. */
function parser(onFrame: (frame: Frame) => void) {
  let held = Buffer.alloc(0);
  return (chunk: Buffer) => {
    held = Buffer.concat([held, chunk]);
    for (;;) {
      const newline = held.indexOf(0x0a);
      if (newline === -1) return;
      const header = JSON.parse(held.subarray(0, newline).toString("utf8"));
      const dataLength: number = header.data_length ?? 0;
      const payloadLength: number = header.payload_length ?? 0;
      const body = newline + 1;
      const end = body + dataLength + payloadLength;
      if (held.length < end) return;
      const data = dataLength
        ? JSON.parse(held.subarray(body, body + dataLength).toString("utf8"))
        : (header.data ?? {});
      const payload = payloadLength
        ? Buffer.from(held.subarray(body + dataLength, end))
        : undefined;
      held = held.subarray(end);
      onFrame({ type: header.type, data, payload });
    }
  };
}

const line = (header: Record<string, unknown>) =>
  Buffer.from(`${JSON.stringify(header)}\n`, "utf8");

let running: Server | undefined;

afterEach(() => {
  running?.close();
  running = undefined;
});

/** Listens on a free port and hands the address back in the shape the client takes. */
async function serve(handle: (socket: Socket, frame: Frame) => void) {
  const server = createServer((socket) => {
    socket.on(
      "data",
      parser((frame) => handle(socket, frame)),
    );
    socket.on("error", () => {});
  });
  running = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("no port");
  return { host: "127.0.0.1", port: address.port };
}

describe("wyomingAddress", () => {
  it("reads a host and a port out of a tcp URL", () => {
    expect(wyomingAddress("tcp://192.168.1.10:10300")).toEqual({
      host: "192.168.1.10",
      port: 10300,
    });
  });

  it("tolerates the trailing slash a browser adds and the space a paste brings", () => {
    expect(wyomingAddress("  tcp://whisper.local:10300/  ")).toEqual({
      host: "whisper.local",
      port: 10300,
    });
  });

  it("unwraps the brackets an IPv6 literal needs to hold a port", () => {
    expect(wyomingAddress("tcp://[fd00::1]:10200")).toEqual({ host: "fd00::1", port: 10200 });
  });

  // Everything that is not an address is a model name, and a model name is the other branch.
  it("is not fooled by a model name or by the wrong scheme", () => {
    expect(wyomingAddress("whisper-1")).toBeNull();
    expect(wyomingAddress("http://host:10300")).toBeNull();
    expect(wyomingAddress("tcp://host")).toBeNull();
    expect(wyomingAddress("tcp://host:99999")).toBeNull();
    expect(wyomingAddress("")).toBeNull();
  });
});

describe("transcribe", () => {
  it("says the whole conversation and answers with what came back", async () => {
    const said: Frame[] = [];
    const address = await serve((socket, frame) => {
      said.push(frame);
      if (frame.type !== "audio-stop") return;
      socket.write(line({ type: "transcript", data: { text: "  hello there  " } }));
    });

    // A second and a half, so the chunking has something to divide.
    const pcm = Buffer.alloc(16_000 * 2 * 1.5, 7);
    expect(await transcribe(address, pcm)).toBe("hello there");

    expect(said[0]?.type).toBe("transcribe");
    expect(said[1]?.type).toBe("audio-start");
    expect(said[1]?.data).toMatchObject({ rate: 16_000, width: 2, channels: 1 });
    expect(said.at(-1)?.type).toBe("audio-stop");

    // Fifteen tenths of a second, and every sample of it, in order.
    const chunks = said.filter((frame) => frame.type === "audio-chunk");
    expect(chunks).toHaveLength(15);
    expect(Buffer.concat(chunks.map((frame) => frame.payload as Buffer))).toEqual(pcm);
  });

  it("reassembles an answer that arrives a byte at a time", async () => {
    const address = await serve((socket, frame) => {
      if (frame.type !== "audio-stop") return;
      const reply = line({ type: "transcript", data: { text: "split" } });
      for (const byte of reply) socket.write(Buffer.from([byte]));
    });

    expect(await transcribe(address, Buffer.alloc(64))).toBe("split");
  });

  // The protocol allows the data block to be sent after the header rather than inside it.
  // The Python servers do not, which is exactly why a client that cannot read it would ship.
  it("reads a header whose data came in its own block", async () => {
    const address = await serve((socket, frame) => {
      if (frame.type !== "audio-stop") return;
      const data = Buffer.from(JSON.stringify({ text: "out of band" }), "utf8");
      socket.write(line({ type: "transcript", data_length: data.length }));
      socket.write(data);
    });

    expect(await transcribe(address, Buffer.alloc(64))).toBe("out of band");
  });

  it("blames the address when nothing is listening on it", async () => {
    await expect(transcribe({ host: "127.0.0.1", port: 1 }, Buffer.alloc(64))).rejects.toThrow(
      /127\.0\.0\.1:1/,
    );
  });
});

describe("synthesize", () => {
  it("asks for the text and hands back the samples with the format they were sent in", async () => {
    const said: Frame[] = [];
    const address = await serve((socket, frame) => {
      said.push(frame);
      if (frame.type !== "synthesize") return;
      const format = { rate: 22_050, width: 2, channels: 1 };
      socket.write(line({ type: "audio-start", data: format }));
      for (const byte of [1, 2, 3]) {
        socket.write(line({ type: "audio-chunk", data: format, payload_length: 2 }));
        socket.write(Buffer.from([byte, 0]));
      }
      socket.write(line({ type: "audio-stop", data: {} }));
    });

    const spoken = await synthesize(address, "say this", "en_GB-alba-medium");
    expect(said[0]?.data).toEqual({
      text: "say this",
      voice: { name: "en_GB-alba-medium" },
    });
    expect(spoken).toEqual({
      pcm: Buffer.from([1, 0, 2, 0, 3, 0]),
      rate: 22_050,
      width: 2,
      channels: 1,
    });
  });

  // A server with one voice rejects being told which one to use, so a blank box sends nothing.
  it("leaves the voice out when none was named", async () => {
    const said: Frame[] = [];
    const address = await serve((socket, frame) => {
      said.push(frame);
      if (frame.type !== "synthesize") return;
      socket.write(line({ type: "audio-chunk", data: {}, payload_length: 2 }));
      socket.write(Buffer.from([9, 0]));
      socket.write(line({ type: "audio-stop", data: {} }));
    });

    await synthesize(address, "say this", "   ");
    expect(said[0]?.data).toEqual({ text: "say this" });
  });

  it("complains rather than returning an empty file when no audio came", async () => {
    const address = await serve((socket, frame) => {
      if (frame.type !== "synthesize") return;
      socket.write(line({ type: "audio-start", data: {} }));
      socket.write(line({ type: "audio-stop", data: {} }));
    });

    await expect(synthesize(address, "say this", "")).rejects.toThrow("no audio");
  });
});

describe("wav", () => {
  it("puts a header on the samples that says what they are", () => {
    const pcm = Buffer.alloc(8, 3);
    const file = wav(pcm, { rate: 22_050, width: 2, channels: 1 });

    expect(file.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(file.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(file.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(file.subarray(12, 16).toString("ascii")).toBe("fmt ");
    expect(file.readUInt32LE(16)).toBe(16);
    expect(file.readUInt16LE(20)).toBe(1);
    expect(file.readUInt16LE(22)).toBe(1); // channels
    expect(file.readUInt32LE(24)).toBe(22_050);
    expect(file.readUInt32LE(28)).toBe(22_050 * 2); // bytes a second
    expect(file.readUInt16LE(32)).toBe(2); // block align
    expect(file.readUInt16LE(34)).toBe(16); // bits a sample
    expect(file.subarray(36, 40).toString("ascii")).toBe("data");
    expect(file.readUInt32LE(40)).toBe(pcm.length);
    expect(file.subarray(44)).toEqual(pcm);
  });

  it("counts a stereo frame as both of its samples", () => {
    const file = wav(Buffer.alloc(8), { rate: 16_000, width: 2, channels: 2 });
    expect(file.readUInt16LE(32)).toBe(4);
    expect(file.readUInt32LE(28)).toBe(16_000 * 4);
  });
});
