ALTER TABLE "medications" ADD COLUMN "units_per_month" numeric(6, 1) DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "copay_cents" integer;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "copay_units" numeric(6, 1);