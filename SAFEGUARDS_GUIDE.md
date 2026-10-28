# Samanvay coordination safeguards

The five safeguards are local, working workflows with saved records and server-enforced permissions. Open **Coordination lab** in the sidebar for cycle monitoring, usage counts and policy comparisons. Open any complaint and choose **Safeguards** for its action guard, dependencies, evidence passports and closure review. Existing demo credentials are unchanged.

## 1. Action Collision Guard

1. A managing officer proposes a Notice, Refund verification, Inspection, Regulatory decision or Escalation.
2. Enter a **shared issue reference** identifying the particular matter, the action summary and its deadline. Use the same reference across desks for the same matter; a category such as “refund” alone is too broad.
3. Run the check. The server checks active canonical actions at the same institution. A matching issue reference and action type raises a coordination warning, including conflicting deadlines.
4. Choose **reuse**, **request joint action**, or ask an authorized senior to record a reasoned **separate action** exception. Without a collision, record a new planned action.
5. A joint request needs approval from an officer who can manage both the requesting case and source case, such as their common lead, Regional Officer or Admin. Approval controls are in the requesting case.
6. The source action progresses Planned → Issued → Completed, or is cancelled with a note. Reused and approved joint records reference that source; they cannot be issued independently.

Checks are recalculated when saving. A changed case or action invalidates an earlier check. Every saved decision has a receipt recording what was checked, collision references, officer, reason and time. Records are case coordination records; the application does not send an external statutory notice. Matching is rule-based and depends on a consistent, officer-verified issue reference. It does not infer that all complaints at one institution concern the same matter.

## 2. Deadlock Radar

Record that a case is waiting for another case of the same institution, either for its disposal or for a specific open task. Supply the reason and expected response date. The lab computes strongly connected components of the current waiting graph: A waiting on B and B waiting on A is a cycle; A waiting on B alone is a prerequisite, not a deadlock.

A completed prerequisite task or disposed target satisfies its wait automatically. If the condition is no longer valid, the responsible Regional Officer or Admin can release that prerequisite with a recorded alternative course of action. This does not complete the other desk's work or grant additional authority. Cycle notifications are deduplicated for each recorded cycle and recipient. Restricted records are excluded from cycle details shown to an unauthorized viewer.

## 3. Evidence Passport

1. Upload a source file in the complaint's **Evidence** tab.
2. Its managing officer creates a passport with a title and source/provenance description.
3. The source desk approves sharing to a specific related case. That case's managing officer attaches the passport reference and reviews its latest version.
4. A source manager can upload another attachment and register it as the next immutable passport version. Older versions remain downloadable. Creating and versioning passports uses the source case's Safeguards tab.
5. A new version marks referenced evidence as requiring review and notifies affected desks. The receiving desk records its review of that exact version before using it for closure.

New uploads record uploader and SHA-256 digest. Historical uploader/digest gaps are explicitly labelled. Downloads and closure proof verify available saved digests against file contents; a changed or missing selected file blocks proof review. Hashes check file consistency, not the truth or official authenticity of a document. Source sharing is checked on the server. Complainant accounts cannot retrieve internal passports or another complaint's evidence through these routes.

Closed cases must be reopened before changing their safeguards. A source file can be reused under a previously approved passport grant. The normal limit of 10 uploaded attachments per case still applies across versions.

## 4. Resolution Proof Check

Before an officer can change a complaint to **Resolved**, the server requires:

- The category-specific remedy, institution response and communication checks.
- Current supporting evidence: a case attachment or a reviewed passport version.
- A written explanation of the verified remedy and communication, visible to the complainant.
- No open coordination tasks, unsatisfied dependencies, pending transfers, outstanding objections, incomplete official actions, incomplete reused source actions or stale evidence references.

The check is tied to the case revision and referenced evidence/action state. Later changes require another review. Save officer, routing and deadline changes before the final proof check. A source passport update also invalidates a receiving case's proof even if that receiving case was not edited.

Complainants can raise a resolution objection from their own case's Safeguards tab while it is open. The managing desk records a response before closure. Following disposal, the existing resolution feedback workflow allows reopening. Previously disposed cases are preserved as historical records; no new proof is fabricated for them.

The check is a documented officer attestation. For a refund, for example, uploading a receipt alone does not independently establish that money reached the intended recipient. External bank/payment verification is not connected.

## 5. Policy Sandbox

Admin can compare all cases; Regional Officers compare only cases in their assigned region. Bureau and complainant accounts cannot run policy comparisons.

Set proposed priority SLAs and optional bureau routing, then run a comparison. The application replays the saved receipt dates, current priorities and historical disposal dates using India calendar dates. It compares overdue open cases, measured late outcomes and open workload by bureau. Resolved cases without a disposal date are reported separately and excluded from lateness comparisons.

Results contain aggregates, assumptions, the proposed policy, author and time. The latest ten available comparisons by that user are shown; the database retains the latest 100 runs globally. No live policy, deadline, case assignment or complaint status changes. Changing actual SLA policy remains a separate Admin operation. This is a deterministic scenario comparison, not a prediction of faster disposal, staffing needs or causal impact. It uses the authorized local snapshot; it does not claim a live AICTE data connection.

## Reviewer walkthrough

Use two or three existing synthetic complaints at the same institution, or register clearly fictional cases for a separate exercise. The application does not silently create new allegations or change existing complaints to populate these features.

1. Sign in as PGRC or Regulation and propose a notice with a specific shared issue reference. With Admin, use another case at that institution to propose the same action and demonstrate reuse or joint approval. Complete the source action to clear its closure blocker.
2. Record A → B and B → A prerequisites. Open Coordination lab to see the cycle. Switch to the responsible Regional Officer or Admin and record a release decision.
3. Upload two fictional evidence files to one source case. Create a passport from the first, approve sharing, attach and review it in the second case. Add the second version at the source and show that the receiving case now needs a new review.
4. Try disposing a case before proof review: the API rejects it. Clear blockers, review the latest evidence, complete the checklist and save the explanation, then dispose from Overview.
5. Run a policy comparison as Admin or Regional Officer and show that the case register and live SLA settings remain unchanged.

## Verification and limits

Automated checks cover real local API workflows, authority boundaries, stale checks, concurrency, cycles, immutable evidence versions, hash mismatches, objections, closure, policy isolation and restart persistence. Offline DOM checks cover all six account workspaces, form payloads, error preservation and escaping. Those DOM checks do not measure browser layout. A fresh visual browser/mobile walkthrough remains unverified because the browser's local-URL security restriction prevented that review.

The local demo retains public credentials and synthetic case data. These features do not establish production certification, global novelty, official AICTE integration or an error-free guarantee.
