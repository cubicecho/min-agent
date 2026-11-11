ALTER TABLE "messages" ADD COLUMN "reasoning_field" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reasoning_details" jsonb;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "reasoning_replay" text DEFAULT 'all' NOT NULL;