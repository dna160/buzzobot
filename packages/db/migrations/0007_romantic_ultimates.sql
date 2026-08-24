CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"objective" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"tier" text NOT NULL,
	"run_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"artifact_path" text,
	"artifact_bytes" integer,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_runs_lookup_idx" ON "report_runs" USING btree ("client_id","objective","period_end");--> statement-breakpoint
CREATE INDEX "report_runs_status_idx" ON "report_runs" USING btree ("status");