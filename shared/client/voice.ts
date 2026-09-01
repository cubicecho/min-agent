/**
 * The client's half of voice: turning a recording into text, and text into sound.
 *
 * Only the transport lives here. Getting hold of a microphone and playing what comes back
 * are platform questions and belong in `mobile/lib/voice.ts`; what is left is two POSTs and
 * the tidying a reply needs before anything reads it aloud, which is worth testing and does
 * not need React Native to run.
 *
 * Both calls go to the agent rather than to a provider, because the API key is the server's
 * and never the app's — see `server/voice.ts`.
 */

interface VoiceClientOptions {
  /**
   * The agent's origin — `""` in a page it served, an absolute `"http://host:8787"` on a
   * device. A function is re-read on every call, so a client built once still follows a
   * server address the user edits later, exactly as the GraphQL one does.
   */
  baseUrl: string | (() => string);
  fetch?: typeof globalThis.fetch;
}

/** A recording, in the one encoding a browser and a phone can both produce without help. */
export interface Recording {
  /** base64, no data-URI prefix. */
  audio: string;
  /** What was recorded: `audio/webm` in a browser, `audio/mp4` on Android. */
  mime: string;
}

export interface Spoken {
  bytes: ArrayBuffer;
  mime: string;
}

/**
 * Fenced code, read aloud, is a minute of punctuation. So are the hashes on a heading and
 * the target of every link.
 *
 * This is deliberately a strip rather than a parse: it runs on every reply that gets spoken,
 * the input is the markdown the model wrote, and the worst a missed case costs is one
 * asterisk pronounced. Nothing downstream reads the output except a voice.
 */
export function speakableText(markdown: string): string {
  return (
    markdown
      // Whole blocks first, so their contents are not re-processed as prose.
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/~~~[\s\S]*?~~~/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      // A link is worth hearing by its text; its href is a URL read character by character.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      // Line furniture: heading hashes, quote carets, list bullets, rules. Spaces and tabs
      // rather than `\s`, which in a multiline pattern also matches the newline before the
      // line being stripped — and so quietly ate the blank line between two paragraphs,
      // running them together into one breath.
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
      .replace(/^[ \t]{0,3}([-*+]|\d+\.)[ \t]+/gm, "")
      .replace(/^[ \t]{0,3}([-*_])[ \t]*(\1[ \t]*){2,}$/gm, " ")
      // Emphasis, which is markup around a word rather than part of it.
      .replace(/(\*\*|__|\*|_|~~)/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** The agent answers a failure with `{ error }`; anything else is reported by status. */
async function complain(response: Response, what: string): Promise<never> {
  const said = await response
    .clone()
    .json()
    .then((body: { error?: string }) => body.error)
    .catch(() => undefined);
  throw new Error(said || `${what} failed (${response.status})`);
}

export function createVoiceClient({ baseUrl, fetch: fetchImpl }: VoiceClientOptions) {
  const call = fetchImpl ?? globalThis.fetch;
  const at = (path: string) =>
    `${typeof baseUrl === "function" ? baseUrl() : baseUrl}/api/voice${path}`;

  return {
    /** A recording in, the words in it out. Throws what the provider said, as a sentence. */
    async transcribe(recording: Recording): Promise<string> {
      const response = await call(at("/transcribe"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(recording),
      });
      if (!response.ok) await complain(response, "transcription");
      const { text } = (await response.json()) as { text: string };
      return text;
    },

    /**
     * Text in, audio out. The caller plays it: what that means is the one thing about voice
     * that is genuinely different in a browser and on a phone.
     */
    async speak(text: string): Promise<Spoken> {
      const response = await call(at("/speak"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: speakableText(text) }),
      });
      if (!response.ok) await complain(response, "speech");
      return {
        bytes: await response.arrayBuffer(),
        mime: response.headers.get("content-type") ?? "audio/mpeg",
      };
    },
  };
}

export type VoiceClient = ReturnType<typeof createVoiceClient>;
