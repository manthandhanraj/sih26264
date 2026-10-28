# Final demo check — 28 October 2026

**Automated workflows, local checks and production cloud API checks pass. A fresh rendered desktop/mobile review remains pending.**

## Verified

- `npm test`: **114 passed, 0 failed**, including 17 cloud checks and 12 offline screen/form tests. All 3 Python launcher lifecycle checks also passed.
- `npm run demo:check`: all six public demo accounts authenticated on the running local app; case safeguards, internal-data privacy and authority boundaries passed.
- The live check preserved the **15 existing complaints**. It added no complaint, action, evidence, dependency or policy-run records.
- New workflows are exercised on isolated synthetic test databases, including persistence after server restart.

| Account | Visible complaints in this run | Coordination lab | Administration |
| --- | ---: | --- | --- |
| Admin | 15 | Allowed | Allowed |
| PGRC | 9 | Allowed | Denied |
| Regulation | 8 | Allowed | Denied |
| Regional | 6 | Allowed | Denied |
| Student | 13 | Denied | Denied |
| Faculty | 2 | Denied | Denied |

Visible case counts include permitted coordination access. They do not mean that every visible case is editable. Student and faculty records were checked against their respective owner IDs; internal coordination fields were absent from their case responses.

| USP workflow | Automated result |
| --- | --- |
| Action Collision Guard | Same-issue collision, reuse, joint approval, senior exception, stale-check rejection and independent matters pass. |
| Deadlock Radar | Cycles, ordinary chains, completed prerequisites, senior releases and notification deduplication pass. |
| Evidence Passport | Source approval, scoped downloads, immutable versions, review invalidation and file-integrity failures pass. |
| Resolution Proof Check | Category checklist, selected evidence, objections, open blockers, stale reviews, disposal and reopening pass. |
| Policy Sandbox | Senior scope, aggregate results, saved runs and preservation of live policy/casework pass. |

## Issues fixed during this check

1. Editing a proposal during a slow collision request now discards the old result.
2. A delayed policy result or case-loading error cannot replace content after an account/page change.
3. A completed save no longer reopens a case that the reviewer closed while waiting.
4. Action saves submit only the proposal, decision and check token, without copying potentially large collision histories into the request.
5. Disposed cases label their saved proof as a historical disposal review, rather than asking for another closure review.
6. Form columns and controls constrain long dropdown values on narrow screens; lab case titles use the existing responsive case-card styles. These are source-level layout fixes, not a measured browser-layout pass.

## Remaining visual check

Local browser access was previously rejected by browser security. No alternate browser or automation route was used to bypass that restriction. This run could inspect the browser inventory, but it had no app tab available for the walkthrough. Offline DOM tests validate markup and handlers; they do not measure rendered layout, scrolling, touch targets or screenshots.

The remaining manual pass is:

- Open the local app at `http://127.0.0.1:3000` and refresh with **Ctrl + Shift + R**.
- On desktop, check login, the six account workspaces, Coordination lab, case tabs, long titles and proof records. Follow the functional exercise in `SAFEGUARDS_GUIDE.md`.
- On a narrow mobile view, check the same navigation, forms, case tabs, dropdowns, tables and dialogs for horizontal page overflow, obscured buttons and unreadable text. Tables may scroll within their containers.
- Capture desktop and mobile views of **Coordination lab** and a case's **Safeguards** tab to finish the visual review.

Do not mark the complete desktop/mobile walkthrough as passed until that rendered check has been performed. The 26 October frontend check did not include deployment. The 28 October cloud verification below supersedes that deployment status; it does not claim a new rendered browser walkthrough.

## Repeatable checks

```text
npm test
npm run demo:check
python runner.py --status
```

The live audit writes `qa-artifacts/demo-live-check.json`, with account counts and results but no passwords or session cookies. The launcher lifecycle tests passed in the preceding safeguards upgrade; they were not repeated for this frontend-only fix.


## Production cloud verification · 28 October 2026

The synthetic reviewer demo is live at **https://sih26264.vercel.app** on Vercel, using shared Supabase PostgreSQL, private evidence storage and shared sessions. Migration preserved the 15 complaints, 11 institutions, 6 accounts and 1 existing evidence file. Local SQLite/evidence remain available with a private before-migration export under `data/backups/`.

Real cloud storage passed a full 5 MB signed upload/download, upload CORS, digest comparison, anonymous-read denial and test-file cleanup. The cloud-backed API passed all six login, authority/privacy, safeguards, evidence-download and logout checks. A private cloud backup was created and its snapshot verified. The public production URL passed the same six-account checks and retained all complaint IDs.

Private environment files and local databases/evidence were excluded from the deployment upload. Production server/maintenance keys are stored as Vercel Secret variables. The local upload plan contained empty ignored-directory markers, but no private file contents or environment files.

Reports: ignored `qa-artifacts/cloud-storage-live-check.json`, `cloud-api-live-check.json` and `cloud-app-live-check.json`. These are API/storage checks; they do not establish fresh rendered desktop/mobile signoff. See `VERCEL_SETUP.md` for polling, scheduled-job and prototype workload limits.
