# 5 API contracts and service boundaries

The machine contract is `specs/openapi.json` (OpenAPI 3.1). It specifies 168 operations across R1/R2/R3. Only `/api/health` is implemented in the starter. Every business operation has `x-implemented: false`; `x-release` identifies its implementation stage. Implement vertical workflows in the order in section 9, not all endpoints simultaneously.

## 5A Common contract

- Base: `/api/v1`; campus operations use `/campuses/{campusId}`. In examples below, `C` means that full campus prefix. Identity and operator routes have separate prefixes. JSON bodies are limited to 64 KB; unknown input fields are rejected.
- Authentication: Cognito access token in `Authorization: Bearer …`. Validate issuer, client, expiry, `token_use=access` and `campusfix/api` scope. Load current membership and scoped grants on each request. The server derives actor identity; target IDs such as assigneeId never identify the actor.
- Mutations require `Idempotency-Key`, 16–128 characters. Scope by actor, campus/global context, method and path; retain request hash/result for at least 24 hours. Same key and payload replays the committed response; changed payload returns `409 IDEMPOTENCY_CONFLICT`. Retries reuse the original key.
- Updates and commands carry `expectedVersion`; creations do not invent version zero. A child update uses that child's version. Participation decisions also carry `activityExpectedVersion`; issue-subtask creation checks the issue version. Version conflict returns latestVersion without discarding the user's unsaved text.
- Lists return `{items, nextCursor, candidateLimitReached?}`; at most 25 authorized items. Cursors bind actor, campus, authorization version and filters for 15 minutes. An empty bounded page may still have a nextCursor. Filters reset cursors; there are no unverified total counts.
- Error response: `{code, message, requestId, fieldErrors?, latestVersion?}`. Use 401 for invalid identity, 404 for absent or inaccessible objects, 403 for an action forbidden on a visible object, 409 for conflicting versions, 422 for validation or an invalid workflow transition, 429 for quotas and 503 for unavailable dependencies. Include Retry-After where appropriate.
- Private API responses use `Cache-Control: private, no-store`; return X-Request-Id. Never serialize DynamoDB keys, invitation tokens, private emails, object keys or unapproved evidence. Stable DTOs and field-level serializers separate domain records from browser responses.

## 5B Identity and campus joining

- `GET /me`, `PUT /me`: read/synchronize profile. PUT accepts displayName only; the server retrieves verified identity/email from Cognito userInfo. It accepts no roles or email-verification claims from the browser.
- `GET /me/campuses`, `GET /campuses`: own memberships and published campus summaries. `POST C/join` applies verified-domain admission and accepted policy version; groups remain approval-based.
- `POST /invitations/inspect`, `/invitations/accept`: token in body, email-bound, expiring, single-use. Return safe role/campus preview, never raw invitee details. Tokens are excluded from logs.
- `GET C/membership`; `GET/POST C/membership/requests`; request withdrawal and group-leave commands. Approval changes membership/authVersion atomically. Group selection does not itself grant access.
- R2 representative onboarding: create `/campus-requests` draft, reserve/upload clean authority evidence under its ID, then submit. Own requests can be read, amended when requested or withdrawn. Records use a global owner-bound onboarding partition, because the campus does not yet exist.
- `/api/operator/v1/...` requires separate operator identity/MFA. Only an operator verifies initial authority or administrator handover. Campus administrators cannot approve themselves through these endpoints.

## 5C Shared posts, replies and files

- `GET C/home` returns permitted notices, action items and recent issues. `GET C/configuration` returns usable categories/units/groups and feature flags. `GET C/directory/people` requires a purpose and optionally target post/unit, limiting mention, assignment and reviewer choices.
- `GET C/posts` filters type, group, category, unit, status, query and author; newest/oldest sort uses createdAt. Examine at most 200 indexed candidates per request, rehydrate canonical records and authorize before output. Updated-time ranking needs an additional index and is deferred.
- `POST C/drafts`, draft GET/PATCH/publish/discard: private server-side drafts. Publish applies the complete type-specific schema and validation. `PATCH C/posts/{postId}` revises allowed content with reason/history; it cannot change state, owner or ACL.
- `POST .../audience` is separate. Narrowing changes current ACL; widening protected content creates a linked redacted summary. Existing restricted replies/evidence remain protected. History and revisions are separately paginated.
- Replies use `GET/POST .../replies`, PATCH/remove commands and one nesting level. Create text first to obtain reply ID, then upload under that REPLY parent. Completion links attachmentIds atomically; creation never requires nonexistent reply-scoped files. STAFF scope requires explicit handling permission. Mentions notify only existing readers. Follow/mute are current-user PUT operations.
- File flow: reserve → direct quarantined S3 POST → complete → poll state → download. Reservation binds generated key, parent, scope, type, size and checksum. Completion verifies receipt; only the worker sets CLEAN. Maximum three JPEG/PNG/PDF files, 5 MB each; reject unsafe/failed scans.
- File authorization resolves actual POST, REPLY, SERVICE_REVIEW, REVIEW_CONTEXT_REQUEST, ACTIVITY_TEAM or INQUIRY parent before its narrower scope. Original issue handlers gain no automatic review-evidence access. Context-request files use only explicitly named CONTEXT_PARTIES. ONBOARDING uses the separate global flow. Authorized CLEAN download URLs expire after 60 seconds; already-issued URLs remain usable until expiry.

## 5D Issue workflow and service review

- `POST C/issues` selects active category, handling unit and permitted audience. Server assigns the accountable duty lead. A restricted case requires an eligible sensitive-handler owner and named caseHandlerIds; otherwise keep draft.
- `POST C/issues/{postId}/commands` accepts a discriminated action: acknowledge, start, progress, wait, resume, propose-resolution, confirm, reopen, decline, duplicate, propose-transfer, accept-transfer, reject-transfer or set-priority. Each action has its own required fields in OpenAPI.
- Progress requires update, nextAction and nextUpdateAt. Waiting/reopening/declining require reason. Resolution requires fix/outcome plus clean evidence or evidenceOmissionReason. Only the reporter confirms closure; silence never confirms. Transfers use stable transferId and preserve the old owner's accountability until acceptance.
- Assignment PUT manages eligible collaborators/initial allocation; existing owner transfer follows the command workflow. `PUT .../case-handlers` requires expectedVersion/reason and 1–9 eligible sensitive handlers including current owner; only eligible restricted owner or designated sensitive unit lead may act, excluding complaint subjects. Subtasks have assignee, unit, due date and OPEN/DONE/CANCELLED state. `GET C/staff/queue` checks authorized unit and canonical assignment after indexed lookup.
- Issue detail includes typed currentResolution with fix, outcome, evidence, proposal/confirmation and publishedVersion; `GET .../resolutions` returns permitted prior attempts, including invalidated attempts after reopening.
- `POST C/service-reviews` references source issue/reply and reason NO_RESPONSE, INCOMPLETE_FIX, INAPPROPRIATE_CONDUCT or RETALIATION. Create text review first, obtain its ID, then reserve/upload evidence under SERVICE_REVIEW; completion links evidence atomically. Private allegations never appear in issue DTOs. Review DTO includes ackDueAt, decisionDueAt and stable decisionId for appeals.
- Review states: OPEN → IN_REVIEW → ACTION_REQUIRED/CLOSED/ESCALATED. Outcomes: COMPLAINT_UPHELD, RESPONSE_UPHELD or INSUFFICIENT_EVIDENCE. Corrective action requires owner/due date; reviewer verifies remedy before closing. Reasoned closure exposes an appeal route. Original handler, subject, complainant or conflicted reviewer cannot decide.
- R1 supports intake, independent assignment, responses and decision. R2 adds the dedicated queue, escalation and independently assigned appeal. Abuse reporting is a different workflow and never substitutes for dissatisfied-service review.
- R2 reviewers can draft sanitized context requests for involved staff, upload separately shared evidence, then explicitly send. `/service-review-context-requests/{id}` lets only owner reviewer/named recipient read that request; the recipient answers there without gaining whole-review access. DRAFT → SENT → RESPONDED → CLOSED. No automatic sharing of original allegations or evidence; complainant/reviewer responses stay in the private review.

## 5E Questions and community

- R2 Questions use typed creation, shared replies, useful-vote PUT and accepted-answer PUT. Only question author accepts/clears an answer. Conversion requires author confirmation, unit/audience validation and creates reciprocal question/issue links once.
- R3 Activities use creation/edit, join, participant decision, leave and cancel/complete commands. Organizer automatically occupies one ACCEPTED seat and becomes team lead; capacity is at least two and includes that seat. Acceptance atomically checks capacity and participant/activity versions.
- Private team endpoints cover lead/coordinator grants, logistics, updates, tasks, opt-in roster and archive. Maximum three coordinators, each already accepted; event grants convey no campus authority. Assigned participants may update their own task state; lead/coordinators control assignment and logistics. Team leader handover requires nominee acceptance before leaving.
- Removed/leaving participants immediately lose team access. Ended/archived events become read-only. Public activity audience never includes exact logistics or a default attendance roster.
- R3 Listings use typed SALE/FREE/LOST/FOUND creation, revisions and reserve/sell/withdraw/renew/returned commands. Store INR integer minor units. Lost/found recovery becomes WITHDRAWN with RETURNED outcome, not Sold. Renewal starts a new 30-day expiry.
- One inquiry per buyer/listing; participant-only messages, close and block actions. Blocking prevents new messages while retaining appropriate history. No platform payments, sockets or public contact details.

## 5F Knowledge, notifications and metrics

- Library search requires category and optional keywords/unit/group. Retrieve at most 100 recent reviewed candidates, then validate current source ACL, confirmed resolution and eligibility. Curators create/review/retire; members can flag stale entries.
- `POST C/ai/suggestions` binds post/version and purpose PRECEDENTS, ROUTING or DUPLICATES. Output: summary, suggestedActions[{text,sourceIds}], sources[{id,date,title}], limitations, available and optional reason/routing suggestions. Maximum three permitted sources; validate every cited ID. Disabled/unapproved-region/quota/no-source/model failures return available=false and a reason, preserving ordinary search/reporting.
- Own notification lists render previews only after source authorization. Mark-read accepts IDs or allBefore; preferences control digest/email/mentions. Workers reauthorize recipients before delivery; broadcasts do not email every member.
- Metrics return scope, methodologyVersion and calculatedAt. Separate proposed/confirmed closure and preserve denominators. Sensitive cohorts below ten suppress counts and revealing drilldowns. Export jobs recheck authorization before delivering 60-second download links.

## 5G Administration and implementation checks

- Configuration PATCH requires version/reason and explicit impact on existing service deadlines. Categories, units and groups have dedicated typed create/update endpoints. Custom categories map to active handling units; every active unit needs eligible lead, backup and escalation contact.
- R2 member status, scoped role grants/revocation, invitations, group approvals and administrator handover enforce MFA, authority ceilings, expiry and last-admin protection. Generic role/invite endpoints reject ADMIN; operator verification handles that role.
- Moderation reports create a case without automatically hiding content. Decisions specify reason/action/appeal deadline; independent appeal assignment prevents self-review. Operators/admins receive safe audit, operations and eligible failed-job retry views, never unrestricted private conversations.
- Implement shared validation, policy, transaction, serializer and idempotency helpers before module handlers. Test positive/negative role cases, stale versions, duplicate retries, revoked membership, cross-campus references, capacity races and clean-file gates. Contract validity proves interface consistency; it does not prove the business implementation exists or is secure.
