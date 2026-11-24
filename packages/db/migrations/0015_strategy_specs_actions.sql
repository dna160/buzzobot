CREATE TABLE "strategy_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"action_json" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"accepted_by" text,
	"started_at" date,
	"measured_value" double precision,
	"category_delta" double precision,
	"measured_run_id" text,
	"measured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_actions_status_ck" CHECK ("strategy_actions"."status" IN ('proposed', 'running', 'worked', 'weak', 'failed', 'snoozed'))
);
--> statement-breakpoint
CREATE TABLE "strategy_specs" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"ttms_account_id" text,
	"report_class_override" text,
	"goal_kind" text,
	"goal_stage" text,
	"goal_metric" text,
	"goal_value" double precision,
	"goal_deadline" date,
	"creator_fee_monthly" double precision,
	"bgc_cost_monthly" double precision,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_specs_class_ck" CHECK ("strategy_specs"."report_class_override" IN ('brand', 'shop')),
	CONSTRAINT "strategy_specs_goal_kind_ck" CHECK ("strategy_specs"."goal_kind" IN ('rank', 'share', 'size_ratio', 'cost_per_new')),
	CONSTRAINT "strategy_specs_goal_stage_ck" CHECK ("strategy_specs"."goal_stage" IN ('acc', 'awareness', 'consideration', 'conversion'))
);
--> statement-breakpoint
ALTER TABLE "strategy_actions" ADD CONSTRAINT "strategy_actions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_specs" ADD CONSTRAINT "strategy_specs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_specs" ADD CONSTRAINT "strategy_specs_ttms_account_fk" FOREIGN KEY ("ttms_account_id") REFERENCES "public"."market_scope_accounts"("ttms_account_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strategy_actions_client_status_idx" ON "strategy_actions" USING btree ("client_id","status");