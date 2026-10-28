// Tests run against a separate database so dev data is never touched.
process.env.DATABASE_URL_OWNER = process.env.TEST_DATABASE_URL_OWNER ?? "postgres://zinny_owner:zinny@localhost:5432/zinny_test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://zinny_app:zinny_app@localhost:5432/zinny_test";
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;
