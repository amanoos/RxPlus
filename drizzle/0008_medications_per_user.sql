-- Start fresh (SPEC-per-user-medications.md): existing medications have no owner.
DELETE FROM "medications";--> statement-breakpoint
DROP INDEX "medications_active_rxcui_idx";--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "medications_user_id_idx" ON "medications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "medications_active_rxcui_idx" ON "medications" USING btree ("user_id","rxcui") WHERE "medications"."stopped_on" is null;