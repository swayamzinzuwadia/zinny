CREATE TYPE "public"."pay_manual_invoice_status" AS ENUM('unpaid', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "batch_plan_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"day_number" integer NOT NULL,
	"topic" text,
	"start_time" time,
	"end_time" time,
	CONSTRAINT "plan_day_number" CHECK ("batch_plan_days"."day_number" >= 1),
	CONSTRAINT "plan_day_times" CHECK (("batch_plan_days"."start_time" is null and "batch_plan_days"."end_time" is null) or coalesce("batch_plan_days"."end_time" > "batch_plan_days"."start_time", false))
);
--> statement-breakpoint
CREATE TABLE "batch_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"faculty_user_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mkt_seat_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_invoice_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"default_gst_rate_bp" integer DEFAULT 1800 NOT NULL,
	"sac_code" text,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_invoice_categories_rate" CHECK ("pay_invoice_categories"."default_gst_rate_bp" in (0, 500, 1200, 1800, 2800)),
	CONSTRAINT "pay_invoice_categories_sac" CHECK ("pay_invoice_categories"."sac_code" is null or "pay_invoice_categories"."sac_code" ~ '^99[0-9]{2}([0-9]{2})?$'),
	CONSTRAINT "pay_invoice_categories_name" CHECK (char_length(btrim("pay_invoice_categories"."name")) between 2 and 60)
);
--> statement-breakpoint
CREATE TABLE "pay_manual_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"amount_paise" integer NOT NULL,
	CONSTRAINT "pay_manual_invoice_lines_qty" CHECK ("pay_manual_invoice_lines"."quantity" > 0),
	CONSTRAINT "pay_manual_invoice_lines_price" CHECK ("pay_manual_invoice_lines"."unit_price_paise" >= 0),
	CONSTRAINT "pay_manual_invoice_lines_amount" CHECK ("pay_manual_invoice_lines"."amount_paise" = "pay_manual_invoice_lines"."quantity" * "pay_manual_invoice_lines"."unit_price_paise")
);
--> statement-breakpoint
CREATE TABLE "pay_manual_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"number" text NOT NULL,
	"financial_year" text NOT NULL,
	"category_id" uuid,
	"user_id" uuid,
	"buyer_name" text NOT NULL,
	"buyer_email" text,
	"buyer_phone" text,
	"buyer_address" text,
	"buyer_gstin" text,
	"place_of_supply" text NOT NULL,
	"seller_name" text NOT NULL,
	"seller_gstin" text,
	"seller_address" text,
	"seller_state_code" text NOT NULL,
	"gst_applied" boolean NOT NULL,
	"gst_rate_bp" integer DEFAULT 0 NOT NULL,
	"sac_code" text,
	"subtotal_paise" integer NOT NULL,
	"discount_paise" integer DEFAULT 0 NOT NULL,
	"discount_note" text DEFAULT '' NOT NULL,
	"taxable_paise" integer NOT NULL,
	"cgst_paise" integer DEFAULT 0 NOT NULL,
	"sgst_paise" integer DEFAULT 0 NOT NULL,
	"igst_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" integer NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"notes" text DEFAULT '' NOT NULL,
	"status" "pay_manual_invoice_status" DEFAULT 'unpaid' NOT NULL,
	"paid_on" date,
	"payment_mode" text,
	"payment_reference" text,
	"payment_recorded_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_manual_invoices_number_len" CHECK (char_length("pay_manual_invoices"."number") <= 16),
	CONSTRAINT "pay_manual_invoices_amounts" CHECK ("pay_manual_invoices"."subtotal_paise" > 0 and "pay_manual_invoices"."discount_paise" >= 0 and "pay_manual_invoices"."discount_paise" <= "pay_manual_invoices"."subtotal_paise"),
	CONSTRAINT "pay_manual_invoices_taxable" CHECK ("pay_manual_invoices"."taxable_paise" = "pay_manual_invoices"."subtotal_paise" - "pay_manual_invoices"."discount_paise"),
	CONSTRAINT "pay_manual_invoices_total" CHECK ("pay_manual_invoices"."total_paise" = "pay_manual_invoices"."taxable_paise" + "pay_manual_invoices"."cgst_paise" + "pay_manual_invoices"."sgst_paise" + "pay_manual_invoices"."igst_paise"),
	CONSTRAINT "pay_manual_invoices_no_gst" CHECK ("pay_manual_invoices"."gst_applied" or ("pay_manual_invoices"."gst_rate_bp" = 0 and "pay_manual_invoices"."cgst_paise" + "pay_manual_invoices"."sgst_paise" + "pay_manual_invoices"."igst_paise" = 0)),
	CONSTRAINT "pay_manual_invoices_due" CHECK ("pay_manual_invoices"."due_date" is null or "pay_manual_invoices"."due_date" >= "pay_manual_invoices"."issue_date"),
	CONSTRAINT "pay_manual_invoices_mode" CHECK ("pay_manual_invoices"."payment_mode" is null or "pay_manual_invoices"."payment_mode" in ('cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other')),
	CONSTRAINT "pay_manual_invoices_paid" CHECK (("pay_manual_invoices"."status" = 'paid') = ("pay_manual_invoices"."paid_on" is not null and "pay_manual_invoices"."payment_mode" is not null)),
	CONSTRAINT "pay_manual_invoices_cancelled" CHECK (("pay_manual_invoices"."status" = 'cancelled') = ("pay_manual_invoices"."cancel_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "plat_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_paise" integer NOT NULL,
	"billing_months" integer NOT NULL,
	"student_cap" integer NOT NULL,
	"staff_cap" integer NOT NULL,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gst_rate_bp" integer DEFAULT 1800 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "plat_plan_price" CHECK ("plat_plans"."price_paise" >= 0),
	CONSTRAINT "plat_plan_months" CHECK ("plat_plans"."billing_months" between 1 and 120),
	CONSTRAINT "plat_plan_caps" CHECK ("plat_plans"."student_cap" > 0 and "plat_plans"."staff_cap" > 0)
);
--> statement-breakpoint
ALTER TABLE "mkt_listings" DROP CONSTRAINT "mkt_listing_kind";--> statement-breakpoint
ALTER TABLE "mkt_listings" DROP CONSTRAINT "mkt_listing_status";--> statement-breakpoint
DROP INDEX "mkt_listings_course_uq";--> statement-breakpoint
ALTER TABLE "plat_licences" ALTER COLUMN "plan" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "incharge_user_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "impersonator_user_id" uuid;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "gst_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mkt_listings" ADD COLUMN "late_join" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plat_invoices" ADD COLUMN "list_price_paise" integer;--> statement-breakpoint
ALTER TABLE "plat_invoices" ADD COLUMN "discount_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plat_invoices" ADD COLUMN "discount_note" text;--> statement-breakpoint
ALTER TABLE "plat_invoices" ADD COLUMN "licence_id" uuid;--> statement-breakpoint
ALTER TABLE "plat_invoices" ADD COLUMN "revised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plat_invoices" ADD COLUMN "revised_by" uuid;--> statement-breakpoint
ALTER TABLE "plat_licences" ADD COLUMN "price_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plat_licences" ADD COLUMN "discount_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plat_licences" ADD COLUMN "discount_note" text;--> statement-breakpoint
ALTER TABLE "batch_plan_days" ADD CONSTRAINT "batch_plan_days_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_plan_days" ADD CONSTRAINT "batch_plan_days_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_plan_days" ADD CONSTRAINT "batch_plan_days_section_id_batch_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."batch_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_sections" ADD CONSTRAINT "batch_sections_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_sections" ADD CONSTRAINT "batch_sections_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_sections" ADD CONSTRAINT "batch_sections_faculty_user_id_users_id_fk" FOREIGN KEY ("faculty_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_seat_sales" ADD CONSTRAINT "mkt_seat_sales_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_seat_sales" ADD CONSTRAINT "mkt_seat_sales_listing_id_mkt_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."mkt_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_seat_sales" ADD CONSTRAINT "mkt_seat_sales_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_invoice_categories" ADD CONSTRAINT "pay_invoice_categories_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_invoice_categories" ADD CONSTRAINT "pay_invoice_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_manual_invoice_lines" ADD CONSTRAINT "pay_manual_invoice_lines_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_manual_invoice_lines" ADD CONSTRAINT "pay_manual_invoice_lines_invoice_id_pay_manual_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."pay_manual_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_manual_invoices" ADD CONSTRAINT "pay_manual_invoices_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_manual_invoices" ADD CONSTRAINT "pay_manual_invoices_category_id_pay_invoice_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."pay_invoice_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_manual_invoices" ADD CONSTRAINT "pay_manual_invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_manual_invoices" ADD CONSTRAINT "pay_manual_invoices_payment_recorded_by_users_id_fk" FOREIGN KEY ("payment_recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_manual_invoices" ADD CONSTRAINT "pay_manual_invoices_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_manual_invoices" ADD CONSTRAINT "pay_manual_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_plans" ADD CONSTRAINT "plat_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_plan_days_section_day_uq" ON "batch_plan_days" USING btree ("section_id","day_number");--> statement-breakpoint
CREATE INDEX "batch_plan_days_batch_idx" ON "batch_plan_days" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "batch_sections_batch_idx" ON "batch_sections" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mkt_seat_sales_order_uq" ON "mkt_seat_sales" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "mkt_seat_sales_listing_idx" ON "mkt_seat_sales" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_invoice_categories_name_uq" ON "pay_invoice_categories" USING btree ("university_id",lower("name")) WHERE "pay_invoice_categories"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "pay_manual_invoice_lines_invoice_idx" ON "pay_manual_invoice_lines" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_manual_invoices_number_uq" ON "pay_manual_invoices" USING btree ("university_id","number");--> statement-breakpoint
CREATE INDEX "pay_manual_invoices_list_idx" ON "pay_manual_invoices" USING btree ("university_id","issue_date");--> statement-breakpoint
CREATE INDEX "pay_manual_invoices_user_idx" ON "pay_manual_invoices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plat_plans_key_uq" ON "plat_plans" USING btree ("key");--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_incharge_user_id_users_id_fk" FOREIGN KEY ("incharge_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_impersonator_user_id_users_id_fk" FOREIGN KEY ("impersonator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_invoices" ADD CONSTRAINT "plat_invoices_licence_id_plat_licences_id_fk" FOREIGN KEY ("licence_id") REFERENCES "public"."plat_licences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_invoices" ADD CONSTRAINT "plat_invoices_revised_by_users_id_fk" FOREIGN KEY ("revised_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mkt_listings_batch_uq" ON "mkt_listings" USING btree ("batch_id") WHERE "mkt_listings"."status" <> 'removed';--> statement-breakpoint
CREATE INDEX "mkt_listings_course_idx" ON "mkt_listings" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "plat_invoices_licence_idx" ON "plat_invoices" USING btree ("licence_id");--> statement-breakpoint
ALTER TABLE "mkt_listings" ADD CONSTRAINT "mkt_listing_kinds" CHECK ("mkt_listings"."kind" in ('course', 'lecture', 'combo', 'batch'));--> statement-breakpoint
ALTER TABLE "mkt_listings" ADD CONSTRAINT "mkt_listing_statuses" CHECK ("mkt_listings"."status" in ('live', 'paused', 'removed'));--> statement-breakpoint
ALTER TABLE "plat_invoices" ADD CONSTRAINT "plat_invoice_discount" CHECK ("plat_invoices"."discount_paise" >= 0 and ("plat_invoices"."list_price_paise" is null or "plat_invoices"."list_price_paise" = "plat_invoices"."base_paise" + "plat_invoices"."discount_paise"));--> statement-breakpoint
ALTER TABLE "plat_licences" ADD CONSTRAINT "plat_licence_price" CHECK ("plat_licences"."price_paise" >= 0 and "plat_licences"."discount_paise" >= 0 and "plat_licences"."discount_paise" <= "plat_licences"."price_paise");