# SIH problem statement coverage

Implemented for the local Samanvay demonstration, 21 October 2026. All counts and histories respect the signed-in official's authorized case scope. This document distinguishes implemented behaviour from production integrations.

| Problem statement requirement | Implementation and where to review |
| --- | --- |
| Central institution profile with Permanent ID, name, address, region and history | Institutions navigation → open a profile. SQLite master registry keyed by Permanent ID; address, city/district, state, PIN, contact and aliases editable by Admin or responsible Regional Officer. Cases and chronological actions consolidated below. Legacy addresses remain explicitly unrecorded until supplied. |
| Unique case ID, receipt date, category, status, current bureau and officer | All complaints and case workspace. Receipt is the registration timestamp, displayed in India time. |
| Last action, next action and expected disposal | Case summary shows last action, officer/date, next required step, next-action deadline and disposal deadline. Officers can record next action; otherwise an open task or workflow-specific step is derived. |
| Cross-bureau overlap irrespective of description | Every pair of active complaints at the same Permanent ID in different bureaus produces “Potential Overlapping Cases – Coordination Required”. A different topic does not suppress this alert. |
| Matching alternative descriptions / references | Bundled TF-IDF/LSA semantic suggestions supplement institution rules; normalized names/abbreviations and registered aliases support identity consistency. Conflicting Permanent IDs are never silently merged. Conservative name-and-region fallback exists for imported records without IDs. |
| Link/map related complaints and coordinate | Related cases → reviewed link/dismiss/reopen decisions; institution profile → manual mapping including historical cases; coordination group, senior-appointed lead, shared notes and assigned tasks. Human verification is required; an alert alone is not a finding of duplication. |
| Dashboard counts | Total received, pending, under process, disposed, completed transfers, escalated, beyond timeline. Bureau workload and institution-wise status appear on staff overviews. |
| Complete action chronology and evidence | Case Timeline records actor, timestamp, bureau and role for new events. Transfers have request/approval/rejection history; evidence upload/download and remarks are supported. Old events without bureau metadata are labelled as such, rather than inferred. |
| Search and all required filters | All complaints: institution name, Permanent ID, case ID, keyword; bureau, region, category, status and receipt date range. Extra priority and completed-transfer filters; CSV uses the current selection. |
| Real-time updates | Authenticated server-sent events push invalidations after saved changes. Clients reload authorized data; stream contains no case payload. Open forms/dialogs defer automatic rendering with a visible update notice. Reconnect and periodic fallback are included. |
| Duplicate/overlap, pending, timeline and escalation alerts | Deduplicated coordination notifications and dashboard banner; configurable near-deadline reminders, overdue escalation, notification inbox/read state. Scheduler runs every minute while the app server runs. |
| Institution, region, bureau and status reports | Reports page has grouped case counts and performance; receipt-cohort, region, bureau, status and institution filters; analytics CSV and selected-case CSV. Institution profile additionally exports chronological history. |
| Pending ageing, disposal rate, overlap statistics | Reports page: open-case age bands 0–7 / 8–15 / 16–30 / 31–60 / 61–90 / 90+ days; disposal percentage; cross-bureau and similar-topic pairs, linked and dismissed decisions. |
| Monthly / quarterly performance | Reports page groups receipt and disposal events by India calendar month/quarter. Date filters select a receipt cohort; disposal columns describe those selected cases' disposal dates. |
| Target officials, authorized officers and competent authority | Separate Admin, Regional Officer, PGRC and Regulation Bureau accounts; highest authority at Admin, with server-enforced edit/supervision scopes. Additional student/faculty demo portals do not expose internal coordination. |

## Definitions

- Pending means New or Awaiting response; Under process means In progress; Disposed means Resolved. Escalated has its own current-status count.
- Transferred is historical (at least one approved transfer), so it can overlap any current status. Pending transfer approval is distinct from a completed transfer.
- Beyond timeline means an unresolved case whose disposal date is before today's India calendar date.
- Disposal rate is currently disposed cases divided by total cases in the selected cohort. It is not a claims-based measure of service quality.
- Name aliases are explicitly reviewed master data. Similarity is not identity verification, a duplicate probability, or a trained model accuracy guarantee.

## Verification and limits

Automated checks cover the workflow, roles, institution identity/profile updates, alias validation, conflicts, scope, notifications, chronological actions, report totals, date/time boundaries, monthly/quarterly grouping, live stream authentication/delivery, persistence and backup integrity. See QA.md.

The latest browser visual pass was blocked by browser security policy. New screens and responsive rules have source checks and calculation/API coverage, but their rendered appearance has not been re-verified in this session. Earlier screenshots are historical previews.

The app uses synthetic records and public demo credentials, runs on localhost and has no official AICTE directory/data integration or external email/SMS service. Official addresses/contacts must be supplied. Existing demo bureaus are PGRC, Regulation Bureau and Regional Office; additional organizational units/accounts require configuration before an organization-wide rollout. Production rollout, identity provisioning and security review are outside this local demonstration.

## Institution import upgrade — 26 October 2026

Admin can now upload CSV/.xlsx institution directories, map columns, review validation/duplicate results, download an issue report and save only valid new profiles with a pre-save backup. Imports preserve AISHE codes separately, include source/year provenance, and are idempotent and transactional. See IMPORT_GUIDE.md. 69 automated checks pass; a fresh browser visual check remains pending.


## Additional coordination workflows

Action Collision Guard, Deadlock Radar, Evidence Passport, Resolution Proof Check and Policy Sandbox are implemented as persisted, permission-checked workflows. They supplement the original institution overlap alerts and analytics. The guard uses an explicit verified issue reference, the radar uses recorded prerequisites, proof is a human officer attestation, and sandbox results are deterministic comparisons rather than forecasts. See `SAFEGUARDS_GUIDE.md`.
