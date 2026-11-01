ALTER TYPE "public"."role_name" ADD VALUE 'custom_institute';--> statement-breakpoint
ALTER TYPE "public"."role_name" ADD VALUE 'custom_department';--> statement-breakpoint
ALTER TYPE "public"."role_name" ADD VALUE 'custom_platform';--> statement-breakpoint
CREATE TABLE "custom_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid,
	"kind" "role_name" NOT NULL,
	"name" text,
	"description" text DEFAULT '' NOT NULL,
	"actions" text[] NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_assignments" ADD COLUMN "custom_role_id" uuid;--> statement-breakpoint
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_roles_uni_idx" ON "custom_roles" USING btree ("university_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_roles_name_uq" ON "custom_roles" USING btree (coalesce("university_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name")) WHERE "custom_roles"."name" is not null and "custom_roles"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_roles_edit_uq" ON "custom_roles" USING btree (coalesce("university_id", '00000000-0000-0000-0000-000000000000'::uuid),"kind") WHERE "custom_roles"."name" is null;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_custom_role_id_custom_roles_id_fk" FOREIGN KEY ("custom_role_id") REFERENCES "public"."custom_roles"("id") ON DELETE no action ON UPDATE no action;