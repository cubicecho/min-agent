CREATE TABLE "mcp_servers" (
	"id" text PRIMARY KEY,
	"label" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"transport" text DEFAULT 'stdio' NOT NULL,
	"command" text DEFAULT '' NOT NULL,
	"args" jsonb DEFAULT '[]' NOT NULL,
	"env" jsonb DEFAULT '{}' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"headers" jsonb DEFAULT '{}' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"idx" integer NOT NULL,
	"role" text NOT NULL,
	"content" jsonb,
	"reasoning_content" text,
	"tool_calls" jsonb,
	"tool_call_id" text,
	"stats" jsonb,
	"followups" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY,
	"title" text DEFAULT 'New chat' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"usage" jsonb,
	"loaded_tools" jsonb DEFAULT '[]' NOT NULL,
	"compaction" jsonb,
	"message_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY DEFAULT 'default',
	"base_url" text DEFAULT 'http://localhost:11434/v1' NOT NULL,
	"api_key" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"max_tokens" integer DEFAULT 4096 NOT NULL,
	"temperature" real DEFAULT 0.7 NOT NULL,
	"max_tool_iterations" integer DEFAULT 20 NOT NULL,
	"system_prompt" text DEFAULT 'You are min-agent, a concise and careful assistant.' NOT NULL,
	"context_limit" integer DEFAULT 0 NOT NULL,
	"tool_discovery" text DEFAULT 'ondemand' NOT NULL,
	"task_models" jsonb DEFAULT '{}' NOT NULL,
	"pricing" jsonb DEFAULT '{"inputPer1M":0,"outputPer1M":0}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "messages_session_idx" ON "messages" ("session_id","idx");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;