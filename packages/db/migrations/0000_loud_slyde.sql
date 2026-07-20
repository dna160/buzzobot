CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agencies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"objective" text NOT NULL,
	"status" text NOT NULL,
	"daily_budget" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"brand_color" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organic_daily_metrics" (
	"date" date NOT NULL,
	"video_id" uuid NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"watch_time_sec" double precision DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"new_followers" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "organic_daily_metrics_date_video_id_pk" PRIMARY KEY("date","video_id")
);
--> statement-breakpoint
CREATE TABLE "paid_daily_metrics" (
	"date" date NOT NULL,
	"campaign_id" uuid NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"conversion_value" double precision DEFAULT 0 NOT NULL,
	"video_views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "paid_daily_metrics_date_campaign_id_pk" PRIMARY KEY("date","campaign_id")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"surface" text NOT NULL,
	"status" text NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"rows_ingested" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"is_backfill" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tiktok_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"surface" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"username" text,
	"avatar_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"thumbnail_url" text,
	"share_url" text,
	"duration_sec" double precision DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_account_id_tiktok_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."tiktok_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organic_daily_metrics" ADD CONSTRAINT "organic_daily_metrics_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paid_daily_metrics" ADD CONSTRAINT "paid_daily_metrics_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_account_id_tiktok_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."tiktok_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_accounts" ADD CONSTRAINT "tiktok_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_account_id_tiktok_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."tiktok_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_account_external_uq" ON "campaigns" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_agency_slug_uq" ON "clients" USING btree ("agency_id","slug");--> statement-breakpoint
CREATE INDEX "organic_metrics_video_idx" ON "organic_daily_metrics" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "paid_metrics_campaign_idx" ON "paid_daily_metrics" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "sync_runs_account_idx" ON "sync_runs" USING btree ("account_id","started_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_surface_external_uq" ON "tiktok_accounts" USING btree ("surface","external_id");--> statement-breakpoint
CREATE INDEX "accounts_client_idx" ON "tiktok_accounts" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "videos_account_external_uq" ON "videos" USING btree ("account_id","external_id");