import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { createVoiceClient, speakableText, spokenChunk } from "@shared/client/voice.ts";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { audioExtension, voice } from "../../server/voice.ts";
import { jsonBody } from "../helpers.ts";
import { storedSettings } from "./helpers.ts";

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

/**
 * Where a server started on port 0 ended up.
 * @param server A listening server.
 * @returns Its base URL on the loopback.
 */
function urlOf(server: Server) {
  const address = server.address();
  if (typeof address === "string" || !address) {
    throw new Error("no port");
  }
  return `http://127.0.0.1:${address.port}`;
}

/** Answers whatever it is handed, and records the requests it was given. */
function server(reply: () => Response) {
  const seen: { url: string; body: Record<string, unknown> }[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: jsonBody(String(init?.body)) });
    return reply();
  };
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

  it("says so when the answer carries no transcript", async () => {
    const { fetch } = server(() => json({}));
    const voice = createVoiceClient({ baseUrl: "", fetch });

    await expect(voice.transcribe({ audio: "AAAA", mime: "audio/webm" })).rejects.toThrow(
      "transcription failed: the server answered without any text",
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

describe("spokenChunk", () => {
  it("leaves a reply that fits alone", () => {
    expect(spokenChunk("Short enough.", 100)).toBe("Short enough.");
  });

  // The cut is where the tail is lost either way; what it decides is whether the last thing
  // heard is a sentence or half a word.
  it("ends on the last sentence that fits", () => {
    const text = `${"a".repeat(80)}. Then a second one. And a third that runs past the end`;
    expect(spokenChunk(text, 110)).toBe(`${"a".repeat(80)}. Then a second one.`);
  });

  it("keeps the quote a sentence ended inside", () => {
    const text = `${"a".repeat(80)}. He said "no." And then more than there is room for`;
    expect(spokenChunk(text, 110)).toBe(`${"a".repeat(80)}. He said "no."`);
  });

  // A full stop in the first line of a long reply is not a place to stop reading; cutting
  // there would drop most of what fits for the sake of a tidier ending.
  it("would rather break at a space than lose a fifth of the reply", () => {
    const text = `One. ${"word ".repeat(60)}`;
    const spoken = spokenChunk(text, 100);
    expect(spoken).toBe(`One. ${"word ".repeat(19)}`.trim());
    expect(spoken.endsWith("word")).toBe(true);
  });

  it("cuts a run with nothing to break on rather than saying nothing", () => {
    const spoken = spokenChunk("x".repeat(300), 100);
    expect(spoken).toBe("x".repeat(100));
  });

  it("does not mistake a decimal point for the end of a sentence", () => {
    const text = `${"a".repeat(88)} 3.5 and more than fits here`;
    expect(spokenChunk(text, 100)).toBe(`${"a".repeat(88)} 3.5 and`);
  });
});

/**
 * What the proxy tells the provider about who is asking. The key is the chat endpoint's — the
 * row's, else `$OPENAI_API_KEY` — and with neither it is a placeholder of min-agent's own,
 * because the SDK will not build a client without one and a local server does not look.
 *
 * Tested over real sockets because the header is the only place the key shows: the routes sit
 * in front of a provider that is a server of ours here, which records what it was sent.
 */
describe("the key the voice proxy sends", () => {
  const previous = process.env.OPENAI_API_KEY;
  const seen: (string | undefined)[] = [];
  let provider: Server;
  let agent: Server;

  /**
   * Has a reply read aloud, with the provider configured as the one here.
   * @param apiKey The key in the settings row; empty for none.
   * @returns The `Authorization` header the provider received.
   */
  const spoken = async (apiKey: string) => {
    await storedSettings({ baseUrl: urlOf(provider), ttsModel: "tts-1", apiKey });
    const response = await fetch(`${urlOf(agent)}/speak`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(response.status).toBe(200);
    return seen.at(-1);
  };

  beforeAll(async () => {
    provider = createServer((request, response) => {
      seen.push(request.headers.authorization);
      request.resume();
      response.writeHead(200, { "content-type": "audio/mpeg" });
      response.end(Buffer.from([1, 2, 3]));
    }).listen(0, "127.0.0.1");
    agent = express().use(voice).listen(0, "127.0.0.1");
    await Promise.all([once(provider, "listening"), once(agent, "listening")]);
  });

  afterAll(async () => {
    await storedSettings({});
    provider.close();
    agent.close();
  });

  beforeEach(() => {
    seen.length = 0;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previous;
    }
  });

  it("is min-agent's placeholder when neither the row nor the environment holds one", async () => {
    expect(await spoken("")).toBe("Bearer min-agent");
  });

  it("is the row's key when there is one", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    expect(await spoken("sk-test")).toBe("Bearer sk-test");
  });

  it("falls back to the environment when the row holds no key", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    expect(await spoken("")).toBe("Bearer sk-from-env");
  });
});

/**
 * The routes are reachable by anything that can post, so a body is whatever it was sent. One
 * that is not the request is the sender's mistake and is answered as one, not as a failure of
 * the server or of the provider behind it.
 */
describe("a voice request that is not one", () => {
  let agent: Server;

  /**
   * Posts JSON to a voice route.
   * @param path The route, from the router's root.
   * @param body What to send; nothing at all when left out.
   * @returns The status and the error the route answered with.
   */
  const posted = async (path: string, body?: unknown) => {
    const response = await fetch(`${urlOf(agent)}${path}`, {
      method: "POST",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const answer: unknown = await response.json().catch(() => null);
    return { status: response.status, answer };
  };

  beforeAll(async () => {
    await storedSettings({
      baseUrl: "http://127.0.0.1:1",
      sttModel: "whisper-1",
      ttsModel: "tts-1",
    });
    agent = express().use(voice).listen(0, "127.0.0.1");
    await once(agent, "listening");
  });

  afterAll(async () => {
    await storedSettings({});
    agent.close();
  });

  it("refuses text that is not a string", async () => {
    expect(await posted("/speak", { text: 5 })).toEqual({
      status: 400,
      answer: { error: "no text" },
    });
  });

  it("refuses a request to speak that has no body", async () => {
    expect(await posted("/speak")).toEqual({ status: 400, answer: { error: "no text" } });
  });

  it("refuses audio that is not a string", async () => {
    expect(await posted("/transcribe", { audio: 5 })).toEqual({
      status: 400,
      answer: { error: "no audio" },
    });
  });

  it("refuses a request to transcribe that has no body", async () => {
    expect(await posted("/transcribe")).toEqual({ status: 400, answer: { error: "no audio" } });
  });
});
