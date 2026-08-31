import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Session, SessionSummary } from "../shared/types.ts";
import { SESSIONS_DIR } from "./paths.ts";

const file = (id: string) => path.join(SESSIONS_DIR, `${id}.json`);

/**
 * Everything the session list shows, kept beside the transcript rather than inside it.
 *
 * The sidebar is refetched after every turn, and without this `listSessions` had to read and
 * parse every message of every conversation on disk to produce a column of titles and dates —
 * work that grew with the whole history each time.
 */
const metaFile = (id: string) => path.join(SESSIONS_DIR, `${id}.meta.json`);

/**
 * A sidecar records what the transcript looked like when it was written. `data/sessions` is a
 * directory you are meant to be able to open, so a session file changed by anything other than
 * this module has to be noticed rather than served from a summary that no longer describes it.
 */
interface Sidecar {
  source: { size: number; mtimeMs: number };
  summary: SessionSummary;
}

/** Session ids come from randomUUID, but never trust them off the wire. */
function assertId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error(`invalid session id: ${id}`);
}

const summarize = ({ messages, ...meta }: Session): SessionSummary => ({
  ...meta,
  messageCount: messages.length,
});

export function createSession(init: Partial<Session> = {}): Session {
  const now = new Date().toISOString();
  const session: Session = {
    id: randomUUID(),
    title: init.title ?? "New chat",
    createdAt: now,
    updatedAt: now,
    messages: init.messages ?? [],
  };
  saveSession(session);
  return session;
}

export function saveSession(session: Session) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(file(session.id), JSON.stringify(session, null, 2), "utf8");
  writeSidecar(session);
}

function writeSidecar(session: Session) {
  try {
    const { size, mtimeMs } = fs.statSync(file(session.id));
    const sidecar: Sidecar = { source: { size, mtimeMs }, summary: summarize(session) };
    fs.writeFileSync(metaFile(session.id), JSON.stringify(sidecar), "utf8");
  } catch {
    // A read-only data directory still works; the list just pays for the parse every time.
  }
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
  fs.rmSync(metaFile(id), { force: true });
}

/**
 * One session's summary. A transcript written before the sidecar existed — or since edited by
 * hand — still has to appear in the list, so it is read in full once and leaves a fresh sidecar
 * behind for the next time.
 */
function summaryFor(id: string): SessionSummary | null {
  try {
    const { size, mtimeMs } = fs.statSync(file(id));
    const sidecar = JSON.parse(fs.readFileSync(metaFile(id), "utf8")) as Sidecar;
    if (sidecar.source?.size === size && sidecar.source.mtimeMs === mtimeMs) return sidecar.summary;
  } catch {
    // No sidecar yet, or no transcript to check it against. Work it out from the session.
  }

  const session = getSession(id);
  if (!session) return null;
  writeSidecar(session);
  return summarize(session);
}

export function listSessions(): SessionSummary[] {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  return fs
    .readdirSync(SESSIONS_DIR)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".meta.json"))
    .flatMap((name) => summaryFor(name.replace(/\.json$/, "")) ?? [])
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
