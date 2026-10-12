CREATE TABLE "report_benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"objective" text NOT NULL,
	"metric" text NOT NULL,
	"target_value" double precision NOT NULL,
	"comparison_direction" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"period_start" date,
	"period_end" date,
	"status" text DEFAULT 'running' NOT NULL,
	"artifact_path" text,
	"artifact_bytes" integer,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "report_benchmarks" ADD CONSTRAINT "report_benchmarks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_report_runs" ADD CONSTRAINT "template_report_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_benchmarks_client_obj_metric_uq" ON "report_benchmarks" USING btree ("client_id","objective","metric");--> statement-breakpoint
CREATE INDEX "template_report_runs_lookup_idx" ON "template_report_runs" USING btree ("client_id","period_end");