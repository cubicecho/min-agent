import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Session, SessionSummary } from "../shared/types.ts";
import { SESSIONS_DIR } from "./paths.ts";

const file = (id: string) => path.join(SESSIONS_DIR, `${id}.json`);

/** Session ids come from randomUUID, but never trust them off the wire. */
function assertId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error(`invalid session id: ${id}`);
}

export function createSession(init: Partial<Session> = {}): Session {
  const now = new Date().toISOString();
  const session: Session = {
    id: randomUUID(),
    title: init.title ?? "New chat",
    createdAt: now,
    updatedAt: now,
    source: init.source ?? "chat",
    cronJobId: init.cronJobId,
    messages: init.messages ?? [],
  };
  saveSession(session);
  return session;
}

export function saveSession(session: Session) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(file(session.id), JSON.stringify(session, null, 2), "utf8");
}

export function getSession(id: string): Session | null {
  assertId(id);
  try {
    return JSON.parse(fs.readFileSync(file(id), "utf8")) as Session;
  } catch {
    return null;
  }
}

export function deleteSession(id: string) {
  assertId(id);
  fs.rmSync(file(id), { force: true });
}

export function listSessions(): SessionSummary[] {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  return fs
    .readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const session = getSession(f.replace(/\.json$/, ""));
      if (!session) return [];
      const { messages, ...meta } = session;
      return [{ ...meta, messageCount: messages.length }];
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
