CREATE TABLE "drug_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rxcui" text NOT NULL,
	"label_set_id" text NOT NULL,
	"label_version" text NOT NULL,
	"label_effective_date" date,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"sections" jsonb,
	"sentence_count" integer,
	"uncited_count" integer,
	"removed_advice" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "drug_summaries_label_idx" ON "drug_summaries" USING btree ("rxcui","label_set_id","label_version");