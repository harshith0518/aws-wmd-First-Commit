# 2 Page and interaction design

All routes below are proposed frontend routes. `C` means `/c/:campusId`; IDs are opaque. Endpoint descriptions are capability requirements; the API contract defines their final names. **H/R1** = hackathon, **P/R2** = campus pilot, **E** = community expansion. Hide unavailable modules through server-provided feature flags; do not ship dead navigation links. The full product includes every page below, delivered in those stages.

## 2A Shared page contract

- **Shell:** desktop left navigation and compact top bar; mobile top bar plus Home, Issues, My Activity and More bottom navigation. More opens Questions, Activities, Marketplace, Library, Metrics, staff and admin sections according to capability. Top bar contains campus switcher, create button, permitted-content search and notifications. Every page has one primary heading and a clear primary action.
- **Visuals:** neutral background, readable text, one restrained accent, consistent spacing, standard icons and reusable cards/forms/drawers. Status uses both text and colour. Show campus timezone and absolute date on hover/focus for relative times. Avoid decorative dashboards and fabricated images.
- **Access:** load active campus membership and capabilities before campus data. Route guards improve navigation; the server authorizes every request. An inaccessible/deleted record returns a neutral “This item is unavailable” page without title, author, audience or existence clues. Expired membership opens the membership screen. A campus administrator receives no automatic access to restricted case content.
- **Lists:** labelled filters, clear-all, supported stable sorting, cursor-based Load more, result state preserved in URL. An empty filtered candidate page with a continuation cursor still offers Load more; do not call it exhaustive. Never show a total the server has not authorized/calculated. Search uses selected feeds and recent reviewed history; label this scope instead of promising exhaustive full-text search.
- **Forms:** labels and instructions above inputs; schema-derived limits (title 120 characters, body 5,000, reply 2,000, note/reason 1,000; member up to 20 groups, post up to 4 audience groups and issue up to 8 collaborators); inline errors plus summary; preserve entered data on recoverable failures. Disable only the submitted action while pending. Use idempotency keys for retries. Do not optimistically report a completed assignment, status transition, join or upload.
- **States:** each page has skeleton loading, useful empty state, inline retry on failure, session-expired recovery and unavailable state. Permission failures do not reveal cached content. Version conflicts explain that the item changed, refresh it and preserve the user's unsent text for review.
- **Accessibility:** keyboard operation, visible focus, semantic headings, skip link, labelled dialogs with focus return, live announcements for saving/errors, minimum 44px touch targets, contrast meeting WCAG AA, 200% zoom and small-screen reflow. Never rely on hover, colour or drag alone.
- **Attachments:** shared picker shows three-file/5 MB limits, accepted JPEG/PNG/PDF, progress and cancel/retry. Submitted files remain “Checking” until cleared; failed files explain removal/replacement. Authorized download is requested on click, not embedded as a permanent URL. Sensitive evidence displays an audience warning.
- **Replies:** one nesting level, attachment support and accessible mentions restricted to current readers. Identify author role at posting, created/edited time, accepted-answer marker where applicable. Verified-role and official-campus badges require recorded approval, scope and validity. Respectful criticism and complaints remain permitted; constructive dialogue does not mean compulsory praise. Edit creates a revision; moderation leaves an appropriate redacted placeholder. Private staff notes use a separate labelled composer and permission check.
- **Empty/absence distinctions:** “No results match these filters,” “Nothing has been posted yet” and “You cannot access this page” have different handling. Hiding a button never substitutes for backend authorization. No infinite polling; refresh on focus and deliberate user actions, with modest configurable notification polling.

## 2B Entry identity and membership

### A01 Entry and authentication

Routes and stage: `/`, `/auth/callback`, `/auth/error` · H

- **Access/components:** public entry with brief purpose, Sign in, Join a campus and published demo information; login delegates to Cognito. Callback validates authentication state, restores a safe same-origin return path and loads account/campus access.
- **Actions/validation:** sign in, sign out, email verification/resend, password recovery and privileged-account MFA use the identity provider. Never collect/store passwords in application forms. Reject arbitrary return URLs; show expired-link and cancelled-login recovery.
- **Service/state:** start/finish identity flow and read current account. New accounts go to A02; suspended accounts get a restricted support path. Do not flash campus data during callback loading.

### A02 Campus selection and admission

Routes and stage: `/campuses`, `/join`, `/invitations/:token` · H membership; P complete joining

- **Components:** approved-campus cards, search by published campus name/code, current membership state, join-by-approved-domain or email-specific invitation, department/batch/hostel/club requests and invitation acceptance preview.
- **Actions/validation:** enter campus, request membership, accept/decline invitation, remove pending request. Verified email must match the invitation/domain policy; selecting a group requests membership rather than granting it. Expired/revoked/used tokens show a recovery action without disclosing invitee information.
- **Service/state:** list personal memberships/public campus summaries; inspect/accept invitation; request campus/groups. Pending/rejected/expired membership states show reason when permitted and review contact; prevent duplicate requests. One demo campus may have pre-approved seeded accounts in H.

### A03 College registration request

Routes and stage: `/campuses/request`, `/campuses/requests/:id` · P

- **Access/components:** authenticated proposed representative; college name, official site/domain, role, college-controlled verification contact, authority evidence and consent. Progress shows submitted/requested information/approved/declined and reviewer messages.
- **Actions/validation:** submit, amend requested information, withdraw. Require a contact and evidence; domain ownership/email verification alone cannot grant administrator privileges. Approval is a platform-operator workflow, not self-service.
- **Service/state:** create/read/update onboarding request and restricted evidence. Pending review explains expected next step; duplicate campus request routes to existing membership support.

### A04 Membership and account

Routes and stage: `C/membership`, `/account` · H; P full lifecycle

- **Components:** profile name, verified email, campus/groups/roles with expiry, pending approvals, notification digest preferences, muted threads, sessions/security links and privacy/export/deletion request actions.
- **Actions/validation:** edit safe profile fields, request group transfer, leave eligible group, change preferences, sign out. Users cannot edit verified identity or privileges. Display consequences before leaving; sole campus administrator needs a successor.
- **Service/state:** read/update profile/preferences; membership requests; privacy requests. Separate pending approval from saved changes; show revoked access immediately.

## 2C Core student and staff work

### W01 Home

Routes and stage: `C/home` · H; community cards later

- **Access/components:** active member; pinned official notices, My issues awaiting action, latest permitted issues, group shortcuts, create/report action and relevant emergency contact. Staff see assignments/overdue shortcut. Community cards appear only when enabled.
- **Actions/validation:** navigate, filter by an approved group, dismiss optional onboarding guidance. Distinguish official notice from ordinary student post; no sensitive case snippets in general cards.
- **Service/state:** personalized authorized summary, notices and feed previews. New campus shows first-report/help actions; do not invent activity counts.

### W02 Issue list

Routes and stage: `C/issues` · H

- **Components:** scoped search, topic/group/unit/status filters, My reports/Affected/Following toggles, newest/oldest creation-time sorting. Rows show title, status, audience label, accountable unit/owner, age/next update and authorized support count.
- **Actions/validation:** open report, create issue, follow/unfollow and indicate affected once per member. Filters only offer permitted groups; pagination resets when filters change.
- **Service/state:** query permitted issues and support/subscription mutation. Empty filtered results offer reset; original unavailable issues never leak through duplicates or search suggestions.

### W03 Issue creation and editing

Routes and stage: `C/issues/new`, `C/issues/:id/edit` · H

- **Components:** title, description, topic, affected location/unit, proposed responsible unit, audience selector/preview, optional evidence and related issue suggestions. Default audience is conservative; sensitive topics default restricted. Show emergency instructions before submission when relevant.
- **Actions/validation:** save draft, submit, cancel, choose an existing issue and support it. Required fields and limits come from shared schema. Location and responsible team remain independent. Submission requires permitted audience/groups, valid attachment references and explicit audience confirmation. AI routing is an optional suggestion requiring confirmation.
- **Service/state:** permitted routing/configuration, duplicate search, draft CRUD, issue creation/revision and upload flow. Autosave displays saving/saved/failed; do not persist sensitive drafts in browser storage. Edit permissions and allowed fields depend on current status; changes retain history.

### W04 Issue detail and history

Routes and stage: `C/issues/:id`, `C/issues/:id/history` · H

- **Components:** summary/audience, reporter identity as permitted, owner/collaborators, status and elapsed clock, next action/update due, evidence, affected/follow controls, discussion, resolution proposal, related issues and chronological history. History includes actor/time/reason and protected revisions only when authorized.
- **Actions/validation:** reporter confirms or reopens with reason; primary owner acknowledges/starts/waits/resumes/proposes resolution. Assigned handlers add progress/private notes; expose priority, transfer, collaborator, duplicate and decline controls only to the corresponding owner/lead capability. Transfer recipient accepts/rejects; previous owner remains accountable meanwhile. Every mutation checks allowed transition/version. Waiting/decline/reopen/reassignment require reasons; resolution needs fix summary plus evidence or explanation.
- **Additional controls:** widening audience creates a linked redacted summary through a dedicated dialog with before/after readers, reason and evidence review; the original case and restricted material retain their ACL. AI precedent drawer shows cited permitted source, date and limitations; it cannot publish or transition status. Confirmed closure never follows silence automatically. Duplicate view preserves original history and links the canonical issue only when accessible. Issue/reply menus separately offer “Request service review” and “Report abuse”; service dissatisfaction is not automatically abuse.
- **Service/state:** issue detail/replies/events, transitions, assignment transfer, audience review, AI suggestion, reports/appeals. Present action-specific failures; status conflict refreshes controls without discarding draft reply. Proposed-resolved state clearly says “Awaiting reporter confirmation.”

### W05 Staff queue

Routes and stage: `C/staff/queue` · H

- **Access/components:** scoped handlers; Mine, Unit needs triage, Transfers awaiting acceptance, Overdue, Awaiting confirmation and Escalated tabs. Filters include unit/topic/status/due date; each item shows accountable owner and next required action.
- **Actions/validation:** open item, accept assignment/transfer, assign permitted colleague, acknowledge and post update through validated dialogs. No bulk closure or audience changes. Scope the staff picker to eligible active handlers.
- **Service/state:** indexed scoped queue and workflow mutations. No assigned units explains how to request access; overdue indicators use server-calculated campus-calendar deadlines.

### W06 My Activity and notifications

Routes and stage: `C/my-activity`, `C/notifications` · H

- **Components:** My Activity tabs for reports, service reviews, drafts, replies, following and later questions/joins/listings/inquiries. Notifications show assignments, mentions, replies, moderation and status changes with read/unread controls and preferences link.
- **Actions/validation:** resume draft, open permitted target, mute thread, mark individual/all read and configure digests. Mark-all affects only current user's records. Removed access produces a neutral unavailable notification target.
- **Service/state:** personal activity, notification pagination/read state and subscriptions. No alerts has a calm empty state; saved read state should survive refresh.

### W07 Resolution Library

Routes and stage: `C/library`, `C/library/:id` · H basic; P curation

- **Components:** topic/unit/location/keyword filters; reviewed resolution cards with symptom/fix/outcome, confirmation, reviewer/date, source link, evidence permission and currency status.
- **Actions/validation:** search, open source, flag stale information; authorized curator drafts/reviews/publishes/retires entries. AI retrieval uses only eligible current records; a reopened/restricted source withdraws affected entries/suggestions.
- **Service/state:** authorized indexed knowledge search/detail and curation. No match explains that history is unavailable; no AI answer is fabricated. Source access removal never leaves cached evidence visible.

### W08 Accountability metrics

Routes and stage: `C/metrics` · H basic; P complete

- **Components:** period/unit filters, open/overdue counts, acknowledgement and resolution durations, proposed versus confirmed closures, reopen rate, denominators and methodology. Include waiting, declined and duplicate handling notes.
- **Actions/validation:** change period, follow permitted supporting list and request authorized export. Sensitive aggregates need at least ten cases; suppress the value and any revealing drilldown below threshold.
- **Service/state:** precomputed/scoped metrics and export job. Show calculation time and no-data state; loading never displays false zeroes. Exports inherit the caller's access scope.

## 2D Questions and community

### C01 Questions

Routes and stage: `C/questions`, `C/questions/new`, `C/questions/:id` · P

- **Components:** open/answered filters, topic/audience/recipient fields, question body/evidence, one-level answer threads, useful votes and accepted answer. Role badges distinguish peer and verified staff; official answer includes source and review date.
- **Actions/validation:** ask/edit, reply, vote once, accept/unaccept by author, follow and report. Mentions target existing readers. Convert to issue previews copied data/audience and requires author confirmation; retain reciprocal links and avoid duplicate conversion.
- **Service/state:** question CRUD/search, replies/votes/acceptance and conversion. Unanswered view invites a response; conversion pending/conflict states retain the original question.

### C02 Activities

Routes and stage: `C/activities`, `C/activities/new`, `C/activities/:id`, `C/activities/:id/manage` · E

- **Components:** type/time/group filters; title/details, organizer, audience, start/end, approximate location, capacity, joining deadline and cost/free field. Detail shows availability and organizer/college-approval labels; exact location/contact/participant coordination require accepted membership. Management shows private join requests/waitlist.
- **Actions/validation:** request join, organizer accept/reject/waitlist, participant leave, edit/cancel/complete. Check future/ordered dates, deadline before start, capacity >= accepted count, capacity of at least two including the organizer and non-negative cost. Atomic acceptance prevents overbooking; duplicate request is harmless. No public attendance roster.
- **Service/state:** activity/query/participation CRUD and private coordination. Show pending/accepted/waitlisted/full/closed/cancelled states distinctly; notify affected participants after material edits.

### C03 Marketplace and lost property

Routes and stage: `C/marketplace`, `C/marketplace/new`, `C/marketplace/:id` · E

- **Components:** separate Items and Lost & Found tabs; category/price/condition filters. Item editor contains title/details/category/condition/price or free/images/pickup area/audience. Lost/found editor uses type, item description, approximate place/date and private identifying evidence.
- **Actions/validation:** publish/edit/renew, inquire, reserve/sell/withdraw; lost/found mark reunited (`WITHDRAWN` with `outcome=RETURNED`, never `SOLD`). Require non-negative price, explicit free state and policy acceptance. Only owner changes state; expired listings require renewal. Keep distinguishing ownership proof private and avoid posting IDs/contact details.
- **Service/state:** listings/search/state changes and inquiry creation. Available/reserved/sold/withdrawn/expired states change calls to action; sold listings cannot start new negotiations.

### C04 Private inquiries

Routes and stage: `C/inquiries`, `C/inquiries/:id` · E

- **Access/components:** buyer/seller or authorized lost-property claim participants; private thread, item context, messages, optional permitted attachments, block/report and transaction safety guidance. No payments or live presence.
- **Actions/validation:** send/retry, block/report, agree pickup privately. Unique buyer/listing thread prevents duplicate conversations. Block prevents new messages, retains appropriate history and is not reported as a delivery failure.
- **Service/state:** participant-scoped inquiries/messages. Use deliberate refresh/modest polling; closed/unavailable item does not expose new participant information.

### C05 Activity team workspace

Routes and stage: `C/activities/:id/team` · E

- **Access/components:** accepted participants only; event updates, shared tasks with assignee/due date/status, private logistics and opt-in participant roster. One lead and up to three explicitly granted coordinators manage event work; these grants confer no official campus roles.
- **Actions/validation:** lead grants/revokes coordinators; authorized participants post updates and update assigned tasks. Recheck accepted membership on every request; roster consent is separate from joining. Validate task assignees against accepted members.
- **Service/state:** event-scoped team grants, updates/tasks/logistics and roster preferences. Removed/leaving members lose team access immediately. Close/archive with event and expire under its retention policy; show read-only archived state to still-authorized users.

## 2E Administration governance and operations

### G01 Campus configuration

Routes and stage: `C/admin`, `C/admin/settings`, `C/admin/units` · H minimum; P complete

- **Components:** setup checklist and configuration: timezone, working calendar/holidays, domains, emergency contacts, policy/retention links, module flags, custom categories and service units for additional college bodies, routing, units/groups, leads/backups/escalation contacts, response targets and pinned official notices with audience/expiry. Category and responsible service unit are separate configurable records; neither is hard-coded to the initial examples.
- **Actions/validation:** preview/save configuration; archive unit only after reassigning open work. Require active eligible responsible contacts, unique identifiers and valid calendar/expiry values. Policy changes are versioned; assess effects on existing deadlines explicitly.
- **Service/state:** privileged configuration reads/writes, policy versions and notice publishing. Require MFA; show unsaved-change warnings and audit confirmation. Budget status is read-only summary; privileged AI off switch is explicit.

### G02 Members invitations and roles

Routes and stage: `C/admin/members`, `C/admin/invitations`, `C/admin/roles` · P

- **Components:** searchable members/pending requests; group and role scope/expiry; email-specific invitations; role capability summary; approval/rejection reasons and administrator handover.
- **Actions/validation:** approve membership, invite, grant/revoke scoped role, suspend, expire/transfer group and rotate administrator. Prevent self-escalation, last-admin removal and grants exceeding actor authority. Require MFA/reason for privileged changes; revocation invalidates active access promptly.
- **Service/state:** member/invitation/grant lifecycle and audit. Bulk invitations preview recipients and errors; failed recipients remain retryable without duplicate grants.

### G03 Moderation and appeals

Routes and stage: `C/moderation`, `C/moderation/:id`, `C/appeals/:id` · P

- **Components:** scoped reports queue, reported content only within explicit case authority, policy reason, evidence, prior decisions and appeal deadline/status. Reporter sees their case; reviewer sees assigned appeal with conflict-of-interest control.
- **Actions/validation:** report, request clarification, redact/hide/restore with reason, notify affected author and submit/decide appeal. Reviewer must be independent; original moderator cannot decide their own appeal. Every outcome records reason and scope; do not silently delete complaint history.
- **Service/state:** moderation case/actions and appeals. Show pending/decided/appealable states; report submission does not itself hide content. Restricted-content access requires designated authority, not general moderator status.

### G04 Audit and operations

Routes and stage: `C/admin/audit`, `C/admin/operations` · P

- **Components:** restricted audit filters by actor/action/time/resource, safe event details, approved export requests; operations health, failed background jobs, quota/usage summary, backup/restore-test evidence and configuration checklist.
- **Actions/validation:** filter/export within authority, retry eligible idempotent job and disable optional AI when warranted. Audit records are read-only; do not log/expose credentials, raw tokens or sensitive case bodies. Destructive retention/admin actions need reason and confirmation.
- **Service/state:** paginated audit/operations summaries, export requests and controlled retries. Show freshness and partial-failure states. Platform operator screens for initial campus approval remain separate from campus administration.

### G05 Service reviews

Routes and stage: `C/service-reviews/new`, `C/service-reviews/:id`, `C/admin/service-reviews` · R1 minimal; R2 full

- **Components:** source issue/reply, reason (no response, incomplete fix, inappropriate conduct or retaliation), explanation, optional evidence and private audience preview. Detail shows independent reviewer, next update due and attributed timeline. Map canonical states to explicit labels: `OPEN` Submitted; `IN_REVIEW` Under review; `CLOSED` Review completed with a stated decision outcome; `ACTION_REQUIRED` Correction required; `ESCALATED` Awaiting independent reviewer. Acknowledgement is a timeline event, not another state.
- **Actions/validation:** submit, provide clarification, receive a reasoned outcome and request further review. R1 supports reason/evidence intake and independent authorized-admin handling; R2 adds dedicated queue, deadline/escalation filters and independent appeal. Reviewer cannot be the subject, source handler or otherwise conflicted; route conflicts to another approved reviewer. Do not require direct confrontation before reporting retaliation.
- **Service/state:** private service-review CRUD, scoped responses, reviewer assignment and timeline. Restrict visibility to complainant and authorized reviewers; share only approved relevant material with a responding party. Show delayed-response reason/next date, not a fabricated resolution. No public staff-shaming leaderboard; aggregate service accountability by unit. This workflow is separate from abuse moderation and does not claim legal adjudication authority.

## 2F Shared dialogs and reusable interaction units

- Audience preview/widening review; attachment upload/viewer; mentioned-person picker; support/follow control; report-content dialog; confirmation with reason; assignment/transfer picker; resolution proposal/confirm/reopen; AI precedent panel with citations; export progress; unsaved-change prompt.
- Each dialog has explicit title, scope, affected record, validated fields, Submit/Cancel, saving/error states and keyboard focus management. Call the same application capability regardless of launch page; never duplicate business rules in a drawer and full-page form.

## 2G Fair-process references

- [University of Cambridge — Student Complaints](https://www.studentcomplaints.admin.cam.ac.uk/student-complaints): supports defined response stages, conflict checks, reasoned decisions and independent review. CampusFix adopts these process principles; each college approves its own timelines and authority.
- [University of Michigan — Ombuds principles](https://ombuds.umich.edu/article/our-principles-and-standards): supports impartiality and independence, and distinguishes informal help from formal grievance procedures. CampusFix's service-review feature is not an accredited ombuds office or a guarantee of legal protection. Sources checked 19 September 2026.
