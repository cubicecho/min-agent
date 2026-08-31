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

  it("lists without opening the transcripts", () => {
    const session = store.createSession({ title: "kept" });
    session.messages.push({ role: "user", content: "a very long conversation" });
    store.saveSession(session);

    const read = vi.spyOn(fs, "readFileSync");
    const list = store.listSessions();
    const opened = read.mock.calls.map((call) => String(call[0]));
    read.mockRestore();

    expect(list.map((item) => item.title)).toEqual(["kept"]);
    expect(list[0].messageCount).toBe(1);
    expect(opened.some((name) => name.endsWith(`${session.id}.json`))).toBe(false);
    expect(opened.some((name) => name.endsWith(`${session.id}.meta.json`))).toBe(true);
  });

  it("rebuilds a sidecar left behind by a transcript edited on disk", () => {
    const session = store.createSession({ title: "before" });
    session.title = "after";
    fs.writeFileSync(path.join(dir, "sessions", `${session.id}.json`), JSON.stringify(session));

    expect(store.listSessions().map((item) => item.title)).toEqual(["after"]);
  });

  it("writes a sidecar for a session that predates it", () => {
    const session = store.createSession({ title: "old" });
    const meta = path.join(dir, "sessions", `${session.id}.meta.json`);
    fs.rmSync(meta);

    expect(store.listSessions().map((item) => item.title)).toEqual(["old"]);
    expect(fs.existsSync(meta)).toBe(true);
  });

  it("takes the sidecar with the session when one is deleted", () => {
    const session = store.createSession({ title: "gone" });
    store.deleteSession(session.id);

    expect(fs.readdirSync(path.join(dir, "sessions"))).toEqual([]);
  });

  it("refuses a session id that escapes the data directory", () => {
    expect(() => store.deleteSession("../../etc/passwd")).toThrow(/invalid session id/);
  });

  it("returns null for a session that is not there", () => {
    expect(store.getSession("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
