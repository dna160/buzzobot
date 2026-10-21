CREATE TABLE "report_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "template_report_runs" ADD COLUMN "template" text DEFAULT 'shop' NOT NULL;--> statement-breakpoint
ALTER TABLE "template_report_runs" ADD COLUMN "benchmark_mode" text DEFAULT 'industry' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_links" ADD CONSTRAINT "report_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_links_token_uq" ON "report_links" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "report_links_client_active_uq" ON "report_links" USING btree ("client_id") WHERE "report_links"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "template_report_runs_running_uq" ON "template_report_runs" USING btree ("client_id","template","benchmark_mode","period_start","period_end") WHERE "template_report_runs"."status" = 'running';