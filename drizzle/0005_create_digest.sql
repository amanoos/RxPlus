CREATE TABLE "digest_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"digest_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"ingredient_rxcui" text,
	"product_rxcui" text,
	"condition_id" text,
	"subject" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"details" jsonb,
	"takeaway" jsonb,
	"external_id" text,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "digest_label_versions" (
	"product_rxcui" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"version" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"trigger" text NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"notes" jsonb
);
--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_digest_id_digests_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."digests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "digest_items_digest" ON "digest_items" USING btree ("digest_id");--> statement-breakpoint
CREATE INDEX "digest_items_external" ON "digest_items" USING btree ("kind","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "digests_one_running" ON "digests" USING btree ("status") WHERE "digests"."status" = 'running';