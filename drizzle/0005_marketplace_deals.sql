CREATE TABLE "mkt_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"value" integer NOT NULL,
	"listing_id" uuid,
	"starts_on" text,
	"ends_on" text,
	"max_uses" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mkt_code_kind" CHECK ("mkt_codes"."kind" in ('percent', 'amount')),
	CONSTRAINT "mkt_code_status" CHECK ("mkt_codes"."status" in ('active', 'paused')),
	CONSTRAINT "mkt_code_value" CHECK ("mkt_codes"."value" > 0 and ("mkt_codes"."kind" <> 'percent' or "mkt_codes"."value" <= 90)),
	CONSTRAINT "mkt_code_uses" CHECK ("mkt_codes"."max_uses" is null or "mkt_codes"."max_uses" > 0)
);
--> statement-breakpoint
CREATE TABLE "mkt_combo_courses" (
	"listing_id" uuid NOT NULL,
	"university_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mkt_combo_courses_listing_id_course_id_pk" PRIMARY KEY("listing_id","course_id")
);
--> statement-breakpoint
CREATE TABLE "mkt_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"code_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"discount_paise" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mkt_listings" DROP CONSTRAINT "mkt_listing_kind";--> statement-breakpoint
ALTER TABLE "mkt_listings" ADD COLUMN "compare_at_paise" integer;--> statement-breakpoint
ALTER TABLE "mkt_codes" ADD CONSTRAINT "mkt_codes_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_codes" ADD CONSTRAINT "mkt_codes_listing_id_mkt_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."mkt_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_codes" ADD CONSTRAINT "mkt_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_combo_courses" ADD CONSTRAINT "mkt_combo_courses_listing_id_mkt_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."mkt_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_combo_courses" ADD CONSTRAINT "mkt_combo_courses_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_combo_courses" ADD CONSTRAINT "mkt_combo_courses_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_redemptions" ADD CONSTRAINT "mkt_redemptions_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_redemptions" ADD CONSTRAINT "mkt_redemptions_code_id_mkt_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."mkt_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_redemptions" ADD CONSTRAINT "mkt_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mkt_codes_code_uq" ON "mkt_codes" USING btree ("university_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "mkt_redemptions_order_uq" ON "mkt_redemptions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "mkt_redemptions_code_idx" ON "mkt_redemptions" USING btree ("code_id");--> statement-breakpoint
ALTER TABLE "mkt_listings" ADD CONSTRAINT "mkt_listing_compare_at" CHECK ("mkt_listings"."compare_at_paise" is null or "mkt_listings"."compare_at_paise" > "mkt_listings"."price_paise");--> statement-breakpoint
ALTER TABLE "mkt_listings" ADD CONSTRAINT "mkt_listing_kind" CHECK ("mkt_listings"."kind" in ('course', 'lecture', 'combo'));