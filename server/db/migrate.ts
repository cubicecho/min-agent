import { sql } from "drizzle-orm";
import { db } from "./client.ts";

/**
 * Creates the tables on boot, so a fresh clone runs with no migration step.
 *
 * This is the MVP's substitute for migrations, not a replacement for them: it only ever
 * *adds*, so a column that changes shape needs `npm run db:push` (drizzle-kit) against the
 * database. Once the schema stops moving, generated migrations replace this outright.
 */
export async function ensureSchema() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      base_url TEXT NOT NULL DEFAULT 'http://localhost:11434/v1',
      api_key TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      max_tokens INTEGER NOT NULL DEFAULT 4096,
      temperature REAL NOT NULL DEFAULT 0.7,
      max_tool_iterations INTEGER NOT NULL DEFAULT 20,
      system_prompt TEXT NOT NULL DEFAULT 'You are min-agent, a concise and careful assistant.',
      context_limit INTEGER NOT NULL DEFAULT 0,
      tool_discovery TEXT NOT NULL DEFAULT 'ondemand',
      task_models JSONB NOT NULL DEFAULT '{}'::jsonb,
      pricing JSONB NOT NULL DEFAULT '{"inputPer1M":0,"outputPer1M":0}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      transport TEXT NOT NULL DEFAULT 'stdio',
      command TEXT NOT NULL DEFAULT '',
      args JSONB NOT NULL DEFAULT '[]'::jsonb,
      env JSONB NOT NULL DEFAULT '{}'::jsonb,
      url TEXT NOT NULL DEFAULT '',
      headers JSONB NOT NULL DEFAULT '{}'::jsonb,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New chat',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      model TEXT NOT NULL DEFAULT '',
      usage JSONB,
      loaded_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
      compaction JSONB,
      message_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      role TEXT NOT NULL,
      content JSONB,
      reasoning_content TEXT,
      tool_calls JSONB,
      tool_call_id TEXT,
      stats JSONB,
      followups JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS messages_session_idx ON messages (session_id, idx);

    -- The settings row is a singleton the UI edits in place, so it has to exist before the
    -- UI can load. Column defaults fill the rest in.
    INSERT INTO settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;
  `);
}
