CREATE TABLE "market_scope_links" (
	"ttms_account_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_scope_links_pk" PRIMARY KEY("ttms_account_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "market_scope_accounts" DROP CONSTRAINT "market_scope_accounts_client_id_clients_id_fk";
--> statement-breakpoint
DROP INDEX "market_scope_accounts_client_idx";--> statement-breakpoint
ALTER TABLE "market_scope_links" ADD CONSTRAINT "ms_links_account_fk" FOREIGN KEY ("ttms_account_id") REFERENCES "public"."market_scope_accounts"("ttms_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_scope_links" ADD CONSTRAINT "ms_links_client_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_scope_links_client_idx" ON "market_scope_links" USING btree ("client_id");--> statement-breakpoint
-- Carry every existing link over before the columns go: one account, one client, its primary flag.
INSERT INTO "market_scope_links" ("ttms_account_id", "client_id", "is_primary")
SELECT "ttms_account_id", "client_id", "is_primary" FROM "market_scope_accounts" WHERE "client_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "market_scope_accounts" DROP COLUMN "client_id";--> statement-breakpoint
ALTER TABLE "market_scope_accounts" DROP COLUMN "is_primary";