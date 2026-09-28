CREATE TABLE "alternative_drugs" (
	"list_key" text NOT NULL,
	"ingredient_rxcui" text NOT NULL,
	"name" text NOT NULL,
	"class_id" text,
	"class_name" text,
	"first_approved" date,
	"generic_available" boolean NOT NULL,
	"product_rxcui" text,
	CONSTRAINT "alternative_drugs_list_key_ingredient_rxcui_pk" PRIMARY KEY("list_key","ingredient_rxcui")
);
--> statement-breakpoint
CREATE TABLE "alternative_hidden" (
	"ingredient_rxcui" text NOT NULL,
	"hidden_rxcui" text NOT NULL,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alternative_hidden_ingredient_rxcui_hidden_rxcui_pk" PRIMARY KEY("ingredient_rxcui","hidden_rxcui")
);
--> statement-breakpoint
CREATE TABLE "alternative_lists" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"built_at" timestamp with time zone,
	"skipped" integer,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "taken_for_id" text;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "taken_for_name" text;