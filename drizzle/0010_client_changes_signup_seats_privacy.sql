CREATE TYPE "public"."onb_document_kind" AS ENUM('pan', 'partnership_deed', 'moa', 'aoa', 'gst_certificate', 'registration');--> statement-breakpoint
CREATE TYPE "public"."onb_document_status" AS ENUM('uploading', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."onb_plan_order_status" AS ENUM('created', 'paid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."dpdp_breach_status" AS ENUM('open', 'contained', 'closed');--> statement-breakpoint
CREATE TYPE "public"."dpdp_guardian_status" AS ENUM('pending', 'verified', 'refused');--> statement-breakpoint
CREATE TYPE "public"."dpdp_purpose" AS ENUM('account', 'service', 'kyc', 'marketing', 'analytics', 'guardian');--> statement-breakpoint
CREATE TYPE "public"."dpdp_request_kind" AS ENUM('access', 'correction', 'erasure', 'nomination', 'grievance');--> statement-breakpoint
CREATE TYPE "public"."dpdp_request_status" AS ENUM('open', 'in_progress', 'completed', 'refused');--> statement-breakpoint
CREATE TYPE "public"."dpdp_retention_action" AS ENUM('flag', 'anonymise');--> statement-breakpoint
CREATE TABLE "onb_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"kind" "onb_document_kind" NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"status" "onb_document_status" DEFAULT 'uploading' NOT NULL,
	"reviewer_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "onb_documents_size" CHECK ("onb_documents"."size_bytes" > 0 and "onb_documents"."size_bytes" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "onb_plan_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"plan_key" text NOT NULL,
	"plan_name" text NOT NULL,
	"base_paise" integer NOT NULL,
	"gst_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"gateway" text NOT NULL,
	"gateway_order_id" text NOT NULL,
	"gateway_payment_id" text,
	"status" "onb_plan_order_status" DEFAULT 'created' NOT NULL,
	"licence_id" uuid,
	"invoice_number" text,
	"paid_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onb_plan_orders_money" CHECK ("onb_plan_orders"."base_paise" >= 0 and "onb_plan_orders"."gst_paise" >= 0 and "onb_plan_orders"."total_paise" = "onb_plan_orders"."base_paise" + "onb_plan_orders"."gst_paise")
);
--> statement-breakpoint
CREATE TABLE "onb_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"institute_type" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text NOT NULL,
	"city" text NOT NULL,
	"source" text DEFAULT 'signup' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "onb_student_kyc" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"pan_cipher" text NOT NULL,
	"pan_masked" text NOT NULL,
	"aadhaar_last4" text,
	"consent_at" timestamp with time zone NOT NULL,
	"consent_notice_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onb_student_kyc_aadhaar" CHECK ("onb_student_kyc"."aadhaar_last4" is null or "onb_student_kyc"."aadhaar_last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "dpdp_breaches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"occurred_at" timestamp with time zone,
	"affected_institutes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_categories" text DEFAULT '' NOT NULL,
	"principals_affected" integer,
	"status" "dpdp_breach_status" DEFAULT 'open' NOT NULL,
	"board_intimated_at" timestamp with time zone,
	"board_report_at" timestamp with time zone,
	"principals_notified_at" timestamp with time zone,
	"measures" text DEFAULT '' NOT NULL,
	"extension_granted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid,
	"user_id" uuid NOT NULL,
	"purpose" "dpdp_purpose" NOT NULL,
	"notice_version" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"source" text NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp_guardian_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid,
	"user_id" uuid NOT NULL,
	"birth_date" date,
	"guardian_name" text NOT NULL,
	"guardian_email" text,
	"guardian_phone" text,
	"method" text DEFAULT 'link' NOT NULL,
	"token_hash" text NOT NULL,
	"status" "dpdp_guardian_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dpdp_guardian_contact" CHECK ("dpdp_guardian_consents"."guardian_email" is not null or "dpdp_guardian_consents"."guardian_phone" is not null)
);
--> statement-breakpoint
CREATE TABLE "dpdp_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid,
	"user_id" uuid NOT NULL,
	"kind" "dpdp_request_kind" NOT NULL,
	"status" "dpdp_request_status" DEFAULT 'open' NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"due_on" date NOT NULL,
	"response" text,
	"handled_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp_retention_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"flagged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dpdp_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"inactive_days" integer DEFAULT 1095 NOT NULL,
	"retention_action" "dpdp_retention_action" DEFAULT 'flag' NOT NULL,
	"grievance_name" text,
	"grievance_email" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dpdp_settings_days" CHECK ("dpdp_settings"."inactive_days" between 180 and 3650)
);
--> statement-breakpoint
CREATE TABLE "plat_billing_settings" (
	"id" text PRIMARY KEY DEFAULT 'zinny' NOT NULL,
	"payment_days" integer DEFAULT 15 NOT NULL,
	"renewal_lead_days" integer DEFAULT 15 NOT NULL,
	"auto_renew_default" boolean DEFAULT true NOT NULL,
	"keep_discount_on_renewal" boolean DEFAULT true NOT NULL,
	"reminders_on" boolean DEFAULT true NOT NULL,
	"remind_days_before" integer DEFAULT 3 NOT NULL,
	"remind_on_due_date" boolean DEFAULT true NOT NULL,
	"remind_every_days_after" integer DEFAULT 7 NOT NULL,
	"max_overdue_reminders" integer DEFAULT 3 NOT NULL,
	"student_pack_size" integer DEFAULT 25 NOT NULL,
	"student_pack_price_paise" integer DEFAULT 250000 NOT NULL,
	"staff_pack_size" integer DEFAULT 5 NOT NULL,
	"staff_pack_price_paise" integer DEFAULT 300000 NOT NULL,
	"packs_updated_at" timestamp with time zone,
	"packs_updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "plat_billing_settings_one_row" CHECK ("plat_billing_settings"."id" = 'zinny'),
	CONSTRAINT "plat_billing_settings_days" CHECK ("plat_billing_settings"."payment_days" between 0 and 180 and "plat_billing_settings"."renewal_lead_days" between 1 and 90),
	CONSTRAINT "plat_billing_settings_reminders" CHECK ("plat_billing_settings"."remind_days_before" between 0 and 30 and "plat_billing_settings"."remind_every_days_after" between 1 and 60 and "plat_billing_settings"."max_overdue_reminders" between 0 and 10),
	CONSTRAINT "plat_billing_settings_packs" CHECK ("plat_billing_settings"."student_pack_size" > 0 and "plat_billing_settings"."staff_pack_size" > 0 and "plat_billing_settings"."student_pack_price_paise" >= 0 and "plat_billing_settings"."staff_pack_price_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "plat_seat_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"licence_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"packs_bought" integer NOT NULL,
	"packs" integer NOT NULL,
	"seats_per_pack" integer NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"charged_paise" integer DEFAULT 0 NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"invoice_id" uuid,
	"source" text NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plat_seat_pack_kind" CHECK ("plat_seat_packs"."kind" in ('student', 'staff')),
	CONSTRAINT "plat_seat_pack_source" CHECK ("plat_seat_packs"."source" in ('institute', 'zinny')),
	CONSTRAINT "plat_seat_pack_counts" CHECK ("plat_seat_packs"."packs_bought" > 0 and "plat_seat_packs"."packs" >= 0 and "plat_seat_packs"."packs" <= "plat_seat_packs"."packs_bought" and "plat_seat_packs"."seats_per_pack" > 0),
	CONSTRAINT "plat_seat_pack_money" CHECK ("plat_seat_packs"."unit_price_paise" >= 0 and "plat_seat_packs"."charged_paise" >= 0),
	CONSTRAINT "plat_seat_pack_period" CHECK ("plat_seat_packs"."period_end" >= "plat_seat_packs"."period_start")
);
--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "trial_ends_at" date;--> statement-breakpoint
ALTER TABLE "plat_invoices" ADD COLUMN "reminder_stage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plat_invoices" ADD COLUMN "last_reminder_on" date;--> statement-breakpoint
ALTER TABLE "plat_licences" ADD COLUMN "auto_renew" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "plat_licences" ADD COLUMN "end_reminder_for" date;--> statement-breakpoint
ALTER TABLE "plat_licences" ADD COLUMN "end_reminder_days" integer;--> statement-breakpoint
ALTER TABLE "plat_plans" ADD COLUMN "student_pack_size" integer;--> statement-breakpoint
ALTER TABLE "plat_plans" ADD COLUMN "student_pack_price_paise" integer;--> statement-breakpoint
ALTER TABLE "plat_plans" ADD COLUMN "staff_pack_size" integer;--> statement-breakpoint
ALTER TABLE "plat_plans" ADD COLUMN "staff_pack_price_paise" integer;--> statement-breakpoint
ALTER TABLE "onb_documents" ADD CONSTRAINT "onb_documents_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onb_documents" ADD CONSTRAINT "onb_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onb_documents" ADD CONSTRAINT "onb_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onb_plan_orders" ADD CONSTRAINT "onb_plan_orders_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onb_plan_orders" ADD CONSTRAINT "onb_plan_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onb_signups" ADD CONSTRAINT "onb_signups_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onb_signups" ADD CONSTRAINT "onb_signups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onb_student_kyc" ADD CONSTRAINT "onb_student_kyc_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onb_student_kyc" ADD CONSTRAINT "onb_student_kyc_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpdp_breaches" ADD CONSTRAINT "dpdp_breaches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpdp_consents" ADD CONSTRAINT "dpdp_consents_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpdp_consents" ADD CONSTRAINT "dpdp_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpdp_guardian_consents" ADD CONSTRAINT "dpdp_guardian_consents_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpdp_guardian_consents" ADD CONSTRAINT "dpdp_guardian_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpdp_requests" ADD CONSTRAINT "dpdp_requests_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpdp_requests" ADD CONSTRAINT "dpdp_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpdp_requests" ADD CONSTRAINT "dpdp_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpdp_retention_flags" ADD CONSTRAINT "dpdp_retention_flags_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpdp_retention_flags" ADD CONSTRAINT "dpdp_retention_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpdp_settings" ADD CONSTRAINT "dpdp_settings_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpdp_settings" ADD CONSTRAINT "dpdp_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_billing_settings" ADD CONSTRAINT "plat_billing_settings_packs_updated_by_users_id_fk" FOREIGN KEY ("packs_updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_billing_settings" ADD CONSTRAINT "plat_billing_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_seat_packs" ADD CONSTRAINT "plat_seat_packs_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_seat_packs" ADD CONSTRAINT "plat_seat_packs_licence_id_plat_licences_id_fk" FOREIGN KEY ("licence_id") REFERENCES "public"."plat_licences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_seat_packs" ADD CONSTRAINT "plat_seat_packs_invoice_id_plat_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."plat_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_seat_packs" ADD CONSTRAINT "plat_seat_packs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onb_documents_university_idx" ON "onb_documents" USING btree ("university_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "onb_plan_orders_gateway_uq" ON "onb_plan_orders" USING btree ("gateway_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onb_signups_university_uq" ON "onb_signups" USING btree ("university_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onb_student_kyc_user_uq" ON "onb_student_kyc" USING btree ("university_id","user_id");--> statement-breakpoint
CREATE INDEX "dpdp_consents_user_idx" ON "dpdp_consents" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "dpdp_consents_uni_idx" ON "dpdp_consents" USING btree ("university_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dpdp_consents_live_uq" ON "dpdp_consents" USING btree ("user_id","purpose",coalesce("university_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "dpdp_consents"."withdrawn_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "dpdp_guardian_token_uq" ON "dpdp_guardian_consents" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "dpdp_guardian_user_idx" ON "dpdp_guardian_consents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dpdp_requests_uni_idx" ON "dpdp_requests" USING btree ("university_id","status");--> statement-breakpoint
CREATE INDEX "dpdp_requests_user_idx" ON "dpdp_requests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dpdp_retention_open_uq" ON "dpdp_retention_flags" USING btree ("university_id","user_id") WHERE "dpdp_retention_flags"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "dpdp_settings_uni_uq" ON "dpdp_settings" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "plat_seat_packs_licence_idx" ON "plat_seat_packs" USING btree ("licence_id","kind");--> statement-breakpoint
CREATE INDEX "plat_seat_packs_university_idx" ON "plat_seat_packs" USING btree ("university_id","created_at");--> statement-breakpoint
ALTER TABLE "plat_plans" ADD CONSTRAINT "plat_plan_packs" CHECK (coalesce("plat_plans"."student_pack_size", 1) > 0 and coalesce("plat_plans"."staff_pack_size", 1) > 0 and coalesce("plat_plans"."student_pack_price_paise", 0) >= 0 and coalesce("plat_plans"."staff_pack_price_paise", 0) >= 0);