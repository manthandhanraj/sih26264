# Institution import

Sign in as **Sakshi Sharma / Admin**, open **Institutions**, then choose **Import CSV / Excel**.

1. Download the CSV or Excel template and replace its fictional example with institution details.
2. Upload UTF-8 `.csv` or standard `.xlsx`. For `.xls`, save the file as `.xlsx` first. Paste formula cells as values before uploading.
3. Choose the workbook sheet. Match each file column to a directory field. Automatic matches are suggestions; review them.
4. Supply a region column or choose the default region used for empty region cells. Apply mapping again after changes.
5. Review the counts and rows. Filter by result or search by name/ID. Expand a row to see every mapped field. Download the issue report to help correct rejected records.
6. Check the review confirmation, then save the valid rows. A recovery backup is created before the atomic database update.
7. The saved receipt shows added/skipped counts. New institutions appear in the directory even when they have no complaints.

## Columns

| Field | Required | Notes |
| --- | --- | --- |
| AICTE Permanent ID | Yes | 2–60 characters; letters, numbers and hyphens. Preserved as text, normalized to uppercase. Formatting validation does not independently verify an AICTE identity. |
| Institution name | Yes | 3–200 characters. |
| Region | Yes, or default | North, South, East, West, Central, North East or Not specified. |
| Address | No | Up to 500 characters. |
| City / district | No | Up to 100 characters. |
| State / UT | No | Up to 100 characters. |
| PIN code | No | Six digits, not starting with zero. |
| Institution contact | No | Up to 200 characters. |
| Alternative names | No | Up to 12 aliases, separated by semicolons; each 3–200 characters. |
| AISHE code | No | Stored separately; never substituted for the AICTE Permanent ID. |
| Data source | No | Source title or URL supplied in the file; up to 500 characters. |
| Academic year | No | For example 2026 or 2026-27. |

The first row must be column headers. A column can map to only one field. Unknown headers can be mapped manually. Completely empty data rows are ignored. ID and PIN columns should be text in Excel to preserve their original representation.

## Row results and saving

- **Ready to add:** a valid new institution ID.
- **Needs correction:** missing required data, invalid region/PIN/year or another validation issue.
- **Duplicate in file:** every copy of a repeated ID is skipped; correct all copies to remove ambiguity.
- **Already exists:** the ID is in the directory; the existing profile is kept unchanged.
- **ID / name conflict:** the ID exists under a different name; review the source rather than replacing it through import.

Missing address/source values are warnings. A matching name under a different ID is flagged for review; distinct IDs are not silently merged. No institution data is saved during preview. Save adds only ready rows, with one database transaction and a persisted receipt. Retrying a completed save does not add duplicates, including after a server restart. If directory changes affect the preview, refresh it before saving.

Admin performs bulk imports. Regional Officers can subsequently view imported institutions in their region. Bureau and complainant case-access rules remain enforced. Importing directory records does not create complaints or add them to case-performance totals.

## Limits, provenance and recovery

Files: up to **2 MB**, **50 columns**, **2,000 rows per sheet**, **12 sheets** and **4,000 workbook rows**. Preview expires after **15 minutes**; a server restart clears unsaved previews. The parser runs in a timed worker, and compressed workbooks are checked against a 12 MB expanded-size limit. Encrypted/unsupported archives and formula workbooks must be converted to plain values first.

Each added profile records file name, sheet, file hash, importing account/time and supplied source/year. These show provenance; they are not a claim that the source or institution identity has been independently verified.

Receipts are stored in SQLite and included in full backups. Before each save, a recovery snapshot is stored under `data/backups/`. The receipt download link provides the database snapshot; its local folder also contains evidence files. The app's existing recovery guidance applies; there is no destructive one-click restore action.

## Development

Run `npm ci` once after checkout, then `python runner.py`. Packages are local runtime dependencies; no cloud service or API key is needed for import. `npm test` includes actual CSV/XLSX parsing, validation, permissions, backup snapshots, conflict checks, idempotent retries, atomic rollback and restart persistence tests.

The latest rendered browser/mobile pass is pending because browser automation is unavailable in this session. Syntax, parser, API and persistence checks do not establish visual correctness.
