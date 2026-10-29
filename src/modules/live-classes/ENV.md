# live-classes: environment variables

None. live-classes uses only what core already configures (the database, `CRON_SECRET` for
the jobs endpoint).

Its jobs run through core's `GET /api/jobs/run`:

- `every=hour`: `live-classes.close-sessions` marks no-shows absent once a class run through Zinny has ended.
- `every=day`: `live-classes.weekly-alerts` sends low-attendance alerts once a week (the first run from Monday).

Production needs both cron entries (`?every=hour` and `?every=day`) to call that endpoint.
