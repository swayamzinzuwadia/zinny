-- The hidden batch a course's marketplace buyers sit in shows on invoices and reports: name it for what it is.
UPDATE "batches" SET "name" = 'Recorded lessons' WHERE "recorded" = true AND "name" = 'Marketplace buyers';
