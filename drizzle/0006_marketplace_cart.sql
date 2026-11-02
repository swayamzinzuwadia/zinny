CREATE TABLE "mkt_cart_items" (
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mkt_cart_items_user_id_listing_id_pk" PRIMARY KEY("user_id","listing_id")
);
--> statement-breakpoint
CREATE TABLE "pay_bundle_orders" (
	"bundle_id" uuid NOT NULL,
	"order_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"total_paise" integer NOT NULL,
	"gateway" text NOT NULL,
	"gateway_order_id" text NOT NULL,
	"gateway_payment_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "pay_bundle_status" CHECK ("pay_bundles"."status" in ('pending', 'paid', 'failed', 'expired')),
	CONSTRAINT "pay_bundle_total" CHECK ("pay_bundles"."total_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "mkt_cart_items" ADD CONSTRAINT "mkt_cart_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mkt_cart_items" ADD CONSTRAINT "mkt_cart_items_listing_id_mkt_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."mkt_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_bundle_orders" ADD CONSTRAINT "pay_bundle_orders_bundle_id_pay_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."pay_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_bundle_orders" ADD CONSTRAINT "pay_bundle_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_bundles" ADD CONSTRAINT "pay_bundles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pay_bundle_orders_order_uq" ON "pay_bundle_orders" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "pay_bundle_orders_bundle_idx" ON "pay_bundle_orders" USING btree ("bundle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_bundles_gateway_order_uq" ON "pay_bundles" USING btree ("gateway_order_id");--> statement-breakpoint
CREATE INDEX "pay_bundles_user_idx" ON "pay_bundles" USING btree ("user_id","created_at");