# Verification — 21 October 2026

## Automated

69 checks passed in the expanded test suite. Coverage includes:

- Authentication for all six demo accounts, anonymous denial and session logout.
- Server-enforced bureau, regional, owner and admin permissions.
- Student/Faculty record isolation and hiding internal notes/tasks/history from complainants.
- Clarification requests, complainant replies, resolution feedback and reopening.
- Confirmed case links, group lead assignment, delegated tasks and task completion.
- SLA escalation and notification deduplication; admin-only policy changes.
- SQLite backup integrity and evidence-file copies.
- Malformed input, optimistic edit conflicts, evidence constraints and restart persistence.
- A semantic smoke test linking salary/remuneration wording and separating library/payroll topics. This is not a large-scale model accuracy evaluation.

## Historical browser checks — before the latest requirements upgrade

Verified student sign-in, private portal, authenticated complaint registration, account switching, PGRC case visibility, clarification request, internal note creation and assigned coordination task. The earlier iteration's search/filter/pagination/CSV and upload/download checks remain covered by API tests and the same core UI. Also verified Admin SLA check and backup creation, Regional Officer task completion, Student tracking/reply with status transition, and hiding internal coordination from the Student timeline. The portal was inspected at 390 × 844 without page-width overflow. Desktop login and case workspace were inspected at 1440 × 1000. All six account logins are covered by API tests; role switching is available in the browser account picker.

## Known limits

Synthetic localhost demo only. Notifications are in-app; external email/SMS is not connected. The semantic model is small and trained on synthetic text. Public demo credentials, no official integration, no malware scanner and no production security certification. Passing these checks is not a zero-bug guarantee.

## Position-specific upgrade

Verified the exact login heading “Demo accounts for every position” and “Developed by Manthan Dhanraj” credit. All six accounts open distinct workspace headings. Browser-verified a Bureau Officer transfer request with read-only senior controls, then a North Regional Officer approval which moved the case to Regulation Bureau. Automated coverage includes the protected Admin directory, hierarchy levels, prevention of unauthorized lead/priority changes, duplicate pending requests and repeated approval rejection.

Captured three command-center design previews at 1440 × 1100: Executive Emerald, Civic Blue and Midnight Copper. These are screenshots of the actual local UI. Default Emerald remains unchanged; alternative styles are preview directions for the command center. Verified the updated mobile Admin overview at 390 × 844 without horizontal page overflow, and observed no browser console errors during the final checks.

## Requirements completion checks

The expanded suite verifies institution profiles, regional/Admin edit authority, validation and stale-profile rejection; canonical aliases and access boundaries; unrelated-topic RB/PGRC alerts and deduplicated notifications; private last-action filtering; manual historical case mapping; combined required search filters and India-day boundaries; ageing, disposal rate and monthly/quarterly totals; authenticated SSE change delivery with no case content; and persistence after restart.

The latest browser pass is blocked by browser security policy. New institution/report views, seven dashboard metrics, live refresh notices and Sandstone layouts have not received a fresh rendered desktop/mobile visual pass. Historical browser results above do not establish that the newly added UI is visually verified.

## Existing-data smoke check

The updated local server started successfully on port 3000 using the existing SQLite database. Read-only checks found 15 cases, 11 institution profiles and 4 active cross-bureau alerts. Last/next action summaries were present. A full database/evidence backup was created successfully after the upgrade. No complaint records were created or edited by this smoke check.

## Launcher stability — 22 October 2026

The runner now defaults to a detached background supervisor, records rotating logs, prevents duplicate supervisors with an OS-held lease, and retries unexpected server exits with a bounded backoff. An explicit stop requests authenticated graceful shutdown and does not trigger recovery. Foreground mode remains available.

Verified with isolated temporary databases: launch command exits while server stays healthy; a repeated start reuses the same supervisor; terminating only the test child causes a replacement process; deliberate stop leaves no server lock, preserves SQLite integrity/case count and does not restart. A permanent startup conflict produced five logged exits and a stopped failed state. Windows status-file replacement retries and stop-during-startup handling were corrected during these checks. Python test-only SQLite connections are closed explicitly.

All 52 JavaScript checks passed after the server health/shutdown changes. The two Python lifecycle tests passed after corrections (the recovery/stop test was rerun individually after fixing its cleanup). The application was then backed up and migrated to supervised mode on port 3000. A separate command verified that the launch shell had exited, server health remained good and recovery was active; a shutdown request without the launcher token returned 403. No application records were edited by these lifecycle tests.

Commands: `python runner.py`, `python runner.py --status`, `python runner.py --stop`, `python runner.py --restart`, `python runner.py --foreground`. Logs: `data/logs/server.log`. This does not install Windows startup persistence; start the app again after reboot/sign-out.

## Institution import — 26 October 2026

69 automated checks passed after adding CSV/.xlsx institution import. New checks cover quoted/multiline UTF-8 CSV, case-insensitive repeated IDs, leading-zero text identifiers, manual/default-region mapping and AISHE separation, malformed/oversized input, actual multi-sheet Excel workbooks, formula/expansion rejection, Admin-only access, unchanged data during preview, valid-row-only commit, pre-import backup contents, registry visibility without complaints, retry idempotency, stale preview/directory conflicts, persistence and SQL transaction rollback. Templates use explicitly fictional institutions.

No real dataset has been imported into workspace records as part of this feature work. The new interface has source/syntax checks; a fresh rendered desktop/mobile walkthrough is pending because browser automation is unavailable.

The stopped workspace app received a verified offline pre-update backup (15 cases). After startup, authenticated CSV and Excel template previews both returned one valid fictional example without saving it. Registry/case counts stayed at 11 institutions and 15 cases, the new client module was served successfully, and background server health was confirmed.


## Coordination safeguards upgrade · 26 October 2026

The five workflows and their permission boundaries are covered by `test/innovation.test.mjs`; offline screen/form checks are in `test/safeguards-ui.test.mjs`. Existing lifecycle tests now complete the mandatory proof review before disposing a case. See `SAFEGUARDS_GUIDE.md` for the full workflow and limitations.

Coverage includes stale action checks, same-issue versus independent actions, reuse/joint approval/senior exceptions, prerequisite cycles and task satisfaction, explicit sharing, immutable passport versions, stale proof across two desks, file integrity failures, complainant objections, category closure checks, policy isolation and persisted records after restart. Screen checks cover all six roles, selected version/revision submission, escaped text, rejected-save input preservation and access to the new case tab.

These offline DOM checks do not confirm rendered layout. A new browser/mobile visual walkthrough remains unverified because the earlier browser local-URL security restriction prevents that access. No alternative browser route was used to bypass it.

Verified result for this upgrade: **91 Node checks passed**, including six offline DOM checks, and **2 Python background-launcher lifecycle checks passed**. A live smoke check on `http://127.0.0.1:3000` authenticated all six demo accounts, confirmed their case/safeguard access and staff-only lab restrictions, and confirmed the original 15 cases were preserved. The updated app is running with background recovery enabled. A pre-upgrade SQLite/evidence backup was saved before startup.


## Final demo audit · 26 October 2026

**97 Node checks passed, 0 failed**, including 12 offline screen/form checks. `npm run demo:check` passed on all six running demo accounts and preserved the 15 saved complaints. The audit fixed stale in-flight proposal results, delayed results crossing account/page changes, unexpected case reopening after a delayed save, oversized action payloads and the historical proof label on disposed cases. Narrow-form sizing was hardened at the source level.

The detailed result and remaining desktop/mobile checklist are in `FINAL_DEMO_CHECK.md`; the live account report is `qa-artifacts/demo-live-check.json`. Actual browser/mobile rendering is still unverified because of the local-address browser security restriction. This status does not claim complete visual signoff.

## Launcher status window repair · 28 October 2026

The reported immediate closure was reproduced as the launcher returning after a successful background start. The existing workspace server was healthy, with recovery active and no recorded crash. Normal `python runner.py` now keeps a live availability/restart monitor open. Closing that monitor leaves the independently managed server running; `--stop` stops the app. `--background` preserves the immediate-return behaviour for automation. A fresh launch also waits for its own supervisor instead of treating a previous run's failed status as a new startup failure.

All **3 Python lifecycle tests passed** using isolated temporary databases. They cover background startup, duplicate prevention, crash recovery, deliberate shutdown, the default monitor staying open, server survival after closing its monitor, bounded startup errors and relaunch after a previous failure. The monitor lifecycle test passed again after the final shutdown-state race correction.

The actual workspace app was restarted with the repaired launcher. Its normal status monitor stayed open, closing only that monitor left the same server healthy, and SQLite quick-check returned `ok`. The saved ID sets/counts stayed at **15 complaints and 11 institutions**. All **6 demo account** login, authority and privacy checks passed after restart. Reports: `qa-artifacts/runner-live-check.json` and `qa-artifacts/demo-live-check.json`. No browser visual review was performed for this launcher change.

## Public source privacy check · 28 October 2026

Reviewed the project's **60 Git candidate files**, including source, documentation, spreadsheet fixture contents, screenshot/design images and image metadata. Pattern checks found no private keys, recognised provider tokens, embedded URL credentials, personal email addresses or workstation paths in this public file set. The six demo identities/passwords and the requested developer credit remain intentionally public. This is a scoped inspection, not a guarantee that every possible secret format is detectable.

Expanded `.gitignore` to exclude runtime databases/evidence/backups/sessions, local secret files, editor settings, logs, temporary assets, generated decks and machine-specific reports. All **16 private-file exclusion probes passed**; required source/model/template files remain included. No files in this project were tracked or present in reachable project history at inspection time. The enclosing Git repository covers a parent workspace; use a repository limited to this app before publishing. Other projects in that parent repository were not audited. The detailed local report is `qa-artifacts/public-source-audit.json` and is itself excluded from Git.
