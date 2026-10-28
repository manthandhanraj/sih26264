# Vercel + Supabase setup

Samanvay has two storage modes. `python runner.py` keeps the local SQLite demo. The Vercel entry point uses shared PostgreSQL and private Supabase Storage. Vercel never falls back to a temporary local database.

## 1. Create the cloud project

Create a Supabase project in your own account. Keep its database password private. In its SQL Editor, paste and run **all of `supabase/setup.sql`**, not just selected table statements. Include the final `COMMIT`, cache refresh and verification query. The result should show **`app_functions = 11` and `private_bucket = true`**. The script creates the app's tables/RPCs and a private `samanvay-private` bucket with a 5 MB object limit. Anonymous and normal Supabase authenticated clients cannot access app tables/RPCs. Do not make this bucket public or add anonymous object policies.

## 2. Fill the private local environment file

Run `npm run cloud:setup`. It creates `.env.local` only if one does not already exist, and generates a random maintenance secret without printing it. Edit that private file:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Your project's HTTPS API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | A server-only Supabase secret key or legacy `service_role` key; **not** an anon/publishable key |
| `SUPABASE_STORAGE_BUCKET` | `samanvay-private` |
| `SAMANVAY_PUBLIC_URL` | Your exact HTTPS site origin, initially `https://sih26264.vercel.app` |
| `CRON_SECRET` | Keep the generated random value |

Do not paste a key into chat, commit it, prefix it with `NEXT_PUBLIC_`, or put it in a frontend file. `.env.local` is excluded by Git and Vercel upload rules. `.env.example` contains names and empty placeholders only.

Run:

```powershell
npm run cloud:check
```

This checks the schema and private bucket using a temporary synthetic storage object, then removes the test object. It does not seed or replace cloud casework. A failure means setup still needs attention; do not skip it.

## 3. Preserve existing local records before the first cloud request

If you want the existing local complaints, run **before adding cloud variables to Vercel/redeploying**:

```powershell
npm run cloud:migrate
```

The migration reads a consistent, read-only SQLite snapshot; saves a private local export under `data/backups/`; verifies and uploads evidence under new immutable cloud names; and initializes the cloud state only if it is empty. User password hashes are preserved. Active local sessions are not copied; sign in again on the hosted site. The local database and evidence are not replaced.

If cloud casework is already initialized, migration refuses to overwrite it. Do not delete populated cloud tables to retry; use a separate empty project or arrange a deliberate data migration. If you skip local migration, the first cloud API request initializes the 12 synthetic seed complaints and six demo accounts instead.

## 4. Configure Vercel

Use the repository root containing `package.json`, `api/` and `vercel.json`.

| Setting | Value |
| --- | --- |
| Framework Preset | Other |
| Node.js version | 24.x |
| Install Command | Default npm install, or `npm ci` |
| Build Command | From `vercel.json`: `node scripts/check-cloud-config.mjs --build` |
| Output Directory | `public` |

In Vercel's **Environment Variables**, add the same five variable names/values from `.env.local` to **Production**. Do not put secrets in `vercel.json`. Initially leave Preview unconfigured; a preview needs its own matching public origin and preferably a separate Supabase project, so test changes do not modify production data.

Commit/push the source changes and redeploy after setting the variables. Do not use `runner.py` or `npm start` as the Vercel build command. `api/index.mjs` is the serverless request handler; it opens no listening port and creates no local database/lock files.

## 5. Verify the hosted site

1. Open `/api/health`: expect `database: PostgreSQL`, `storage: private-cloud` and `sessions: shared`. It must not disclose local paths.
2. Test all six demo logins. Open a second browser session and confirm that new casework is visible to the correct responsible accounts.
3. Upload a small synthetic evidence file, then a file near 5 MB. Files go directly to the private bucket using a short-lived signed upload; the app verifies the actual bytes before attaching them. Downloads are authorized and integrity-checked before issuing a 60-second signed URL.
4. Test CSV/Excel preview, remapping and save across different requests. Previews are persisted; stale edits are rejected and repeat commits return the saved receipt.
5. Create an Admin backup. Cloud backups contain a gzipped JSON snapshot, hashed user records and matching private evidence copies. Active sessions are deliberately excluded. The downloaded JSON references the matching private evidence copies; retain those objects for recovery.
6. Redeploy once and confirm the same cloud records and sessions remain available. Do not describe this step as verified until it has actually been performed.

## Cloud operational behaviour

- Each invocation loads a fresh snapshot. PostgreSQL compares its revision atomically before saving. Concurrent stale writes return 409 instead of silently replacing another officer's changes. The current app stores its coordinated casework as one versioned JSONB document; this preserves cross-case rules but is intended for the prototype's workload, not unlimited-scale analytics.
- Sessions and login attempt counters live in PostgreSQL. They survive cold starts, function replacement and deploys. HTTPS cookies are `Secure`, `HttpOnly` and `SameSite=Strict`. Browser API requests accept the configured site origin and this project's deployment/branch aliases supplied by Vercel's environment. Unrelated origins and wildcard access to other Vercel projects are rejected.
- The local SSE stream is replaced on Vercel by the existing **30-second polling** and manual Refresh. Each poll reads shared data. Cloud mode does not claim a persistent cross-function SSE connection.
- SLA work runs when the app is used, at most once per minute, and through the authenticated daily cron in `vercel.json`. The supplied daily schedule works with Vercel Hobby; it does **not** guarantee minute-by-minute processing while the site is unused. A more frequent external scheduler can call the same `/api/cron` endpoint with `Authorization: Bearer <CRON_SECRET>` if required.
- The daily maintenance endpoint also creates a backup if none exists for that India-calendar day, expires old sessions/previews/login attempts and removes abandoned pending uploads. Keep the maintenance secret private.
- A missing key/schema/bucket produces a clear 503 setup message. A successful build alone is not confirmation of a working database connection. Exact runtime errors belong in Vercel runtime logs; secret values are never returned to the browser.
- Public demo credentials remain intentional. This is a synthetic reviewer demo, not a production system for real complaints. Quotas/billing belong to your selected Supabase and Vercel plans.

## Verification commands

```powershell
npm test
python -m unittest discover -s test -p test_runner.py -v
npm run cloud:check
```

The automated cloud tests execute `supabase/setup.sql` in a real local PostgreSQL engine and simulate private object storage. They check the app across independent request instances. They do not replace live Supabase, real signed-upload/CORS, Vercel packaging or hosted browser verification.

Official references: [Supabase API](https://supabase.com/docs/guides/api), [database functions](https://supabase.com/docs/guides/database/functions), [signed uploads](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl), [Vercel payload limits](https://vercel.com/docs/functions/limitations), [Vercel cron plans](https://vercel.com/docs/cron-jobs/usage-and-pricing).
