ALTER TYPE "public"."enrolment_status" ADD VALUE 'requested';--> statement-breakpoint
ALTER TYPE "public"."enrolment_status" ADD VALUE 'approved';--> statement-breakpoint
CREATE TABLE "student_departments" (
	"university_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idn_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"department_id" uuid,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idn_join_requests_status" CHECK ("idn_join_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
DROP INDEX "enrolments_one_live_per_course";--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "approval_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "enrolments" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "idn_settings" ADD COLUMN "join_code" text;--> statement-breakpoint
ALTER TABLE "idn_settings" ADD COLUMN "join_mode" text DEFAULT 'approval' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_departments" ADD CONSTRAINT "student_departments_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_departments" ADD CONSTRAINT "student_departments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_departments" ADD CONSTRAINT "student_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_departments" ADD CONSTRAINT "student_departments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_join_requests" ADD CONSTRAINT "idn_join_requests_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_join_requests" ADD CONSTRAINT "idn_join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_join_requests" ADD CONSTRAINT "idn_join_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_departments_uq" ON "student_departments" USING btree ("user_id","department_id");--> statement-breakpoint
CREATE INDEX "student_departments_uni_idx" ON "student_departments" USING btree ("university_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idn_join_requests_one_pending" ON "idn_join_requests" USING btree ("university_id","user_id") WHERE "idn_join_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idn_join_requests_user_idx" ON "idn_join_requests" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idn_settings_join_code_uq" ON "idn_settings" USING btree ("join_code");--> statement-breakpoint
CREATE UNIQUE INDEX "enrolments_one_live_per_course" ON "enrolments" USING btree ("user_id","course_id") WHERE "enrolments"."status" not in ('completed', 'cancelled', 'expired', 'ended');--> statement-breakpoint
ALTER TABLE "idn_settings" ADD CONSTRAINT "idn_settings_join_mode" CHECK ("idn_settings"."join_mode" in ('approval', 'instant'));--> statement-breakpoint
-- Students only see their departments' courses from now on. Existing students and alumni keep
-- seeing everything they saw before: they are placed in every department of their institute.
INSERT INTO "student_departments" ("university_id", "user_id", "department_id")
SELECT DISTINCT ra."university_id", ra."user_id", d."id"
FROM "role_assignments" ra
JOIN "departments" d ON d."university_id" = ra."university_id"
WHERE ra."role" in ('student', 'alumni') AND ra."revoked_at" IS NULL
ON CONFLICT DO NOTHING;
