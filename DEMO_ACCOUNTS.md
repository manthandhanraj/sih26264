# Demo accounts for every position

Developed by **Manthan Dhanraj**.

Open http://127.0.0.1:3000 and choose an **Explore** button. Each account has a separate authenticated session and server-enforced permissions. Use **Demo accounts** in the header to switch perspectives, or **Sign out** to return to login.

| Account | Email | Password | Access |
|---|---|---|---|
| Admin — Sakshi Sharma | admin@samanvay.demo | Admin@2026 | All cases, settings, SLA checks and backups |
| PGRC — Rahul Mehta | pgrc@samanvay.demo | Pgrc@2026 | PGRC cases and connected case previews |
| Regulation — Priya Rao | regulation@samanvay.demo | Regulation@2026 | Regulation Bureau cases and connected case previews |
| Regional — Nidhi Singh | regional@samanvay.demo | Regional@2026 | North-region cases and delegated coordination work |
| Student — Aarav Kumar | student@samanvay.demo | Student@2026 | Own complaints, evidence, conversations, feedback and reopening |
| Faculty — Kavya Desai | faculty@samanvay.demo | Faculty@2026 | A separate set of own complaints with the same portal features |

## Suggested review

1. Enter as Student, register a complaint and note its case ID.
2. Switch to PGRC, open the case and send a clarification request from Overview.
3. Switch to Student, open Inbox or track the case ID, and reply. The status moves from Awaiting response to In progress.
4. Switch to an officer, add an internal note and assign an action item from Coordination. Internal content is not returned to complainant accounts.
5. Review a semantic suggestion under Related cases. Confirm a connection, assign a group lead and coordinate shared notes/tasks.
6. Resolve the case with an action note. The complainant can rate the outcome or request reopening.
7. Enter as Admin to inspect SLA policy, run a check and create/download a database backup.

These accounts and public passwords are intentionally provided for a localhost synthetic demo. They are not official AICTE credentials. Do not expose this demo publicly or use real complaint data.

## Authority boundaries

Admin is level 4 and has the highest authority; Regional Officers are level 3 within their region; Bureau Officers are level 2 within their bureau; Complainants are level 1 within their own records. Bureau transfers are requests until a responsible Regional Officer or Admin approves them. Bureau Officers cannot change priority/deadlines or appoint group leads. Admin-only access controls are verified on the server.
