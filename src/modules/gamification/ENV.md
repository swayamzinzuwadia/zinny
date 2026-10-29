# gamification environment variables

None. Gamification runs entirely on the core database, events and jobs.

The hourly job `gamification.close-challenges` runs through core's `GET /api/jobs/run?every=hour`
(guarded by the existing `CRON_SECRET`), so that cron must be scheduled for winners to be frozen
when a challenge ends. Until it runs, an ended challenge still shows its winners, computed live.
