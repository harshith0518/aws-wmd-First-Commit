# 6 Workflows and consistency rules

## 6A Issue state machine

- SUBMITTED -> ACKNOWLEDGED: primary owner records acknowledgement and next action. The server sets acknowledgedAt only once and preserves the original acknowledgement deadline.
- ACKNOWLEDGED or REOPENED -> IN_PROGRESS: primary owner records nextAction and nextUpdateAt. A collaborator can add progress but cannot replace the accountable owner.
- ACKNOWLEDGED, IN_PROGRESS or REOPENED -> WAITING: require a dependency reason and next review time. Record previous active state. Resume goes to IN_PROGRESS; waiting time remains part of total age.
- IN_PROGRESS, WAITING or REOPENED -> PROPOSED_RESOLVED: require resolution action, outcome and evidence IDs or a reason why evidence is unsuitable. Save a new resolution attempt and notify the reporter.
- PROPOSED_RESOLVED -> CONFIRMED_CLOSED: reporter explicitly confirms the current resolution version. A staff member cannot impersonate this action. Reporter inactivity leaves PROPOSED_RESOLVED visible indefinitely; reminders can stop after two attempts without changing confirmation status.
- PROPOSED_RESOLVED or CONFIRMED_CLOSED -> REOPENED: reporter provides a reason. Invalidate the active knowledge entry in the same command or make source validation reject it immediately; preserve all former resolutions.
- Active states -> DECLINED: authorized primary owner or unit lead supplies reason and review route. The reporter can Request review; the review outcome can restore REOPENED.
- Active states -> DUPLICATE: authorized lead links a canonical accessible issue, records a reason, prevents self-links and cycles, and preserves the original history. If the target is private, show only a generic related-case reference to users without access.
- Progress is an event, not a status. Severity changes, target changes, collaborator updates and assignments have dedicated authorized commands and attributed reasons.
- All state changes check expectedVersion and previous state. Reject invalid transitions with 422 INVALID_TRANSITION. Commands never accept arbitrary replacement of status or owner via a general PATCH.

## 6B Ownership and service clocks

- Publishing assigns the destination unit's active duty lead immediately. Restricted publication instead requires a designated lead with the sensitive-handler role and includes that lead in caseHandlerIds. If no eligible owner exists, use an equally eligible triage lead; if neither exists, keep a draft and show a configuration error instead of publishing an ownerless issue or exposing it to ordinary staff.
- Transfer stores transferId, proposedOwnerId, proposedUnitId, reason, requestedAt and expiresAt. The proposed owner has 48 hours to accept; the old owner remains accountable. Acceptance atomically switches grants, queue keys and owner. Rejection or expiry removes temporary access and notifies the lead.
- Service defaults are one working day to acknowledge and three working days to update. Define a working day as the configured number of open minutes, not 24 wall-clock hours. Start defaults Monday-Friday 09:00-17:00 in Asia/Kolkata with configured holidays; label these as demo defaults until campus approval.
- Save the calendar version and calculated UTC due times with the issue. Existing due times do not silently change when the administrator edits the calendar. A manual extension needs a reason and retains originalDueAt.
- A five-minute job checks due state, notifies the backup once, then escalates to the named lead after one more working day. Each escalation has a unique event key. Reassignment and duplicate grouping never reset age.
- Safety urgency is human reviewed. Selecting emergency displays the verified emergency contact immediately and explains that submitting a report is not emergency dispatch.

## 6C Service reviews and moderation

- Request review accepts original issue/reply reference, one reason code, explanation and optional evidence. One active service review per requester and issue avoids spam; a new concern can be appended with history.
- Reviewer assignment excludes the original responder, primary owner, requester and named subject. Use the unit's independent escalation reviewer, then the campus independent reviewer. If no eligible person is configured, mark ESCALATED and notify the operator instead of silently assigning a conflicted reviewer.
- Review acknowledgement target is two working days and decision target five, both pilot defaults. Reviewer can request context from each side. An adequate response closes the review with decisionOutcome=RESPONSE_UPHELD. A valid concern sets ACTION_REQUIRED and COMPLAINT_UPHELD with a corrective action, owner and due date; the reviewer closes it after checking the remedy. Insufficient evidence closes with INSUFFICIENT_EVIDENCE, a reason and the appeal route. Explain outcome labels in the UI.
- An appeal within 14 days goes to a different reviewer. The appeal can uphold the decision or order another action; it never overwrites the original decision. Real-campus deadlines must be aligned to the college's grievance process.
- Abuse reports are separate: spam, threats, exposed personal information, prohibited items or targeted harassment. Criticism, low support counts and disagreement with management are not automatic removal reasons.
- Content restriction leaves a reasoned placeholder in the original audience when safe. Case evidence has narrower access. The affected author gets the decision and appeal route. Do not put retaliation allegations in campus-wide notification previews.

## 6D Questions activities and listings

- Question author selects one accepted answer. Replacement unaccepts the prior answer with history. Only verified scoped staff can mark an answer official; include policy source and review date. Conversion to issue requires author confirmation and creates a new linked issue with a fresh audience preview.
- Activities reject end <= start, joinDeadline > start, capacity below acceptedCount, capacity below two, negative cost and participants outside the permitted audience. Creation makes the organizer an ACCEPTED participant and lead, occupying one seat. A requester can be waitlisted, accepted, rejected or leave. Only a conditional transaction changes seat count; leaving a full event changes FULL to OPEN when the join deadline has not passed. The lead must transfer leadership to an accepted participant before leaving, or cancel the event.
- Cancellation notifies all accepted participants and freezes new admissions. Completed events close admissions and archive team content read-only for current accepted members until retention expiry. Removing a participant also revokes team files and coordinator grants.
- Event coordinator grants belong to one activity. Task assignees must be accepted participants. Completed tasks keep actor/time; a departed assignee is marked unassigned and the lead is notified. Event posts do not create college-approved status without a recorded staff approval.
- Marketplace owners alone change listing details and sale state; buyers cannot mark Sold. Reservations do not collect money or claim an escrow guarantee. Renewing an expired listing requires confirmation that it remains available and creates a new expiry.
- Inquiry creation is unique per buyer and listing while open. Blocks prevent new messages and requests between those users but retain evidence and service-review access. Lost-item identifying details are exchanged privately before a handover.

## 6E Idempotency and asynchronous work

- Require Idempotency-Key on resource-creating POSTs and workflow commands; retain keys for 24 hours. Bind to campus, actor, route and normalized body hash. Same key plus same request returns the prior result after authorization; different body returns 409 IDEMPOTENCY_CONFLICT.
- The initial transaction reserves the idempotency record and writes the business change plus outbox job atomically. There must be no interval in which a successful complaint is stored without its history and required notification job.
- Jobs use at-least-once delivery. Conditional lease acquisition prevents competing workers from owning a job simultaneously; expiry permits recovery. Completion records deduplicate effects by event and consumer.
- Retry transient failures with exponential backoff and jitter, maximum five attempts; route exhausted jobs to a DLQ and surface an operator alert. Business validation failures are terminal and recorded with a safe reason.
- SQS sends, email sends and external side effects cannot be included in the database transaction. Design duplicate-tolerant notification IDs and record delivery attempts; do not claim absolute exactly-once email delivery.
- A failed notification never rolls back a committed issue. The UI confirms the issue ID and exposes delivery trouble to administrators. A failed upload leaves the report usable without that attachment.
- Reply and service-review evidence sequence: persist the text record first, reserve files under its actual ID, upload, then complete. Completion atomically links the attachment ID to the current parent under a version/permission check. DTOs return attachmentIds; the UI shows evidence still uploading beside the already-saved text. This avoids inventing a parent ID or attaching another record's evidence. A review context request is created as a reviewer-only draft, checked for safe disclosure and explicitly sent after its evidence is ready.

## 6F Honest dashboard definitions

- Open includes SUBMITTED, ACKNOWLEDGED, IN_PROGRESS, WAITING, REOPENED and PROPOSED_RESOLVED awaiting confirmation. Confirmed closure counts only explicit CONFIRMED_CLOSED events.
- Acknowledgement latency measures first acknowledgement minus creation; resolution proposal and confirmed closure have separate durations. Show denominator, date range and timezone beside every statistic.
- Reopen rate is issues reopened after a proposal or confirmation divided by issues that reached a proposal in the selected cohort. Use a fixed submission cohort and state the observation cutoff to avoid mixing denominators.
- Track duplicate and declined reports separately and retain their submission counts. Waiting is visible in elapsed time. A low denominator shows Insufficient data, not a misleading zero.
- Student metrics cover only data the student may see. Sensitive aggregates require minimum cell size 10 and fixed non-overlapping reporting buckets; suppress small complementary cells and avoid arbitrary filters that allow subtraction attacks. Disable sensitive student metrics until this is tested.
