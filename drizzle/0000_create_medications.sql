CREATE TABLE "medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rxcui" text NOT NULL,
	"tty" text NOT NULL,
	"name" text NOT NULL,
	"strength" text,
	"dose_form" text,
	"brand_name" text,
	"ingredients" jsonb NOT NULL,
	"notes" text,
	"started_on" date,
	"stopped_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "medications_active_rxcui_idx" ON "medications" USING btree ("rxcui") WHERE "medications"."stopped_on" is null;