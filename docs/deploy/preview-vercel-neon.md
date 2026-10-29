# Preview on free Vercel and Neon

A shareable preview of Zinny with the demo data. It runs on Vercel's free Hobby plan with a free Neon Postgres database, deployed from GitHub. Production stays on AWS; this is only for showing and testing.

You need about 20 minutes. Keep a notes file open: you'll copy a few values from one site to another.

## 1. Neon: the database

1. Go to **neon.tech** and sign up (Sign in with GitHub is quickest).
2. Click **New project**.
   - Name: `zinny-preview`
   - Postgres version: **16**
   - Region: **AWS Asia Pacific (Singapore)**, the closest to Mumbai. If **Mumbai (ap-south-1)** is listed, pick that instead.
   - Click **Create project**.
3. On the project dashboard, click **Connect**.
   - Turn **Connection pooling** **off**, and copy the connection string. This is the **owner URL** (it starts with `postgresql://neondb_owner:`). Save it in your notes as `OWNER_URL`.
   - Turn **Connection pooling** **on**, and copy that string too. Save it as `POOLED_OWNER_URL`. Its host has `-pooler` in it.
4. Make up a long random password for the app's own database user (letters and numbers, 24 or more characters). Save it as `APP_PASSWORD`.

## 2. GitHub: create the tables and demo data

1. Open the Zinny repository on GitHub, then **Settings → Secrets and variables → Actions → New repository secret**. Add two secrets:
   - `PREVIEW_DATABASE_URL_OWNER` = your `OWNER_URL`
   - `PREVIEW_APP_DB_PASSWORD` = your `APP_PASSWORD`
2. Go to **Actions → Preview database → Run workflow**, leave **reset** unticked, and click **Run workflow**.
3. Wait until it shows a green tick (about 5 minutes). It creates the app user `zinny_app`, the tables with row-level security, and the Demo University.

You can run it again at any time to restore the demo data. Tick **reset** only if you want to wipe the whole database first.

## 3. Vercel: the app

1. Go to **vercel.com** and sign up with GitHub.
2. Click **Add New → Project**, find the Zinny repository and click **Import**.
3. Leave the framework (Next.js) and build settings as they are. Open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | your `POOLED_OWNER_URL`, with `neondb_owner:<password>` replaced by `zinny_app:<APP_PASSWORD>` |
   | `DATABASE_URL_OWNER` | your `OWNER_URL` |
   | `AUTH_SECRET` | a new random string of 32 or more characters |
   | `CRON_SECRET` | another new random string of 32 or more characters |
   | `ZINNY_DEMO` | `1` |
   | `APP_URL` | `https://<project>.vercel.app` (see step 5) |
   | `CERTIFICATE_VERIFY_BASE_URL` | the same as `APP_URL` |
   | `STORAGE_DIR` | `/tmp/zinny-storage` |

   Use letters and numbers only in `APP_PASSWORD`, so it needs no escaping inside `DATABASE_URL`.

4. Click **Deploy**. The first build takes about 4 minutes.
5. When it's done, Vercel shows the address, for example `https://zinny-preview.vercel.app`. If it differs from what you put in `APP_URL` and `CERTIFICATE_VERIFY_BASE_URL`, go to **Settings → Environment Variables**, correct both, then go to **Deployments**, open the menu (⋯) on the latest deployment and click **Redeploy**.

## 4. Try it

Open `https://<your address>/login`. Demo accounts appear on the sign-in page (because `ZINNY_DEMO=1`), and every demo account's password is `zinny123`. For example:

- `asha@demo.edu`: Institute Admin
- `hema@demo.edu`: Head of Department
- `riya@demo.edu`: student
- `zara@zinny.demo`: Zinny team (opens `/platform`)

## What doesn't work on this preview

Say this plainly to anyone you share the link with:

- **Files.** Vercel has no lasting disk, and the preview has no file storage (S3 or R2) set up. The demo's videos, PDFs, certificate PDFs, signatures and photos were created when the database was seeded and aren't on Vercel, so opening or downloading them fails. New uploads may appear to work but can vanish within minutes. Browsing every page works. To fix this later, add a Cloudflare R2 bucket and set `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` in Vercel.
- **Emails and texts.** None are sent. With no Resend or MSG91 keys they would only print to Vercel's logs, and the delivery job runs every minute, which the free plan can't schedule.
- **Scheduled jobs.** Only the daily job runs (at 00:15 India time). The minute and hourly jobs don't run: tests whose time ran out aren't closed while the student is away, poll announcements and payment reconciliation wait, and attendance no-shows are marked only when a register is locked.
- **Payments.** Test mode only. Paying uses the "Pay (test mode)" button and no money moves.
- **Speed.** Neon's free database sleeps after a few idle minutes, so the first page after a pause takes a few seconds.
