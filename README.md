# Samanvay — SIH26264

Developed by **Manthan Dhanraj**. A local, role-based institution complaint coordination app. Synthetic records only; not an official AICTE service.

## Run

Requires **Node.js 24.x**. Install dependencies with `npm ci`. The local demo needs no API key.

```sh
python runner.py
```

The runner starts a background supervisor, prints the localhost URL (normally http://127.0.0.1:3000) and keeps a live status monitor open. It shows availability and automatic restarts instead of immediately returning to the prompt. Ctrl+C closes only the monitor; closing its terminal also leaves the background server running. Starting again reuses the same project instead of creating a second database writer. A busy port falls back through 3020.

- Check: `python runner.py --status`
- Stop: `python runner.py --stop`
- Restart: `python runner.py --restart`
- Start and return immediately: `python runner.py --background` (also works with `--restart`)
- Terminal mode: `python runner.py --foreground` (Ctrl+C stops it)

Unexpected server exits are logged and automatically restarted with a delay. Five rapid exits within five minutes stop recovery and report the error, preventing an endless failure loop. Logs rotate in `data/logs/server.log`; process/restart status is in `data/runner.json`. Explicit Stop does not trigger a restart. This is background execution for the current Windows session, not an installed service or automatic startup after a reboot.

A server started separately using `npm start` or the older runner can be monitored and recovered if it exits. Stopping that monitor leaves the separately started server running; stop it from its original terminal. The normal background-managed server supports clean stop/restart, including SQLite and live-stream cleanup.

`npm start` remains a foreground alternative; closing its terminal stops that process.

## Demo access

For Vercel hosting with shared cloud casework, sessions and private evidence storage, follow [VERCEL_SETUP.md](VERCEL_SETUP.md). Cloud mode requires your own Supabase project and server-only environment variables; `runner.py` remains the local launcher.

Six separate accounts are shown on the sign-in page with one-click Explore buttons and visible credentials. A **Demo accounts** button allows switching after login. See [DEMO_ACCOUNTS.md](DEMO_ACCOUNTS.md) for all passwords and a complete review walkthrough.

## Position hierarchy

Admin (L4) has the highest authority across all bureaus/regions, SLA policy, backups and the protected account access directory. Regional Officers (L3) supervise their region and approve transfers/lead appointments. Bureau Officers (L2) process their bureau complaints and request senior approval for transfers; routing, priority and deadlines remain senior-controlled. Complainants (L1) can act only on their own cases. Every position has a distinct landing workspace. These boundaries are enforced by the API, not just hidden controls.

## Coordination safeguards

All five coordination workflows are implemented. Use **Coordination lab** in the sidebar and **Safeguards** inside a case. See [SAFEGUARDS_GUIDE.md](SAFEGUARDS_GUIDE.md) for permissions, limitations and the reviewer walkthrough.

- **Action Collision Guard:** server-rechecked institution/issue/action matching, reuse, joint approval and reasoned senior exceptions with coordination receipts.
- **Deadlock Radar:** recorded case/task prerequisites, dependency cycles, deduplicated notifications and audited senior releases.
- **Evidence Passport:** source-controlled case sharing, immutable file versions, uploader/digest metadata and review invalidation when evidence changes.
- **Resolution Proof Check:** category-specific checklist, verified file consistency, recorded remedy, complainant objections and mandatory server-side closure checks.
- **Policy Sandbox:** senior-scoped aggregate SLA/routing comparisons, assumptions and saved runs without modifying live casework or policy.

## Features

- Admin, Bureau Officer, Regional Officer and Complainant roles with server-enforced access rules.
- Student and Faculty portals show only records owned by that user; internal notes/tasks are not returned to complainants.
- Scoped officer dashboards, complete region/category/date filters, pagination and filtered CSV exports; authenticated live events with reconnect and a polling fallback. Open forms defer refresh to preserve edits.
- Case workspace with Overview, Coordination, Evidence, Safeguards, Related cases and Timeline tabs.
- Registration, assignment, priority/deadline edits, bureau transfers, resolution and reopening.
- Public case conversations and clarification requests with Awaiting response → In progress transitions.
- Resolution feedback, ratings and complainant-requested reopening.
- Institution-level cross-bureau coordination alerts regardless of complaint topic, plus offline TF-IDF/LSA semantic suggestions and officer-confirmed links.
- Central institution directory with address/contact/aliases, consolidated complaints and actions, senior profile editing and history export.
- Admin CSV/Excel institution import with sheet selection, manual column mapping, row preview, duplicate/validation issue report, pre-save backup and idempotent atomic save. See [IMPORT_GUIDE.md](IMPORT_GUIDE.md).
- Separate pending, under-process, disposed, transferred, escalated and overdue metrics; bureau workload and institution status on staff dashboards.
- Institution/region/bureau/status reports, ageing, disposal rate, overlaps and monthly/quarterly performance with filter-aware CSV exports.
- Last action, responsible actor/date and explicit next action / task deadline in the case summary.
- Shared internal notes, group lead assignment, delegated action items and task completion.
- Configurable priority SLAs, reminders and automatic overdue escalation to Admin; in-app notifications with read state.
- SQLite WAL transactions, hashed passwords, HttpOnly/SameSite sessions, stale-edit protection and a single-server data lock.
- Evidence upload/download: PDF, PNG, JPEG, TXT; up to 5 MB/file and 10 files/case.
- Admin-created and daily automatic backups containing a SQLite snapshot and matching evidence folder.
- Responsive layouts, keyboard-accessible dialogs, retryable errors and no external font/script CDN dependency.

## Data and backups

Data is stored in `data/samanvay.sqlite`; evidence is under `data/attachments/`. On first upgrade, existing `data/cases.json` records are migrated and the original JSON file is preserved. SQLite becomes the authoritative store afterward.

Full backups are saved in `data/backups/backup-*/`, with the database, evidence and a manifest. The Admin download link exports the database file; use the matching local evidence folder for a complete copy. Backups contain account/session records and must be treated as private. Automatic jobs run only while the server is running. The UI does not implement destructive restore; test recovery using a separate directory before replacing any live data.

## Semantic model

`src/matching-model.json` contains a bundled 12-dimensional TF-IDF/LSA model trained on 72 synthetic complaint documents. It handles supported complaint topics and common Hinglish terms without downloading a model. Scores are semantic similarities, not duplicate probabilities. The model is small, domain-specific and not a pretrained multilingual language model; unfamiliar issues and complex language can be missed. Officers verify suggested links. To rebuild, run `python scripts/train_matching.py` with NumPy installed; Python/NumPy is not needed for normal Node runtime inference.

## Verification

`npm test` runs isolated validation, matching, authentication, permission, workflow, evidence, concurrency, backup-integrity and restart tests. API tests need a localhost socket and use temporary data, not workspace records. See [QA.md](QA.md) for verification details.

## Demo boundaries

Demo credentials are intentionally public. Local mode binds to localhost; the optional Vercel/Supabase mode serves a synthetic reviewer demo with shared sessions, HTTPS/Secure cookies, configured-origin checks and private evidence storage. It has no official AICTE integration, real email/SMS provider, malware scanning, account recovery, MFA or tamper-proof audit storage. A production service for real complaints still needs privately provisioned accounts, security review and operational monitoring. No real personal data should be entered into this demo. See [VERCEL_SETUP.md](VERCEL_SETUP.md) for polling, scheduling, backup and workload limits.

## Sharing the source on GitHub

The six demo identities/passwords and the developer credit are intentionally public. The source contains synthetic example complaints; sharing it does not turn the app into a production service.

Keep databases, evidence, backups, sessions, local secrets, temporary assets, generated presentations and machine-specific test reports out of the public repository. These are excluded by `.gitignore`; do not force-add ignored files. Ignore rules do not remove files already committed, so review the staged files and existing history before publishing.

Use a repository limited to this project. Check `git rev-parse --show-toplevel` before adding or pushing files: a parent workspace repository may include unrelated projects and private files outside this app.

## Design previews

The default is the selected Sandstone Editorial theme across login, role dashboards and case screens. Optional command-center visual previews are available at `/?design=emerald#overview`, `/?design=civic#overview` and `/?design=midnight#overview` after signing in as Admin. Other query themes remain optional visual previews. Saved preview pictures are in `design-options/`.

## Problem statement mapping

See [REQUIREMENTS.md](REQUIREMENTS.md) for every requested feature, exact definitions, review steps and verification limits.

Launcher lifecycle checks: `python -m unittest discover -s test -p test_runner.py -v` uses isolated temporary databases to test terminal-independent startup, duplicate prevention, crash recovery, deliberate stop and bounded failure logging.


## Final demo verification

Run `npm test` for isolated automated workflows and `npm run demo:check` for a running local app's six-account access/privacy check. The latter preserves complaints and writes `qa-artifacts/demo-live-check.json`. See [FINAL_DEMO_CHECK.md](FINAL_DEMO_CHECK.md) for verified results and the remaining rendered desktop/mobile walkthrough.
