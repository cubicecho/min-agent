ALTER TABLE "sessions" ADD COLUMN "transcript" jsonb;--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "compaction";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "pruning";--> statement-breakpoint
-- The ledger was indexed into the messages; it is indexed into the transcript now, which starts empty.
UPDATE "sessions" SET "ledger" = '[]'::jsonb;
--> statement-breakpoint
-- agent-core 6 and agent-mcp-pool 4 name the hook events after the exchange, not the turn.
UPDATE "mcp_servers" SET "hooks" = (
  SELECT coalesce(jsonb_agg(CASE hook->>'on'
    WHEN 'beforeTurn' THEN jsonb_set(hook, '{on}', '"beforeExchange"')
    WHEN 'afterTurn' THEN jsonb_set(hook, '{on}', '"afterExchange"')
    ELSE hook END ORDER BY at), '[]'::jsonb)
  FROM jsonb_array_elements("hooks") WITH ORDINALITY AS each(hook, at)
);
