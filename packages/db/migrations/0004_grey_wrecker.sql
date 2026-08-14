ALTER TABLE "clients" ADD COLUMN "north_star" text DEFAULT 'vtr' NOT NULL;--> statement-breakpoint
ALTER TABLE "paid_hourly_metrics" ADD COLUMN "conversions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paid_hourly_metrics" ADD COLUMN "conversion_value" double precision DEFAULT 0 NOT NULL;