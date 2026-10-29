# content-progress: environment variables

This module adds no environment variables of its own.

Lesson videos and PDFs are stored through core `storage()`, so they follow the existing storage settings:

- Local disk (default): `STORAGE_DIR` (optional, default `./.storage`) and `STORAGE_SIGNING_SECRET` for signed links.
- S3-compatible bucket (Cloudflare R2 in production): `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, optionally `S3_REGION`.

With S3/R2, the bucket must allow `GET` with `Range` requests from the app's origin (CORS), so the lesson player can stream videos and pdf.js can read PDFs through signed URLs.

Hourly and daily jobs (`content-progress.complete-finished`, `content-progress.clean-uploads`) run through `GET /api/jobs/run`, guarded by the existing `CRON_SECRET`.
