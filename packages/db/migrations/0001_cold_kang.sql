CREATE TABLE "adgroups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paid_hourly_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"hour" integer NOT NULL,
	"campaign_id" uuid NOT NULL,
	"adgroup_id" uuid,
	"spend" double precision DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"video_views" integer DEFAULT 0 NOT NULL,
	"engagements" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"follows" integer DEFAULT 0 NOT NULL,
	"profile_visits" integer DEFAULT 0 NOT NULL,
	"span_hours" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adgroups" ADD CONSTRAINT "adgroups_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paid_hourly_metrics" ADD CONSTRAINT "paid_hourly_metrics_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paid_hourly_metrics" ADD CONSTRAINT "paid_hourly_metrics_adgroup_id_adgroups_id_fk" FOREIGN KEY ("adgroup_id") REFERENCES "public"."adgroups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "adgroups_campaign_external_uq" ON "adgroups" USING btree ("campaign_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paid_hourly_campaign_uq" ON "paid_hourly_metrics" USING btree ("date","hour","campaign_id") WHERE "paid_hourly_metrics"."adgroup_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "paid_hourly_adgroup_uq" ON "paid_hourly_metrics" USING btree ("date","hour","campaign_id","adgroup_id") WHERE "paid_hourly_metrics"."adgroup_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "paid_hourly_campaign_idx" ON "paid_hourly_metrics" USING btree ("campaign_id","date");