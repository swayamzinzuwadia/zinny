CREATE TYPE "public"."assess_attempt_status" AS ENUM('in_progress', 'awaiting_grading', 'graded');--> statement-breakpoint
CREATE TYPE "public"."assess_difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."assess_proctor_kind" AS ENUM('tab_hidden', 'fullscreen_exit');--> statement-breakpoint
CREATE TYPE "public"."assess_question_type" AS ENUM('single', 'multiple', 'true_false', 'numeric', 'short');--> statement-breakpoint
CREATE TYPE "public"."assess_show_answers" AS ENUM('never', 'after_submit', 'after_close');--> statement-breakpoint
CREATE TYPE "public"."assess_submit_reason" AS ENUM('student', 'time_up', 'tab_limit');--> statement-breakpoint
CREATE TYPE "public"."assess_test_kind" AS ENUM('quiz', 'mock_test', 'series');--> statement-breakpoint
CREATE TYPE "public"."assess_test_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."asgn_file_purpose" AS ENUM('attachment', 'submission', 'returned');--> statement-breakpoint
CREATE TYPE "public"."asgn_submission_type" AS ENUM('text', 'files', 'both');--> statement-breakpoint
CREATE TYPE "public"."cert_design" AS ENUM('classic', 'modern', 'minimal');--> statement-breakpoint
CREATE TYPE "public"."cert_source" AS ENUM('automatic', 'manual');--> statement-breakpoint
CREATE TYPE "public"."cert_status" AS ENUM('valid', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."gam_activity_kind" AS ENUM('lesson', 'test', 'class', 'assignment_submitted', 'assignment_graded', 'course_completed');--> statement-breakpoint
CREATE TYPE "public"."gam_challenge_scope" AS ENUM('batch', 'course');--> statement-breakpoint
CREATE TYPE "public"."gam_condition" AS ENUM('none', 'passed', 'min_score', 'present', 'present_or_late', 'on_time');--> statement-breakpoint
CREATE TYPE "public"."gam_metric" AS ENUM('xp', 'lessons_completed', 'tests_passed', 'classes_attended', 'attendance_streak_weeks', 'assignments_on_time', 'courses_completed');--> statement-breakpoint
CREATE TYPE "public"."gam_name_display" AS ENUM('full', 'first_initial');--> statement-breakpoint
CREATE TYPE "public"."gam_trigger_event" AS ENUM('lesson.completed', 'test.submitted', 'attendance.marked', 'assignment.submitted', 'assignment.graded', 'enrolment.completed');--> statement-breakpoint
CREATE TYPE "public"."live_attendance_source" AS ENUM('join', 'staff', 'system');--> statement-breakpoint
CREATE TYPE "public"."live_attendance_status" AS ENUM('present', 'late', 'absent');--> statement-breakpoint
CREATE TYPE "public"."notif_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."notif_channel_state" AS ENUM('off', 'optional', 'on');--> statement-breakpoint
CREATE TYPE "public"."notif_delivery_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."notif_source" AS ENUM('notification', 'direct', 'test');--> statement-breakpoint
CREATE TYPE "public"."pay_refund_status" AS ENUM('requested', 'pending', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."pay_webhook_status" AS ENUM('processing', 'processed', 'ignored', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."site_enquiry_status" AS ENUM('new', 'contacted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."site_post_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."site_profile_status" AS ENUM('draft', 'pending', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."site_review_status" AS ENUM('pending', 'approved', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."plat_partner_kind" AS ENUM('sponsor', 'corporate_partner');--> statement-breakpoint
CREATE TYPE "public"."plat_partner_status" AS ENUM('prospect', 'in_talks', 'active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."plat_plan" AS ENUM('pilot', 'standard', 'enterprise');--> statement-breakpoint
CREATE TABLE "domain_event_deliveries" (
	"event_id" uuid NOT NULL,
	"handler_id" text NOT NULL,
	"university_id" uuid,
	"delivered_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assess_attempt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid,
	"position" integer NOT NULL,
	"type" "assess_question_type" NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answer" jsonb NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"marks" numeric(6, 2) NOT NULL,
	"negative_marks" numeric(6, 2) DEFAULT 0 NOT NULL,
	"response" jsonb,
	"answered_at" timestamp with time zone,
	"auto_score" numeric(6, 2),
	"manual_score" numeric(6, 2),
	"correct" boolean,
	"needs_grading" boolean DEFAULT false NOT NULL,
	"feedback" text DEFAULT '' NOT NULL,
	"graded_by" uuid,
	"graded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assess_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"status" "assess_attempt_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"submit_reason" "assess_submit_reason",
	"score" numeric(6, 2),
	"max_score" numeric(6, 2) DEFAULT 0 NOT NULL,
	"score_percent" numeric(5, 2),
	"passed" boolean,
	"graded_at" timestamp with time zone,
	"tab_switches" integer DEFAULT 0 NOT NULL,
	"fullscreen_exits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assess_draw_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"count" integer NOT NULL,
	"pool_department_id" uuid,
	"difficulty" "assess_difficulty",
	"type" "assess_question_type",
	"tag" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "assess_draw_rules_count" CHECK ("assess_draw_rules"."count" between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "assess_proctor_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"kind" "assess_proctor_kind" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assess_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"department_id" uuid,
	"type" "assess_question_type" NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answer" jsonb NOT NULL,
	"marks" numeric(6, 2) DEFAULT 1 NOT NULL,
	"negative_marks" numeric(6, 2) DEFAULT 0 NOT NULL,
	"difficulty" "assess_difficulty" DEFAULT 'medium' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "assess_questions_marks" CHECK ("assess_questions"."marks" > 0),
	CONSTRAINT "assess_questions_negative" CHECK ("assess_questions"."negative_marks" >= 0)
);
--> statement-breakpoint
CREATE TABLE "assess_test_batches" (
	"university_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	CONSTRAINT "assess_test_batches_test_id_batch_id_pk" PRIMARY KEY("test_id","batch_id")
);
--> statement-breakpoint
CREATE TABLE "assess_test_questions" (
	"university_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "assess_test_questions_test_id_question_id_pk" PRIMARY KEY("test_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "assess_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"kind" "assess_test_kind" NOT NULL,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"all_batches" boolean DEFAULT true NOT NULL,
	"time_limit_minutes" integer,
	"fullscreen_required" boolean DEFAULT false NOT NULL,
	"tab_switch_limit" integer,
	"shuffle_questions" boolean DEFAULT false NOT NULL,
	"shuffle_options" boolean DEFAULT false NOT NULL,
	"one_per_page" boolean DEFAULT false NOT NULL,
	"attempt_limit" integer DEFAULT 1 NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"pass_percent" integer DEFAULT 40 NOT NULL,
	"show_answers" "assess_show_answers" DEFAULT 'after_submit' NOT NULL,
	"status" "assess_test_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"series_id" uuid,
	"series_position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assess_tests_attempt_limit" CHECK ("assess_tests"."attempt_limit" between 1 and 50),
	CONSTRAINT "assess_tests_time_limit" CHECK ("assess_tests"."time_limit_minutes" is null or "assess_tests"."time_limit_minutes" between 1 and 1440),
	CONSTRAINT "assess_tests_tab_limit" CHECK ("assess_tests"."tab_switch_limit" is null or "assess_tests"."tab_switch_limit" between 0 and 50),
	CONSTRAINT "assess_tests_pass" CHECK ("assess_tests"."pass_percent" between 0 and 100),
	CONSTRAINT "assess_tests_window" CHECK ("assess_tests"."opens_at" is null or "assess_tests"."closes_at" is null or "assess_tests"."closes_at" > "assess_tests"."opens_at"),
	CONSTRAINT "assess_tests_series_not_nested" CHECK ("assess_tests"."kind" <> 'series' or "assess_tests"."series_id" is null)
);
--> statement-breakpoint
CREATE TABLE "asgn_assignment_batches" (
	"university_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	CONSTRAINT "asgn_assignment_batches_assignment_id_batch_id_pk" PRIMARY KEY("assignment_id","batch_id")
);
--> statement-breakpoint
CREATE TABLE "asgn_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions_html" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"points" integer NOT NULL,
	"allow_late" boolean DEFAULT false NOT NULL,
	"late_penalty_pct" smallint DEFAULT 0 NOT NULL,
	"submission_type" "asgn_submission_type" DEFAULT 'both' NOT NULL,
	"max_files" smallint DEFAULT 3 NOT NULL,
	"max_file_mb" smallint DEFAULT 10 NOT NULL,
	"all_batches" boolean DEFAULT false NOT NULL,
	"reminded_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asgn_points_range" CHECK ("asgn_assignments"."points" between 1 and 1000),
	CONSTRAINT "asgn_penalty_range" CHECK ("asgn_assignments"."late_penalty_pct" between 0 and 100),
	CONSTRAINT "asgn_max_files_range" CHECK ("asgn_assignments"."max_files" between 1 and 10),
	CONSTRAINT "asgn_max_file_mb_range" CHECK ("asgn_assignments"."max_file_mb" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "asgn_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"purpose" "asgn_file_purpose" NOT NULL,
	"assignment_id" uuid,
	"submission_id" uuid,
	"version_id" uuid,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" uuid,
	"stored_at" timestamp with time zone,
	"attached_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asgn_files_key_prefix" CHECK ("asgn_files"."storage_key" like ("asgn_files"."university_id"::text || '/assignments-polls/%'))
);
--> statement-breakpoint
CREATE TABLE "asgn_submission_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"text_answer" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"late" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asgn_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"first_submitted_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"version_count" integer DEFAULT 0 NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"marks" numeric(7, 2),
	"penalty_pct" smallint,
	"final_marks" numeric(7, 2),
	"score_percent" numeric(5, 2),
	"feedback" text,
	"graded_by" uuid,
	"graded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"poll_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"batch_id" uuid,
	"question" text NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"results_to_students" boolean DEFAULT true NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"announced_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_window" CHECK ("poll_polls"."closes_at" > "poll_polls"."opens_at")
);
--> statement-breakpoint
CREATE TABLE "poll_voters" (
	"university_id" uuid NOT NULL,
	"poll_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"voted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_voters_poll_id_user_id_pk" PRIMARY KEY("poll_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"poll_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "cert_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"replaces_id" uuid,
	"source" "cert_source" NOT NULL,
	"status" "cert_status" DEFAULT 'valid' NOT NULL,
	"student_name" text NOT NULL,
	"course_title" text NOT NULL,
	"university_name" text NOT NULL,
	"template" jsonb NOT NULL,
	"completed_on" date NOT NULL,
	"issued_on" date NOT NULL,
	"valid_until" date,
	"pdf_key" text NOT NULL,
	"pdf_sha256" text NOT NULL,
	"pdf_bytes" integer NOT NULL,
	"source_event_id" uuid,
	"issued_by" uuid,
	"issue_reason" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	"reminder_sent_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cert_certificates_code_format" CHECK ("cert_certificates"."code" ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
	CONSTRAINT "cert_certificates_revoked" CHECK (("cert_certificates"."status" = 'revoked') = ("cert_certificates"."revoked_at" is not null)),
	CONSTRAINT "cert_certificates_manual_reason" CHECK ("cert_certificates"."source" = 'automatic' or "cert_certificates"."issue_reason" is not null),
	CONSTRAINT "cert_certificates_dates" CHECK ("cert_certificates"."valid_until" is null or "cert_certificates"."valid_until" >= "cert_certificates"."issued_on")
);
--> statement-breakpoint
CREATE TABLE "cert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"auto_issue" boolean DEFAULT true NOT NULL,
	"validity_months" integer,
	"reminder_days" integer,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cert_rules_validity" CHECK ("cert_rules"."validity_months" is null or "cert_rules"."validity_months" between 1 and 600),
	CONSTRAINT "cert_rules_reminder" CHECK ("cert_rules"."reminder_days" is null or "cert_rules"."reminder_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "cert_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"name" text NOT NULL,
	"design" "cert_design" NOT NULL,
	"heading" text DEFAULT 'Certificate of completion' NOT NULL,
	"intro" text DEFAULT 'This is to certify that' NOT NULL,
	"body" text DEFAULT 'has successfully completed the course' NOT NULL,
	"signatories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cert_templates_signatories" CHECK (jsonb_typeof("cert_templates"."signatories") = 'array' and jsonb_array_length("cert_templates"."signatories") <= 2)
);
--> statement-breakpoint
CREATE TABLE "content_course_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"percent" integer DEFAULT 0 NOT NULL,
	"completed_required" integer DEFAULT 0 NOT NULL,
	"total_required" integer DEFAULT 0 NOT NULL,
	"last_lesson_id" uuid,
	"last_activity_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_course_progress_percent" CHECK ("content_course_progress"."percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "content_lesson_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"percent" integer DEFAULT 0 NOT NULL,
	"watched_ranges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"media_seconds" integer,
	"position_seconds" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_via" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_lesson_progress_percent" CHECK ("content_lesson_progress"."percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "content_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"part_size" integer NOT NULL,
	"part_count" integer NOT NULL,
	"received_parts" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"duration_seconds" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_upload_kind" CHECK ("content_uploads"."kind" in ('video', 'pdf')),
	CONSTRAINT "content_upload_size" CHECK ("content_uploads"."size" > 0 and "content_uploads"."part_size" > 0 and "content_uploads"."part_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "gam_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"kind" "gam_activity_kind" NOT NULL,
	"subject_key" text NOT NULL,
	"department_id" uuid,
	"course_id" uuid,
	"batch_id" uuid,
	"activity_date" date NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"score_percent" double precision,
	"passed" boolean,
	"status" text,
	"late" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gam_badge_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"badge_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"value" integer NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gam_badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"department_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text NOT NULL,
	"metric" "gam_metric" NOT NULL,
	"threshold" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gam_badge_threshold" CHECK ("gam_badges"."threshold" between 1 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "gam_challenge_winners" (
	"university_id" uuid NOT NULL,
	"challenge_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"value" integer NOT NULL,
	"reached_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gam_challenge_winners_challenge_id_user_id_pk" PRIMARY KEY("challenge_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "gam_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"scope" "gam_challenge_scope" NOT NULL,
	"course_id" uuid NOT NULL,
	"batch_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"metric" "gam_metric" NOT NULL,
	"target" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "gam_challenge_dates" CHECK ("gam_challenges"."end_date" >= "gam_challenges"."start_date"),
	CONSTRAINT "gam_challenge_target" CHECK ("gam_challenges"."target" between 1 and 1000000),
	CONSTRAINT "gam_challenge_scope_shape" CHECK (("gam_challenges"."scope" = 'batch') = ("gam_challenges"."batch_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "gam_settings" (
	"university_id" uuid PRIMARY KEY NOT NULL,
	"name_display" "gam_name_display" DEFAULT 'first_initial' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gam_xp_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"department_id" uuid,
	"course_id" uuid,
	"batch_id" uuid,
	"award_date" date NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gam_ledger_points" CHECK ("gam_xp_ledger"."points" > 0)
);
--> statement-breakpoint
CREATE TABLE "gam_xp_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"department_id" uuid,
	"name" text NOT NULL,
	"event_type" "gam_trigger_event" NOT NULL,
	"condition" "gam_condition" DEFAULT 'none' NOT NULL,
	"min_score" integer,
	"points" integer NOT NULL,
	"daily_cap" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gam_rule_points" CHECK ("gam_xp_rules"."points" between 1 and 10000),
	CONSTRAINT "gam_rule_cap" CHECK ("gam_xp_rules"."daily_cap" is null or "gam_xp_rules"."daily_cap" >= 1),
	CONSTRAINT "gam_rule_min_score" CHECK (("gam_xp_rules"."condition" = 'min_score') = ("gam_xp_rules"."min_score" is not null)),
	CONSTRAINT "gam_rule_min_score_range" CHECK ("gam_xp_rules"."min_score" is null or "gam_xp_rules"."min_score" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "idn_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role_name" NOT NULL,
	"token_hash" text NOT NULL,
	"event_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idn_otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"purpose" text DEFAULT 'sign_in' NOT NULL,
	"user_id" uuid,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sends" integer DEFAULT 1 NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idn_otp_challenges_purpose" CHECK ("idn_otp_challenges"."purpose" in ('sign_in', 'verify_phone'))
);
--> statement-breakpoint
CREATE TABLE "idn_photos" (
	"university_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idn_photos_university_id_user_id_pk" PRIMARY KEY("university_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "idn_sessions" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"method" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idn_settings" (
	"university_id" uuid PRIMARY KEY NOT NULL,
	"phone_sign_in" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "idn_throttles" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"lock_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idn_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"event_id" uuid,
	"role" "role_name",
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idn_tokens_purpose" CHECK ("idn_tokens"."purpose" in ('reset', 'team_invite'))
);
--> statement-breakpoint
CREATE TABLE "live_alerts" (
	"university_id" uuid NOT NULL,
	"week" date NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_alerts_university_id_week_kind_user_id_scope_pk" PRIMARY KEY("university_id","week","kind","user_id","scope"),
	CONSTRAINT "live_alerts_kind" CHECK ("live_alerts"."kind" in ('student', 'hod'))
);
--> statement-breakpoint
CREATE TABLE "live_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" time NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "live_attendance_status" NOT NULL,
	"source" "live_attendance_source" NOT NULL,
	"first_joined_at" timestamp with time zone,
	"last_joined_at" timestamp with time zone,
	"join_count" integer DEFAULT 0 NOT NULL,
	"note" text,
	"marked_by" uuid,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_attendance_joins" CHECK ("live_attendance"."join_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "live_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" time NOT NULL,
	"meeting_url" text,
	"recording_url" text,
	"started_at" timestamp with time zone,
	"started_by" uuid,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_settings" (
	"university_id" uuid PRIMARY KEY NOT NULL,
	"threshold_percent" smallint DEFAULT 75 NOT NULL,
	"alerts_week" date,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_settings_threshold" CHECK ("live_settings"."threshold_percent" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "notif_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"source" "notif_source" NOT NULL,
	"notification_id" uuid,
	"user_id" uuid,
	"kind" text NOT NULL,
	"channel" "notif_channel" NOT NULL,
	"security" boolean DEFAULT false NOT NULL,
	"recipient" text,
	"status" "notif_delivery_status" NOT NULL,
	"last_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"interrupted" boolean DEFAULT false NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"provider" text,
	"provider_message_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notif_dispatches" (
	"notification_id" uuid PRIMARY KEY NOT NULL,
	"university_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notif_kind_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"email" "notif_channel_state" NOT NULL,
	"sms" "notif_channel_state" NOT NULL,
	"whatsapp" "notif_channel_state" NOT NULL,
	"email_subject" text,
	"email_body" text,
	"sms_text" text,
	"sms_template_id" text,
	"whatsapp_template" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notif_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" "notif_channel" NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notif_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"address" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notif_university_settings" (
	"university_id" uuid PRIMARY KEY NOT NULL,
	"deliver_from" timestamp with time zone DEFAULT now() NOT NULL,
	"reply_to" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_invoice_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"sac_code" text NOT NULL,
	"footer" text DEFAULT '' NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"rendered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"emailed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pay_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "pay_refund_status" DEFAULT 'requested' NOT NULL,
	"gateway" text NOT NULL,
	"gateway_refund_id" text,
	"failure_reason" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"announced_at" timestamp with time zone,
	CONSTRAINT "pay_refunds_amount" CHECK ("pay_refunds"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "pay_settings" (
	"university_id" uuid PRIMARY KEY NOT NULL,
	"sac_code" text NOT NULL,
	"invoice_footer" text DEFAULT '' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_settings_sac" CHECK ("pay_settings"."sac_code" ~ '^99[0-9]{2}([0-9]{2})?$')
);
--> statement-breakpoint
CREATE TABLE "pay_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"body_sha256" text NOT NULL,
	"event_type" text NOT NULL,
	"status" "pay_webhook_status" DEFAULT 'processing' NOT NULL,
	"outcome" text,
	"order_id" uuid,
	"gateway_order_id" text,
	"gateway_payment_id" text,
	"gateway_refund_id" text,
	"amount_paise" integer,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "site_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"message" text DEFAULT '' NOT NULL,
	"course_id" uuid,
	"source" text DEFAULT 'home' NOT NULL,
	"status" "site_enquiry_status" DEFAULT 'new' NOT NULL,
	"assignee_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_enquiry_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"kind" text DEFAULT 'note' NOT NULL,
	"body" text NOT NULL,
	"author_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_faculty_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"published" jsonb,
	"status" "site_profile_status" DEFAULT 'draft' NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_gallery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"published" jsonb,
	"draft_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draft_updated_by" uuid,
	"published_at" timestamp with time zone,
	"published_by" uuid
);
--> statement-breakpoint
CREATE TABLE "site_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"cover_media_id" uuid,
	"author_user_id" uuid,
	"status" "site_post_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "site_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"about" text DEFAULT '' NOT NULL,
	"founded_year" smallint,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"map_url" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"whatsapp" text DEFAULT '' NOT NULL,
	"social" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"primary_color" text,
	"logo_media_id" uuid,
	"cover_media_id" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"course_id" uuid,
	"author_name" text NOT NULL,
	"author_email" text DEFAULT '' NOT NULL,
	"rating" smallint NOT NULL,
	"body" text NOT NULL,
	"status" "site_review_status" DEFAULT 'pending' NOT NULL,
	"moderated_by" uuid,
	"moderated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_review_rating" CHECK ("site_reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "site_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"linkedin_url" text DEFAULT '' NOT NULL,
	"photo_media_id" uuid,
	"visible" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_testimonials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"name" text NOT NULL,
	"byline" text DEFAULT '' NOT NULL,
	"quote" text NOT NULL,
	"photo_media_id" uuid,
	"visible" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"title" text NOT NULL,
	"youtube_id" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_video_id" CHECK ("site_videos"."youtube_id" ~ '^[A-Za-z0-9_-]{11}$')
);
--> statement-breakpoint
CREATE TABLE "plat_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"level" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plat_content_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"category" text NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	CONSTRAINT "plat_flag_status" CHECK ("plat_content_flags"."status" in ('open', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "plat_course_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "plat_invoice_counters" (
	"financial_year" text PRIMARY KEY NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plat_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"number" text NOT NULL,
	"financial_year" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"description" text NOT NULL,
	"base_paise" integer NOT NULL,
	"gst_rate_bp" integer NOT NULL,
	"cgst_paise" integer DEFAULT 0 NOT NULL,
	"sgst_paise" integer DEFAULT 0 NOT NULL,
	"igst_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" integer NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"paid_on" date,
	"payment_reference" text,
	"seller_name" text NOT NULL,
	"seller_gstin" text,
	"seller_state_code" text NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_gstin" text,
	"buyer_state_code" text NOT NULL,
	"buyer_address" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plat_invoice_number_len" CHECK (char_length("plat_invoices"."number") <= 16),
	CONSTRAINT "plat_invoice_status" CHECK ("plat_invoices"."status" in ('unpaid', 'paid')),
	CONSTRAINT "plat_invoice_amounts" CHECK ("plat_invoices"."base_paise" > 0 and "plat_invoices"."total_paise" = "plat_invoices"."base_paise" + "plat_invoices"."cgst_paise" + "plat_invoices"."sgst_paise" + "plat_invoices"."igst_paise"),
	CONSTRAINT "plat_invoice_period" CHECK ("plat_invoices"."period_end" >= "plat_invoices"."period_start"),
	CONSTRAINT "plat_invoice_due" CHECK ("plat_invoices"."due_date" >= "plat_invoices"."issue_date"),
	CONSTRAINT "plat_invoice_paid" CHECK (("plat_invoices"."status" = 'paid') = ("plat_invoices"."paid_on" is not null))
);
--> statement-breakpoint
CREATE TABLE "plat_licences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"plan" "plat_plan" NOT NULL,
	"student_cap" integer NOT NULL,
	"staff_cap" integer NOT NULL,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "plat_licence_caps" CHECK ("plat_licences"."student_cap" > 0 and "plat_licences"."staff_cap" > 0),
	CONSTRAINT "plat_licence_dates" CHECK ("plat_licences"."end_date" >= "plat_licences"."start_date")
);
--> statement-breakpoint
CREATE TABLE "plat_partner_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plat_partner_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plat_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "plat_partner_kind" NOT NULL,
	"status" "plat_partner_status" DEFAULT 'prospect' NOT NULL,
	"website" text,
	"industry" text,
	"city" text,
	"summary" text,
	"owner_user_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lessons" RENAME TO "content_lessons";--> statement-breakpoint
ALTER TABLE "course_sections" RENAME TO "content_sections";--> statement-breakpoint
ALTER TABLE "content_sections" DROP CONSTRAINT "course_sections_university_id_universities_id_fk";
--> statement-breakpoint
ALTER TABLE "content_sections" DROP CONSTRAINT "course_sections_course_id_courses_id_fk";
--> statement-breakpoint
ALTER TABLE "content_lessons" DROP CONSTRAINT "lessons_university_id_universities_id_fk";
--> statement-breakpoint
ALTER TABLE "content_lessons" DROP CONSTRAINT "lessons_course_id_courses_id_fk";
--> statement-breakpoint
ALTER TABLE "content_lessons" DROP CONSTRAINT "lessons_section_id_course_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "content_lessons" ADD COLUMN "ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "content_lessons" ADD COLUMN "required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "content_lessons" ADD COLUMN "duration_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_lessons" ADD COLUMN "drip_mode" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_lessons" ADD COLUMN "drip_days" integer;--> statement-breakpoint
ALTER TABLE "content_lessons" ADD COLUMN "drip_date" date;--> statement-breakpoint
ALTER TABLE "content_lessons" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "content_lessons" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_event_deliveries" ADD CONSTRAINT "domain_event_deliveries_event_id_domain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."domain_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_event_deliveries" ADD CONSTRAINT "domain_event_deliveries_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_attempt_items" ADD CONSTRAINT "assess_attempt_items_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_attempt_items" ADD CONSTRAINT "assess_attempt_items_attempt_id_assess_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."assess_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_attempt_items" ADD CONSTRAINT "assess_attempt_items_question_id_assess_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."assess_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_attempt_items" ADD CONSTRAINT "assess_attempt_items_graded_by_users_id_fk" FOREIGN KEY ("graded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_attempts" ADD CONSTRAINT "assess_attempts_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_attempts" ADD CONSTRAINT "assess_attempts_test_id_assess_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."assess_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_attempts" ADD CONSTRAINT "assess_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_attempts" ADD CONSTRAINT "assess_attempts_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_attempts" ADD CONSTRAINT "assess_attempts_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_draw_rules" ADD CONSTRAINT "assess_draw_rules_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_draw_rules" ADD CONSTRAINT "assess_draw_rules_test_id_assess_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."assess_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_draw_rules" ADD CONSTRAINT "assess_draw_rules_pool_department_id_departments_id_fk" FOREIGN KEY ("pool_department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_proctor_events" ADD CONSTRAINT "assess_proctor_events_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_proctor_events" ADD CONSTRAINT "assess_proctor_events_attempt_id_assess_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."assess_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_questions" ADD CONSTRAINT "assess_questions_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_questions" ADD CONSTRAINT "assess_questions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_questions" ADD CONSTRAINT "assess_questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_test_batches" ADD CONSTRAINT "assess_test_batches_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_test_batches" ADD CONSTRAINT "assess_test_batches_test_id_assess_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."assess_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_test_batches" ADD CONSTRAINT "assess_test_batches_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_test_questions" ADD CONSTRAINT "assess_test_questions_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_test_questions" ADD CONSTRAINT "assess_test_questions_test_id_assess_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."assess_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_test_questions" ADD CONSTRAINT "assess_test_questions_question_id_assess_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."assess_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_tests" ADD CONSTRAINT "assess_tests_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_tests" ADD CONSTRAINT "assess_tests_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_tests" ADD CONSTRAINT "assess_tests_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_tests" ADD CONSTRAINT "assess_tests_series_id_assess_tests_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."assess_tests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assess_tests" ADD CONSTRAINT "assess_tests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_assignment_batches" ADD CONSTRAINT "asgn_assignment_batches_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_assignment_batches" ADD CONSTRAINT "asgn_assignment_batches_assignment_id_asgn_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."asgn_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_assignment_batches" ADD CONSTRAINT "asgn_assignment_batches_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_assignments" ADD CONSTRAINT "asgn_assignments_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_assignments" ADD CONSTRAINT "asgn_assignments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_assignments" ADD CONSTRAINT "asgn_assignments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_assignments" ADD CONSTRAINT "asgn_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_files" ADD CONSTRAINT "asgn_files_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_files" ADD CONSTRAINT "asgn_files_assignment_id_asgn_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."asgn_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_files" ADD CONSTRAINT "asgn_files_submission_id_asgn_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."asgn_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_files" ADD CONSTRAINT "asgn_files_version_id_asgn_submission_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."asgn_submission_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_files" ADD CONSTRAINT "asgn_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_submission_versions" ADD CONSTRAINT "asgn_submission_versions_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_submission_versions" ADD CONSTRAINT "asgn_submission_versions_submission_id_asgn_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."asgn_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_submissions" ADD CONSTRAINT "asgn_submissions_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_submissions" ADD CONSTRAINT "asgn_submissions_assignment_id_asgn_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."asgn_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_submissions" ADD CONSTRAINT "asgn_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_submissions" ADD CONSTRAINT "asgn_submissions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asgn_submissions" ADD CONSTRAINT "asgn_submissions_graded_by_users_id_fk" FOREIGN KEY ("graded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_poll_id_poll_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."poll_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_polls" ADD CONSTRAINT "poll_polls_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_polls" ADD CONSTRAINT "poll_polls_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_polls" ADD CONSTRAINT "poll_polls_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_polls" ADD CONSTRAINT "poll_polls_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_polls" ADD CONSTRAINT "poll_polls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_voters" ADD CONSTRAINT "poll_voters_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_voters" ADD CONSTRAINT "poll_voters_poll_id_poll_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."poll_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_voters" ADD CONSTRAINT "poll_voters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_poll_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."poll_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_option_id_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."poll_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_certificates" ADD CONSTRAINT "cert_certificates_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_certificates" ADD CONSTRAINT "cert_certificates_template_id_cert_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."cert_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_certificates" ADD CONSTRAINT "cert_certificates_replaces_id_cert_certificates_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."cert_certificates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_rules" ADD CONSTRAINT "cert_rules_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_rules" ADD CONSTRAINT "cert_rules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_rules" ADD CONSTRAINT "cert_rules_template_id_cert_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."cert_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_templates" ADD CONSTRAINT "cert_templates_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_course_progress" ADD CONSTRAINT "content_course_progress_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_course_progress" ADD CONSTRAINT "content_course_progress_enrolment_id_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."enrolments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_course_progress" ADD CONSTRAINT "content_course_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_course_progress" ADD CONSTRAINT "content_course_progress_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_course_progress" ADD CONSTRAINT "content_course_progress_last_lesson_id_content_lessons_id_fk" FOREIGN KEY ("last_lesson_id") REFERENCES "public"."content_lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_lesson_progress" ADD CONSTRAINT "content_lesson_progress_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_lesson_progress" ADD CONSTRAINT "content_lesson_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_lesson_progress" ADD CONSTRAINT "content_lesson_progress_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_lesson_progress" ADD CONSTRAINT "content_lesson_progress_lesson_id_content_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."content_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_uploads" ADD CONSTRAINT "content_uploads_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_uploads" ADD CONSTRAINT "content_uploads_lesson_id_content_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."content_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_uploads" ADD CONSTRAINT "content_uploads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_activity" ADD CONSTRAINT "gam_activity_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_activity" ADD CONSTRAINT "gam_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_activity" ADD CONSTRAINT "gam_activity_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_activity" ADD CONSTRAINT "gam_activity_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_activity" ADD CONSTRAINT "gam_activity_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_badge_awards" ADD CONSTRAINT "gam_badge_awards_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_badge_awards" ADD CONSTRAINT "gam_badge_awards_badge_id_gam_badges_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."gam_badges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_badge_awards" ADD CONSTRAINT "gam_badge_awards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_badges" ADD CONSTRAINT "gam_badges_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_badges" ADD CONSTRAINT "gam_badges_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_badges" ADD CONSTRAINT "gam_badges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_challenge_winners" ADD CONSTRAINT "gam_challenge_winners_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_challenge_winners" ADD CONSTRAINT "gam_challenge_winners_challenge_id_gam_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."gam_challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_challenge_winners" ADD CONSTRAINT "gam_challenge_winners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_challenges" ADD CONSTRAINT "gam_challenges_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_challenges" ADD CONSTRAINT "gam_challenges_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_challenges" ADD CONSTRAINT "gam_challenges_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_challenges" ADD CONSTRAINT "gam_challenges_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_challenges" ADD CONSTRAINT "gam_challenges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_settings" ADD CONSTRAINT "gam_settings_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_settings" ADD CONSTRAINT "gam_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_xp_ledger" ADD CONSTRAINT "gam_xp_ledger_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_xp_ledger" ADD CONSTRAINT "gam_xp_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_xp_ledger" ADD CONSTRAINT "gam_xp_ledger_rule_id_gam_xp_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."gam_xp_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_xp_ledger" ADD CONSTRAINT "gam_xp_ledger_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_xp_ledger" ADD CONSTRAINT "gam_xp_ledger_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_xp_ledger" ADD CONSTRAINT "gam_xp_ledger_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_xp_rules" ADD CONSTRAINT "gam_xp_rules_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_xp_rules" ADD CONSTRAINT "gam_xp_rules_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gam_xp_rules" ADD CONSTRAINT "gam_xp_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_invites" ADD CONSTRAINT "idn_invites_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_invites" ADD CONSTRAINT "idn_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_invites" ADD CONSTRAINT "idn_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_otp_challenges" ADD CONSTRAINT "idn_otp_challenges_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_otp_challenges" ADD CONSTRAINT "idn_otp_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_photos" ADD CONSTRAINT "idn_photos_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_photos" ADD CONSTRAINT "idn_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_sessions" ADD CONSTRAINT "idn_sessions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_sessions" ADD CONSTRAINT "idn_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_settings" ADD CONSTRAINT "idn_settings_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_settings" ADD CONSTRAINT "idn_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idn_tokens" ADD CONSTRAINT "idn_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_alerts" ADD CONSTRAINT "live_alerts_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_alerts" ADD CONSTRAINT "live_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_attendance" ADD CONSTRAINT "live_attendance_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_attendance" ADD CONSTRAINT "live_attendance_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_attendance" ADD CONSTRAINT "live_attendance_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_attendance" ADD CONSTRAINT "live_attendance_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_settings" ADD CONSTRAINT "live_settings_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_settings" ADD CONSTRAINT "live_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif_deliveries" ADD CONSTRAINT "notif_deliveries_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif_deliveries" ADD CONSTRAINT "notif_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif_deliveries" ADD CONSTRAINT "notif_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif_dispatches" ADD CONSTRAINT "notif_dispatches_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif_dispatches" ADD CONSTRAINT "notif_dispatches_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif_kind_settings" ADD CONSTRAINT "notif_kind_settings_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif_kind_settings" ADD CONSTRAINT "notif_kind_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif_preferences" ADD CONSTRAINT "notif_preferences_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif_preferences" ADD CONSTRAINT "notif_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif_suppressions" ADD CONSTRAINT "notif_suppressions_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif_university_settings" ADD CONSTRAINT "notif_university_settings_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notif_university_settings" ADD CONSTRAINT "notif_university_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_invoice_documents" ADD CONSTRAINT "pay_invoice_documents_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_invoice_documents" ADD CONSTRAINT "pay_invoice_documents_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_refunds" ADD CONSTRAINT "pay_refunds_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_refunds" ADD CONSTRAINT "pay_refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_refunds" ADD CONSTRAINT "pay_refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_settings" ADD CONSTRAINT "pay_settings_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_settings" ADD CONSTRAINT "pay_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_webhook_events" ADD CONSTRAINT "pay_webhook_events_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_webhook_events" ADD CONSTRAINT "pay_webhook_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_enquiries" ADD CONSTRAINT "site_enquiries_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_enquiries" ADD CONSTRAINT "site_enquiries_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_enquiries" ADD CONSTRAINT "site_enquiries_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_enquiry_notes" ADD CONSTRAINT "site_enquiry_notes_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_enquiry_notes" ADD CONSTRAINT "site_enquiry_notes_enquiry_id_site_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."site_enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_enquiry_notes" ADD CONSTRAINT "site_enquiry_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_faculty_profiles" ADD CONSTRAINT "site_faculty_profiles_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_faculty_profiles" ADD CONSTRAINT "site_faculty_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_faculty_profiles" ADD CONSTRAINT "site_faculty_profiles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_gallery" ADD CONSTRAINT "site_gallery_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_gallery" ADD CONSTRAINT "site_gallery_media_id_site_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."site_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_media" ADD CONSTRAINT "site_media_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_media" ADD CONSTRAINT "site_media_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_draft_updated_by_users_id_fk" FOREIGN KEY ("draft_updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_posts" ADD CONSTRAINT "site_posts_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_posts" ADD CONSTRAINT "site_posts_cover_media_id_site_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."site_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_posts" ADD CONSTRAINT "site_posts_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_posts" ADD CONSTRAINT "site_posts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_profiles" ADD CONSTRAINT "site_profiles_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_profiles" ADD CONSTRAINT "site_profiles_logo_media_id_site_media_id_fk" FOREIGN KEY ("logo_media_id") REFERENCES "public"."site_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_profiles" ADD CONSTRAINT "site_profiles_cover_media_id_site_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."site_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_profiles" ADD CONSTRAINT "site_profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_reviews" ADD CONSTRAINT "site_reviews_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_reviews" ADD CONSTRAINT "site_reviews_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_reviews" ADD CONSTRAINT "site_reviews_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_submissions" ADD CONSTRAINT "site_submissions_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_team" ADD CONSTRAINT "site_team_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_team" ADD CONSTRAINT "site_team_photo_media_id_site_media_id_fk" FOREIGN KEY ("photo_media_id") REFERENCES "public"."site_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_testimonials" ADD CONSTRAINT "site_testimonials_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_testimonials" ADD CONSTRAINT "site_testimonials_photo_media_id_site_media_id_fk" FOREIGN KEY ("photo_media_id") REFERENCES "public"."site_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_videos" ADD CONSTRAINT "site_videos_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_alerts" ADD CONSTRAINT "plat_alerts_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_alerts" ADD CONSTRAINT "plat_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_content_flags" ADD CONSTRAINT "plat_content_flags_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_content_flags" ADD CONSTRAINT "plat_content_flags_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_content_flags" ADD CONSTRAINT "plat_content_flags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_content_flags" ADD CONSTRAINT "plat_content_flags_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_course_reviews" ADD CONSTRAINT "plat_course_reviews_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_course_reviews" ADD CONSTRAINT "plat_course_reviews_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_course_reviews" ADD CONSTRAINT "plat_course_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_invoices" ADD CONSTRAINT "plat_invoices_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_invoices" ADD CONSTRAINT "plat_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_licences" ADD CONSTRAINT "plat_licences_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_licences" ADD CONSTRAINT "plat_licences_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_partner_contacts" ADD CONSTRAINT "plat_partner_contacts_partner_id_plat_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."plat_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_partner_notes" ADD CONSTRAINT "plat_partner_notes_partner_id_plat_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."plat_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_partner_notes" ADD CONSTRAINT "plat_partner_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_partners" ADD CONSTRAINT "plat_partners_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plat_partners" ADD CONSTRAINT "plat_partners_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_event_deliveries_uq" ON "domain_event_deliveries" USING btree ("event_id","handler_id");--> statement-breakpoint
CREATE INDEX "domain_events_type_at_idx" ON "domain_events" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_uni_at_idx" ON "domain_events" USING btree ("university_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assess_attempt_items_pos_uq" ON "assess_attempt_items" USING btree ("attempt_id","position");--> statement-breakpoint
CREATE INDEX "assess_attempt_items_question_idx" ON "assess_attempt_items" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "assess_attempt_items_grading_idx" ON "assess_attempt_items" USING btree ("attempt_id") WHERE "assess_attempt_items"."needs_grading";--> statement-breakpoint
CREATE UNIQUE INDEX "assess_attempts_no_uq" ON "assess_attempts" USING btree ("test_id","user_id","attempt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "assess_attempts_one_open_uq" ON "assess_attempts" USING btree ("test_id","user_id") WHERE "assess_attempts"."status" = 'in_progress';--> statement-breakpoint
CREATE INDEX "assess_attempts_test_idx" ON "assess_attempts" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "assess_attempts_user_idx" ON "assess_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "assess_attempts_open_idx" ON "assess_attempts" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "assess_draw_rules_test_idx" ON "assess_draw_rules" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "assess_proctor_events_attempt_idx" ON "assess_proctor_events" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "assess_questions_pool_idx" ON "assess_questions" USING btree ("university_id","department_id");--> statement-breakpoint
CREATE INDEX "assess_test_batches_batch_idx" ON "assess_test_batches" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "assess_tests_course_idx" ON "assess_tests" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "assess_tests_dept_idx" ON "assess_tests" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "assess_tests_series_idx" ON "assess_tests" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "asgn_assignment_batches_batch_idx" ON "asgn_assignment_batches" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "asgn_assignments_course_idx" ON "asgn_assignments" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "asgn_assignments_due_idx" ON "asgn_assignments" USING btree ("university_id","due_at");--> statement-breakpoint
CREATE INDEX "asgn_files_key_idx" ON "asgn_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "asgn_files_assignment_idx" ON "asgn_files" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "asgn_files_submission_idx" ON "asgn_files" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "asgn_files_version_idx" ON "asgn_files" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "asgn_files_staged_idx" ON "asgn_files" USING btree ("university_id","created_at") WHERE "asgn_files"."attached_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "asgn_versions_number_uq" ON "asgn_submission_versions" USING btree ("submission_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "asgn_submissions_one_per_student" ON "asgn_submissions" USING btree ("assignment_id","user_id");--> statement-breakpoint
CREATE INDEX "asgn_submissions_batch_idx" ON "asgn_submissions" USING btree ("assignment_id","batch_id");--> statement-breakpoint
CREATE INDEX "asgn_submissions_user_idx" ON "asgn_submissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "asgn_submissions_to_grade_idx" ON "asgn_submissions" USING btree ("university_id","batch_id") WHERE "asgn_submissions"."submitted_at" is not null and "asgn_submissions"."graded_at" is null;--> statement-breakpoint
CREATE INDEX "poll_options_poll_idx" ON "poll_options" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "poll_polls_course_idx" ON "poll_polls" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "poll_polls_batch_idx" ON "poll_polls" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "poll_votes_poll_idx" ON "poll_votes" USING btree ("poll_id");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_votes_one_named" ON "poll_votes" USING btree ("poll_id","user_id") WHERE "poll_votes"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cert_certificates_code_uq" ON "cert_certificates" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "cert_certificates_one_per_enrolment" ON "cert_certificates" USING btree ("enrolment_id") WHERE "cert_certificates"."replaces_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cert_certificates_replaced_once" ON "cert_certificates" USING btree ("replaces_id") WHERE "cert_certificates"."replaces_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cert_certificates_source_event_uq" ON "cert_certificates" USING btree ("source_event_id") WHERE "cert_certificates"."source_event_id" is not null;--> statement-breakpoint
CREATE INDEX "cert_certificates_uni_issued_idx" ON "cert_certificates" USING btree ("university_id","issued_on");--> statement-breakpoint
CREATE INDEX "cert_certificates_user_idx" ON "cert_certificates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cert_certificates_course_idx" ON "cert_certificates" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "cert_certificates_expiry_idx" ON "cert_certificates" USING btree ("status","valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "cert_rules_course_uq" ON "cert_rules" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cert_templates_one_default" ON "cert_templates" USING btree ("university_id") WHERE "cert_templates"."is_default" and "cert_templates"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "cert_templates_uni_idx" ON "cert_templates" USING btree ("university_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_course_progress_enrolment_uq" ON "content_course_progress" USING btree ("enrolment_id");--> statement-breakpoint
CREATE INDEX "content_course_progress_course_idx" ON "content_course_progress" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "content_course_progress_user_idx" ON "content_course_progress" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_lesson_progress_uq" ON "content_lesson_progress" USING btree ("lesson_id","user_id");--> statement-breakpoint
CREATE INDEX "content_lesson_progress_user_course_idx" ON "content_lesson_progress" USING btree ("user_id","course_id");--> statement-breakpoint
CREATE INDEX "content_uploads_lesson_idx" ON "content_uploads" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "content_uploads_created_idx" ON "content_uploads" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gam_activity_event_user_uq" ON "gam_activity" USING btree ("source_event_id","user_id");--> statement-breakpoint
CREATE INDEX "gam_activity_user_idx" ON "gam_activity" USING btree ("university_id","user_id","kind");--> statement-breakpoint
CREATE INDEX "gam_activity_batch_idx" ON "gam_activity" USING btree ("batch_id","kind","activity_date");--> statement-breakpoint
CREATE INDEX "gam_activity_course_idx" ON "gam_activity" USING btree ("course_id","kind","activity_date");--> statement-breakpoint
CREATE UNIQUE INDEX "gam_badge_awards_uq" ON "gam_badge_awards" USING btree ("badge_id","user_id");--> statement-breakpoint
CREATE INDEX "gam_badge_awards_user_idx" ON "gam_badge_awards" USING btree ("university_id","user_id");--> statement-breakpoint
CREATE INDEX "gam_badges_uni_idx" ON "gam_badges" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "gam_challenges_uni_idx" ON "gam_challenges" USING btree ("university_id","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "gam_xp_ledger_event_rule_user_uq" ON "gam_xp_ledger" USING btree ("source_event_id","rule_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gam_xp_ledger_rule_user_subject_uq" ON "gam_xp_ledger" USING btree ("rule_id","user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "gam_xp_ledger_user_idx" ON "gam_xp_ledger" USING btree ("university_id","user_id","award_date");--> statement-breakpoint
CREATE INDEX "gam_xp_ledger_cap_idx" ON "gam_xp_ledger" USING btree ("rule_id","user_id","award_date");--> statement-breakpoint
CREATE INDEX "gam_xp_ledger_batch_idx" ON "gam_xp_ledger" USING btree ("batch_id","award_date");--> statement-breakpoint
CREATE INDEX "gam_xp_ledger_course_idx" ON "gam_xp_ledger" USING btree ("course_id","award_date");--> statement-breakpoint
CREATE INDEX "gam_xp_ledger_dept_idx" ON "gam_xp_ledger" USING btree ("department_id","award_date");--> statement-breakpoint
CREATE INDEX "gam_xp_rules_event_idx" ON "gam_xp_rules" USING btree ("university_id","event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "idn_invites_token_uq" ON "idn_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idn_invites_event_uq" ON "idn_invites" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idn_invites_user_idx" ON "idn_invites" USING btree ("university_id","user_id");--> statement-breakpoint
CREATE INDEX "idn_otp_challenges_created_idx" ON "idn_otp_challenges" USING btree ("university_id","created_at");--> statement-breakpoint
CREATE INDEX "idn_sessions_user_idx" ON "idn_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idn_tokens_token_uq" ON "idn_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idn_tokens_event_uq" ON "idn_tokens" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idn_tokens_user_idx" ON "idn_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "live_attendance_key_uq" ON "live_attendance" USING btree ("batch_id","date","start_time","user_id");--> statement-breakpoint
CREATE INDEX "live_attendance_user_idx" ON "live_attendance" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "live_attendance_uni_date_idx" ON "live_attendance" USING btree ("university_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "live_sessions_key_uq" ON "live_sessions" USING btree ("batch_id","date","start_time");--> statement-breakpoint
CREATE INDEX "live_sessions_uni_date_idx" ON "live_sessions" USING btree ("university_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "notif_deliveries_notification_channel_uq" ON "notif_deliveries" USING btree ("notification_id","channel");--> statement-breakpoint
CREATE INDEX "notif_deliveries_due_idx" ON "notif_deliveries" USING btree ("status","next_attempt_at") WHERE "notif_deliveries"."status" in ('queued', 'sending');--> statement-breakpoint
CREATE INDEX "notif_deliveries_recent_idx" ON "notif_deliveries" USING btree ("university_id","created_at");--> statement-breakpoint
CREATE INDEX "notif_dispatches_created_idx" ON "notif_dispatches" USING btree ("university_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notif_kind_settings_kind_uq" ON "notif_kind_settings" USING btree ("university_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "notif_preferences_uq" ON "notif_preferences" USING btree ("university_id","user_id","kind","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "notif_suppressions_uq" ON "notif_suppressions" USING btree ("university_id","address","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_invoice_documents_invoice_uq" ON "pay_invoice_documents" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "pay_refunds_order_idx" ON "pay_refunds" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_refunds_gateway_uq" ON "pay_refunds" USING btree ("gateway_refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_webhook_events_event_uq" ON "pay_webhook_events" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_webhook_events_body_uq" ON "pay_webhook_events" USING btree ("body_sha256");--> statement-breakpoint
CREATE INDEX "pay_webhook_events_order_idx" ON "pay_webhook_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "site_enquiries_uni_status_idx" ON "site_enquiries" USING btree ("university_id","status","created_at");--> statement-breakpoint
CREATE INDEX "site_enquiry_notes_enquiry_idx" ON "site_enquiry_notes" USING btree ("enquiry_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "site_faculty_profiles_user_uq" ON "site_faculty_profiles" USING btree ("university_id","user_id");--> statement-breakpoint
CREATE INDEX "site_gallery_uni_idx" ON "site_gallery" USING btree ("university_id","position");--> statement-breakpoint
CREATE INDEX "site_media_uni_idx" ON "site_media" USING btree ("university_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "site_pages_uni_uq" ON "site_pages" USING btree ("university_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_posts_slug_uq" ON "site_posts" USING btree ("university_id","slug");--> statement-breakpoint
CREATE INDEX "site_posts_uni_status_idx" ON "site_posts" USING btree ("university_id","status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "site_profiles_uni_uq" ON "site_profiles" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "site_reviews_uni_status_idx" ON "site_reviews" USING btree ("university_id","status","created_at");--> statement-breakpoint
CREATE INDEX "site_submissions_lookup_idx" ON "site_submissions" USING btree ("university_id","kind","fingerprint","created_at");--> statement-breakpoint
CREATE INDEX "site_team_uni_idx" ON "site_team" USING btree ("university_id","position");--> statement-breakpoint
CREATE INDEX "site_testimonials_uni_idx" ON "site_testimonials" USING btree ("university_id","position");--> statement-breakpoint
CREATE INDEX "site_videos_uni_idx" ON "site_videos" USING btree ("university_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "plat_alerts_one_live_uq" ON "plat_alerts" USING btree ("university_id","kind") WHERE "plat_alerts"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "plat_alerts_open_idx" ON "plat_alerts" USING btree ("resolved_at","created_at");--> statement-breakpoint
CREATE INDEX "plat_content_flags_course_idx" ON "plat_content_flags" USING btree ("course_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "plat_course_reviews_course_uq" ON "plat_course_reviews" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plat_invoices_number_uq" ON "plat_invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "plat_invoices_university_idx" ON "plat_invoices" USING btree ("university_id","issue_date");--> statement-breakpoint
CREATE UNIQUE INDEX "plat_licences_university_uq" ON "plat_licences" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "plat_partner_contacts_partner_idx" ON "plat_partner_contacts" USING btree ("partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plat_partner_contacts_one_primary_uq" ON "plat_partner_contacts" USING btree ("partner_id") WHERE "plat_partner_contacts"."is_primary";--> statement-breakpoint
CREATE INDEX "plat_partner_notes_partner_idx" ON "plat_partner_notes" USING btree ("partner_id","created_at");--> statement-breakpoint
ALTER TABLE "content_sections" ADD CONSTRAINT "content_sections_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_sections" ADD CONSTRAINT "content_sections_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_lessons" ADD CONSTRAINT "content_lessons_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_lessons" ADD CONSTRAINT "content_lessons_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_lessons" ADD CONSTRAINT "content_lessons_section_id_content_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."content_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_sections_course_idx" ON "content_sections" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "content_lessons_section_idx" ON "content_lessons" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "content_lessons_course_idx" ON "content_lessons" USING btree ("course_id","required","ready");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "content_lessons" ADD CONSTRAINT "content_lesson_kind" CHECK ("content_lessons"."kind" in ('video', 'pdf', 'text', 'link', 'live'));--> statement-breakpoint
ALTER TABLE "content_lessons" ADD CONSTRAINT "content_lesson_duration" CHECK ("content_lessons"."duration_minutes" >= 0 and "content_lessons"."duration_minutes" <= 6000);--> statement-breakpoint
ALTER TABLE "content_lessons" ADD CONSTRAINT "content_lesson_drip" CHECK (("content_lessons"."drip_mode" = 'none' and "content_lessons"."drip_days" is null and "content_lessons"."drip_date" is null)
     or ("content_lessons"."drip_mode" = 'after_start' and "content_lessons"."drip_days" is not null and "content_lessons"."drip_days" >= 0 and "content_lessons"."drip_date" is null)
     or ("content_lessons"."drip_mode" = 'on_date' and "content_lessons"."drip_days" is null and "content_lessons"."drip_date" is not null));--> statement-breakpoint
-- Wave 1 integration (hand-written): back-fill content_lessons.ready for lessons that existed
-- before the rename, using content-progress's hasContent rule (src/modules/content-progress/lib/kinds.ts).
UPDATE "content_lessons" SET "ready" = (
  CASE "kind"
    WHEN 'live' THEN true
    WHEN 'video' THEN (
      ("content"->>'source' = 'upload' AND coalesce("content"->>'key', '') <> '' AND coalesce("content"->>'fileName', '') <> '')
      OR ("content"->>'source' IN ('youtube', 'vimeo') AND coalesce("content"->>'videoId', '') <> '')
    )
    WHEN 'pdf' THEN coalesce("content"->>'key', '') <> '' AND coalesce("content"->>'fileName', '') <> ''
    WHEN 'text' THEN btrim(regexp_replace(coalesce("content"->>'html', ''), '<[^>]*>', '', 'g')) <> ''
    WHEN 'link' THEN coalesce("content"->>'url', '') <> ''
    ELSE false
  END
);
