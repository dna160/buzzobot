CREATE TABLE "market_scope_accounts" (
	"ttms_account_id" text PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"brand_name" text NOT NULL,
	"vertical" text,
	"region_code" text,
	"plan" text,
	"is_lite" boolean DEFAULT true NOT NULL,
	"unavailable_metrics" text[] DEFAULT '{}'::text[] NOT NULL,
	"linked_advertiser_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"last_data_date" date,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_scope_audience_daily" (
	"ttms_account_id" text NOT NULL,
	"date" date NOT NULL,
	"stage" text NOT NULL,
	"brand_total" bigint,
	"brand_new" bigint,
	"brand_outflow" bigint,
	"brand_ranking" integer,
	"total_brand_count" integer,
	"bench_total_top5" double precision,
	"bench_total_top10" double precision,
	"bench_total_top25" double precision,
	"bench_total_top50" double precision,
	"bench_new_top5" double precision,
	"bench_new_top10" double precision,
	"bench_new_top25" double precision,
	"bench_new_top50" double precision,
	"bench_outflow_top5" double precision,
	"bench_outflow_top10" double precision,
	"bench_outflow_top25" double precision,
	"bench_outflow_top50" double precision,
	CONSTRAINT "ms_audience_daily_pk" PRIMARY KEY("ttms_account_id","date","stage")
);
--> statement-breakpoint
CREATE TABLE "market_scope_insights_daily" (
	"ttms_account_id" text NOT NULL,
	"date" date NOT NULL,
	"metric" text NOT NULL,
	"content_type" text NOT NULL,
	"brand_value" double precision,
	"brand_share" double precision,
	"bench_value_top5" double precision,
	"bench_value_top10" double precision,
	"bench_value_top25" double precision,
	"bench_value_top50" double precision,
	"bench_share_top5" double precision,
	"bench_share_top10" double precision,
	"bench_share_top25" double precision,
	"bench_share_top50" double precision,
	CONSTRAINT "ms_insights_daily_pk" PRIMARY KEY("ttms_account_id","date","metric","content_type")
);
--> statement-breakpoint
CREATE TABLE "market_scope_rankings_daily" (
	"ttms_account_id" text NOT NULL,
	"date" date NOT NULL,
	"stage" text NOT NULL,
	"brand" text NOT NULL,
	"ranking" integer NOT NULL,
	CONSTRAINT "ms_rankings_daily_pk" PRIMARY KEY("ttms_account_id","date","stage","brand")
);
--> statement-breakpoint
ALTER TABLE "market_scope_accounts" ADD CONSTRAINT "market_scope_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_scope_audience_daily" ADD CONSTRAINT "ms_audience_daily_account_fk" FOREIGN KEY ("ttms_account_id") REFERENCES "public"."market_scope_accounts"("ttms_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_scope_insights_daily" ADD CONSTRAINT "ms_insights_daily_account_fk" FOREIGN KEY ("ttms_account_id") REFERENCES "public"."market_scope_accounts"("ttms_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_scope_rankings_daily" ADD CONSTRAINT "ms_rankings_daily_account_fk" FOREIGN KEY ("ttms_account_id") REFERENCES "public"."market_scope_accounts"("ttms_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_scope_accounts_client_idx" ON "market_scope_accounts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "market_scope_rankings_stage_date_idx" ON "market_scope_rankings_daily" USING btree ("ttms_account_id","stage","date");