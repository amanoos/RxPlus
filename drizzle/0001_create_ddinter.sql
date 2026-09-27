CREATE TABLE "ddi_drugs" (
	"ddinter_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"route" text,
	"ingredient_rxcui" text
);
--> statement-breakpoint
CREATE TABLE "ddi_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pairs" integer NOT NULL,
	"drugs" integer NOT NULL,
	"mapped_drugs" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ddi_interactions" (
	"drug_a" text NOT NULL,
	"drug_b" text NOT NULL,
	"level" text NOT NULL,
	CONSTRAINT "ddi_interactions_drug_a_drug_b_pk" PRIMARY KEY("drug_a","drug_b")
);
--> statement-breakpoint
CREATE INDEX "ddi_drugs_ingredient_idx" ON "ddi_drugs" USING btree ("ingredient_rxcui");--> statement-breakpoint
CREATE INDEX "ddi_interactions_b_idx" ON "ddi_interactions" USING btree ("drug_b");