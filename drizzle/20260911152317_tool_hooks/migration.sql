ALTER TABLE "mcp_servers" ADD COLUMN "hidden_tools" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "hooks" jsonb DEFAULT '[]' NOT NULL;