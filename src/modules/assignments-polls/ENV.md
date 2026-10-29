# assignments-polls environment variables

None of its own. Files go through core storage (`storage()` in `@/server/core`), so in
production set the core storage variables: `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_BUCKET`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (and `S3_REGION`, default `auto`). Locally files
land in `./.storage` and links are signed with `STORAGE_SIGNING_SECRET`.

The reminder job (`assignments-polls.daily`) and the poll announcer
(`assignments-polls.announce-polls`) run through core's `/api/jobs/run`, guarded by `CRON_SECRET`.

Uploads are sent in 4 MB parts, so they fit under Vercel's 4.5 MB request limit with no
extra configuration.
