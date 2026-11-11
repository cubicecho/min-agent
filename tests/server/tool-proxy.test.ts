import { CALL_TOOL as CORE_CALL_TOOL } from "@cubicecho/agent-core";
import { CALL_TOOL, shownCall } from "../../shared/tool-proxy.ts";

/**
 * Proxied discovery is agent-core's — the two declared tools, the catalogue, the load's answer and
 * the unwrapping of a `call_tool` — and is tested there. What is min-agent's is the display: the
 * app cannot load agent-core, so `shared/tool-proxy.ts` keeps the one name and the one reading it
 * needs, and has to agree with the package's.
 */
describe("proxied tool discovery, as the chat shows it", () => {
  it("names the proxy tool as agent-core does", () => {
    expect(CALL_TOOL).toBe(CORE_CALL_TOOL);
  });

  it("shows a call_tool as the tool it ran", () => {
    expect(
      shownCall(CALL_TOOL, JSON.stringify({ name: "fs__read", arguments: { path: "a.txt" } })),
    ).toEqual({ name: "fs__read", input: '{"path":"a.txt"}' });
    expect(shownCall("fs__read", "{}")).toEqual({ name: "fs__read", input: "{}" });
    expect(shownCall(CALL_TOOL, "{")).toEqual({ name: CALL_TOOL, input: "{" });
  });
});
