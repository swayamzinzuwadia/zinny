ALTER TABLE "idn_sessions" ADD COLUMN "scope_university_id" uuid;--> statement-breakpoint
CREATE INDEX "audit_actor_at_idx" ON "audit_log" USING btree ("actor_user_id","at");--> statement-breakpoint
CREATE INDEX "batches_uni_status_idx" ON "batches" USING btree ("university_id","status");--> statement-breakpoint
CREATE INDEX "batches_dept_idx" ON "batches" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "courses_uni_status_idx" ON "courses" USING btree ("university_id","status");--> statement-breakpoint
CREATE INDEX "enrolments_course_idx" ON "enrolments" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "enrolments_uni_status_idx" ON "enrolments" USING btree ("university_id","status");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_uni_created_idx" ON "orders" USING btree ("university_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_enrolment_idx" ON "orders" USING btree ("enrolment_id");--> statement-breakpoint
CREATE INDEX "orders_batch_idx" ON "orders" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "parent_links_student_idx" ON "parent_links" USING btree ("student_user_id");--> statement-breakpoint
CREATE INDEX "programs_dept_idx" ON "programs" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "role_assignments_uni_role_idx" ON "role_assignments" USING btree ("university_id","role") WHERE "role_assignments"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "session_overrides_batch_date_idx" ON "session_overrides" USING btree ("batch_id","date");--> statement-breakpoint
CREATE INDEX "assess_attempts_batch_idx" ON "assess_attempts" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "assess_attempts_course_idx" ON "assess_attempts" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "content_lesson_progress_course_idx" ON "content_lesson_progress" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "mkt_listings_university_idx" ON "mkt_listings" USING btree ("university_id","status");--> statement-breakpoint
CREATE INDEX "plat_seat_packs_invoice_idx" ON "plat_seat_packs" USING btree ("invoice_id");