import { createClient } from "@shared/client/api.ts";
import type { LlmConfigView } from "@shared/types.ts";
import { describe, expect, it } from "vitest";

/** What the `Config` query answers with — the row the mutation is expected to patch. */
const STORED = {
  baseUrl: "http://framework.lan:13305/v1",
  model: "",
  maxTokens: 4096,
  temperature: 0.7,
  maxToolIterations: 20,
  systemPrompt: "You are min-agent, a concise and careful assistant.",
  contextLimit: 0,
  toolDiscovery: "ondemand",
  taskModels: {},
  pricing: { inputPer1M: 0, outputPer1M: 0 },
  voiceBaseUrl: "",
  sttModel: "",
  ttsModel: "",
  ttsVoice: "",
  speakReplies: false,
};

/**
 * A client whose fetch answers the three settings operations and records every set of
 * variables it was given, so a test can assert on what actually went over the wire.
 */
function recording() {
  const sent: { operation: string; variables: Record<string, unknown> }[] = [];

  const { api } = createClient({
    baseUrl: "/graphql",
    fetch: (async (_url: string, init: RequestInit) => {
      const { query, variables } = JSON.parse(init.body as string);
      const operation = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
      sent.push({ operation, variables });

      const data =
        operation === "Config"
          ? { setting: STORED, hasApiKey: false }
          : operation === "SaveConfig"
            ? { updateSettingSingle: { id: "default" } }
            : { setApiKey: true };

      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as unknown as typeof fetch,
  });

  return { api, sent, of: (operation: string) => sent.filter((s) => s.operation === operation) };
}

describe("saveConfig", () => {
  /**
   * The regression this guards: the screens seed their draft by spreading `config()`, whose
   * shape is `LlmConfigView` — the row *plus* the derived `hasApiKey`. TypeScript does not
   * catch it, because excess-property checks do not apply to a spread, so the flag used to
   * reach the server and be rejected with `Field "hasApiKey" is not defined by type
   * "UpdateSettingInput"`, failing the whole save.
   */
  it("drops the derived hasApiKey a screen spreads in from config()", async () => {
    const { api, of } = recording();
    const view: LlmConfigView = { ...STORED, toolDiscovery: "ondemand", hasApiKey: false };

    await api.saveConfig({ ...view, apiKey: "" });

    expect(of("SaveConfig")).toHaveLength(1);
    expect(of("SaveConfig")[0].variables.set).toEqual(STORED);
  });

  /** A blank key is "leave it alone", not "clear it", so it must not reach the mutation. */
  it("does not send an empty api key", async () => {
    const { api, of } = recording();
    await api.saveConfig({ model: "gpt-5", apiKey: "" });

    expect(of("SetApiKey")).toHaveLength(0);
    expect(of("SaveConfig")[0].variables.set).toEqual({ model: "gpt-5" });
  });

  /** A key travels on its own mutation, never as a settings column. */
  it("sends a key on its own mutation and keeps it out of the columns", async () => {
    const { api, of } = recording();
    await api.saveConfig({ model: "gpt-5", apiKey: "sk-secret" });

    expect(of("SetApiKey")[0].variables).toEqual({ apiKey: "sk-secret" });
    expect(of("SaveConfig")[0].variables.set).toEqual({ model: "gpt-5" });
  });

  /** Nothing to patch means no mutation at all, rather than an empty `set`. */
  it("skips the mutation when only a key changed", async () => {
    const { api, of } = recording();
    await api.saveConfig({ apiKey: "sk-secret" });

    expect(of("SaveConfig")).toHaveLength(0);
  });
});
