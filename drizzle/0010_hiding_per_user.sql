-- Hides become per user (SPEC-per-user-hiding.md). Existing alternative hides have no owner.
DELETE FROM "alternative_hidden";--> statement-breakpoint
CREATE TABLE "literature_hidden" (
	"user_id" uuid NOT NULL,
	"ingredient_rxcui" text NOT NULL,
	"pmid" text NOT NULL,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "literature_hidden_user_id_ingredient_rxcui_pmid_pk" PRIMARY KEY("user_id","ingredient_rxcui","pmid")
);
--> statement-breakpoint
ALTER TABLE "alternative_hidden" DROP CONSTRAINT "alternative_hidden_ingredient_rxcui_hidden_rxcui_pk";--> statement-breakpoint
ALTER TABLE "alternative_hidden" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "alternative_hidden" ADD CONSTRAINT "alternative_hidden_user_id_ingredient_rxcui_hidden_rxcui_pk" PRIMARY KEY("user_id","ingredient_rxcui","hidden_rxcui");--> statement-breakpoint
ALTER TABLE "literature_hidden" ADD CONSTRAINT "literature_hidden_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alternative_hidden" ADD CONSTRAINT "alternative_hidden_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "literature_papers" DROP COLUMN "hidden_at";
