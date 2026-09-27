CREATE TABLE "literature_lists" (
	"ingredient_rxcui" text PRIMARY KEY NOT NULL,
	"ingredient_name" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"takeaway_status" text DEFAULT 'none' NOT NULL,
	"provider" text,
	"model" text,
	"error" text,
	"started_at" timestamp with time zone,
	"input_tokens" integer,
	"output_tokens" integer
);
--> statement-breakpoint
CREATE TABLE "literature_papers" (
	"ingredient_rxcui" text NOT NULL,
	"pmid" text NOT NULL,
	"tier" text NOT NULL,
	"rank" integer NOT NULL,
	"title" text NOT NULL,
	"journal" text,
	"year" integer,
	"pub_types" jsonb NOT NULL,
	"study_type" text NOT NULL,
	"doi" text,
	"pmcid" text,
	"abstract" text NOT NULL,
	"takeaway" jsonb,
	"hidden_at" timestamp with time zone,
	CONSTRAINT "literature_papers_ingredient_rxcui_pmid_pk" PRIMARY KEY("ingredient_rxcui","pmid")
);
--> statement-breakpoint
CREATE TABLE "literature_trials" (
	"ingredient_rxcui" text NOT NULL,
	"nct_id" text NOT NULL,
	"rank" integer NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"phases" jsonb NOT NULL,
	"has_results" boolean NOT NULL,
	"start_date" text,
	"last_update" text,
	CONSTRAINT "literature_trials_ingredient_rxcui_nct_id_pk" PRIMARY KEY("ingredient_rxcui","nct_id")
);
