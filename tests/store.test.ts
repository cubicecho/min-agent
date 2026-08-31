import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let store: typeof import("../server/store.ts");

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "min-agent-data-"));
  process.env.MIN_AGENT_DATA_DIR = dir;
  vi.resetModules();
  store = await import("../server/store.ts");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.MIN_AGENT_DATA_DIR;
});

describe("session store", () => {
  it("writes one json file per session and reads it back", () => {
    const session = store.createSession({ title: "hello" });
    session.messages.push({ role: "user", content: "hi" });
    store.saveSession(session);

    expect(fs.existsSync(path.join(dir, "sessions", `${session.id}.json`))).toBe(true);
    expect(store.getSession(session.id)?.messages).toHaveLength(1);
  });

  it("lists newest first without loading message bodies", () => {
    const older = store.createSession({ title: "older" });
    older.updatedAt = "2020-01-01T00:00:00.000Z";
    fs.writeFileSync(path.join(dir, "sessions", `${older.id}.json`), JSON.stringify(older));
    store.createSession({ title: "newer" });

    const list = store.listSessions();
    expect(list.map((item) => item.title)).toEqual(["newer", "older"]);
    expect(list[0]).not.toHaveProperty("messages");
  });

  it("refuses a session id that escapes the data directory", () => {
    expect(() => store.deleteSession("../../etc/passwd")).toThrow(/invalid session id/);
  });

  it("returns null for a session that is not there", () => {
    expect(store.getSession("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
