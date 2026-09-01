import { createVoiceClient, speakableText } from "@shared/client/voice.ts";
import { describe, expect, it } from "vitest";
import { audioExtension } from "../server/voice.ts";

/**
 * The two ends of voice that are worth pinning down: what a reply sounds like once the
 * markdown is off it, and what actually goes over the wire. Getting hold of a microphone and
 * playing audio back are platform questions and are not testable here.
 */

describe("speakableText", () => {
  it("drops fenced code rather than reading it aloud", () => {
    const spoken = speakableText("Try this:\n\n```ts\nconst x = 1;\n```\n\nand you are done.");
    expect(spoken).not.toContain("const");
    expect(spoken).toContain("Try this:");
    expect(spoken).toContain("and you are done.");
  });

  it("keeps the words of a link and loses its address", () => {
    expect(speakableText("See [the readme](https://example.com/a/b#c).")).toBe("See the readme.");
  });

  it("says nothing about an image", () => {
    expect(speakableText("![a chart](chart.png) is above.")).toBe("is above.");
  });

  it("strips the furniture a heading, a quote and a list are made of", () => {
    expect(speakableText("## Results\n\n- one\n- two\n\n> quoted")).toBe(
      "Results\n\none\ntwo\n\nquoted",
    );
  });

  it("unwraps emphasis without eating the word inside it", () => {
    expect(speakableText("**really** _quite_ `fast`")).toBe("really quite fast");
  });
});

describe("audioExtension", () => {
  // A browser sends the codec along with the type, and Whisper decides how to decode by the
  // filename — so the parameters have to come off before the name is built.
  it("ignores the parameters on a media type", () => {
    expect(audioExtension("audio/webm;codecs=opus")).toBe("webm");
  });

  it("names what the phone records", () => {
    expect(audioExtension("audio/mp4")).toBe("m4a");
  });

  it("falls back rather than uploading a file with no extension", () => {
    expect(audioExtension("application/octet-stream")).toBe("webm");
  });
});

/** Answers whatever it is handed, and records the requests it was given. */
function server(reply: () => Response) {
  const seen: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, body: JSON.parse(init.body as string) });
    return reply();
  }) as unknown as typeof globalThis.fetch;
  return { seen, fetch };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createVoiceClient", () => {
  it("posts the recording to the agent and answers with what was said", async () => {
    const { seen, fetch } = server(() => json({ text: "hello there" }));
    const voice = createVoiceClient({ baseUrl: "http://host:8787", fetch });

    expect(await voice.transcribe({ audio: "AAAA", mime: "audio/webm" })).toBe("hello there");
    expect(seen[0]?.url).toBe("http://host:8787/api/voice/transcribe");
    expect(seen[0]?.body).toEqual({ audio: "AAAA", mime: "audio/webm" });
  });

  it("reports what the provider said, not the status code", async () => {
    const { fetch } = server(() => json({ error: "no transcription model is configured" }, 409));
    const voice = createVoiceClient({ baseUrl: "", fetch });

    await expect(voice.transcribe({ audio: "AAAA", mime: "audio/webm" })).rejects.toThrow(
      "no transcription model is configured",
    );
  });

  it("still says something useful when the failure carries no message", async () => {
    const { fetch } = server(() => new Response("", { status: 502 }));
    const voice = createVoiceClient({ baseUrl: "", fetch });

    await expect(voice.speak("hi")).rejects.toThrow("speech failed (502)");
  });

  it("sends the reply with its markdown already off", async () => {
    const { seen, fetch } = server(
      () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }),
    );
    const voice = createVoiceClient({ baseUrl: "", fetch });

    const spoken = await voice.speak("# Title\n\n`code` and **bold**");
    expect(seen[0]?.body).toEqual({ text: "Title\n\ncode and bold" });
    expect(new Uint8Array(spoken.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(spoken.mime).toBe("audio/mpeg");
  });

  // The server address is editable, and a client built at import time would otherwise keep
  // calling the one that was configured when the app started.
  it("re-reads a base URL given as a function", async () => {
    let host = "http://one:8787";
    const { seen, fetch } = server(() => json({ text: "" }));
    const voice = createVoiceClient({ baseUrl: () => host, fetch });

    await voice.transcribe({ audio: "", mime: "audio/webm" });
    host = "http://two:8787";
    await voice.transcribe({ audio: "", mime: "audio/webm" });

    expect(seen.map((call) => call.url)).toEqual([
      "http://one:8787/api/voice/transcribe",
      "http://two:8787/api/voice/transcribe",
    ]);
  });
});
