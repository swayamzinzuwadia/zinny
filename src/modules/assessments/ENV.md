# assessments: environment variables

None. The module uses only what core already provides (the database URLs, and `CRON_SECRET` for `/api/jobs/run?every=minute`, which runs `assessments.close-expired-attempts`).
