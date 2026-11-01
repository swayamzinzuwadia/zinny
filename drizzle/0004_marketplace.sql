CREATE TABLE "mkt_learners" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mkt_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_lesson_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_paise" integer NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mkt_listing_kind" CHECK ("mkt_listings"."kind" in ('course', 'lecture')),
	CONSTRAINT "mkt_listing_status" CHECK ("mkt_listings"."status" in ('live', 'paused')),
	CONSTRAINT "mkt_listing_price" CHECK ("mkt_listings"."price_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "recorded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mkt_learners" ADD CONSTRAINT "mkt_learners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_listings" ADD CONSTRAINT "mkt_listings_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_listings" ADD CONSTRAINT "mkt_listings_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_listings" ADD CONSTRAINT "mkt_listings_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_listings" ADD CONSTRAINT "mkt_listings_source_lesson_id_content_lessons_id_fk" FOREIGN KEY ("source_lesson_id") REFERENCES "public"."content_lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_listings" ADD CONSTRAINT "mkt_listings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mkt_listings_course_uq" ON "mkt_listings" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "mkt_listings_status_idx" ON "mkt_listings" USING btree ("status","created_at");