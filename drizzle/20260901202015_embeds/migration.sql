CREATE TABLE "embeds" (
	"id" text PRIMARY KEY,
	"label" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT 'grid' NOT NULL,
	"mode" text DEFAULT 'iframe' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
