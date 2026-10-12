CREATE TABLE "brand_industry_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tiktok_ad_account_id" text NOT NULL,
	"name" text NOT NULL,
	"industry" text NOT NULL,
	"confidence" text NOT NULL,
	"source" text DEFAULT 'claude-categorized' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "brand_industry_tags_account_uq" ON "brand_industry_tags" USING btree ("tiktok_ad_account_id");--> statement-breakpoint
CREATE INDEX "brand_industry_tags_industry_idx" ON "brand_industry_tags" USING btree ("industry");