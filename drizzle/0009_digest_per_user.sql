-- Start fresh (SPEC-per-user-digest.md): existing digests and label baselines have no owner.
DELETE FROM "digest_label_versions";--> statement-breakpoint
DELETE FROM "digests";--> statement-breakpoint
DROP INDEX "digests_one_running";--> statement-breakpoint
ALTER TABLE "digest_label_versions" DROP CONSTRAINT "digest_label_versions_pkey";--> statement-breakpoint
ALTER TABLE "digest_label_versions" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "digests" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_label_versions" ADD CONSTRAINT "digest_label_versions_user_id_product_rxcui_pk" PRIMARY KEY("user_id","product_rxcui");--> statement-breakpoint
ALTER TABLE "digest_label_versions" ADD CONSTRAINT "digest_label_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "digests_user_id_idx" ON "digests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "digests_one_running" ON "digests" USING btree ("user_id") WHERE "digests"."status" = 'running';
