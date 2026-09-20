# 3 Identity and permission design

## 3A Login and campus admission

- Cognito owns registration, email verification, password reset and MFA. The SPA uses code plus PKCE, validates state and nonce, and never holds a client secret. Keep tokens in memory; keep only temporary PKCE state in session storage and clear it after callback. A reload may redirect through the existing Cognito session.
- Use the access token, not the ID token, for API calls. Verify signature, issuer, expiration, token_use=access and the configured client ID. Require resource scope campusfix/api at API Gateway. In local API mode use the same verification middleware; tests inject a test principal at the service boundary, never through a production header.
- PUT /me synchronizes a profile only after server verification of the identity and verified email from Cognito userInfo. Treat the browser's display name as untrusted text. Never trust a client-supplied verifiedEmail or role.
- A campus is provisioned by the operator after checking an initial representative through a college-controlled contact. Record verification method, verifier, date and non-sensitive reference. Domain ownership alone never grants college administration.
- The verified representative receives a single-use email-bound invitation. Store only the hash of its 32-byte random token; expire after 72 hours. Accept atomically against unused status, expiry and verified email. Do not log token URLs.
- Approved domains grant an ordinary campus membership after verified signup. Group membership still requires a roster or approval. Other addresses need an email-specific invitation. Changing the account email suspends admission until checked again.
- A campus administrator nominates staff to a specific unit and moderator/reviewer to a defined scope. Privileged grants require completed MFA enrollment, an audit event and an explicit expiry. At pilot launch require Cognito MFA for all accounts to make enforcement unambiguous; prefer authenticator TOTP to SMS cost.
- Group join requests store requested group, short reason and status. The group approver can accept or reject with a reason. Approval updates the membership group list and its authorization version in one transaction.
- A member may hold several roles, but each grant states campus, unit or group scope. Expired, suspended or revoked memberships fail every request immediately after the authoritative read, including direct file requests.
- Administrator handover requires an existing administrator nomination plus operator verification. Never revoke the last active verified administrator without a confirmed replacement. Break-glass access is operator-only, time-limited and audited.

## 3B Canonical read policy

- First require active identity and active membership in the requested campus. Derive actor and campus from verified context; never accept actorId from a write body.
- CAMPUS posts are readable to all active members of that campus. GROUPS posts require membership in at least one audience group, or the author, or an explicit active handling grant. Author retention applies while campus membership stays active and the record is not sealed by a moderation decision.
- RESTRICTED cases are readable only to the reporter and named active case handlers. A general campus administrator, moderator or unit lead does not automatically qualify. All handlers need a scoped sensitive-handler role in their active membership and inclusion in the post's authoritative caseHandlerIds array, limited to nine including the primary owner. There is no separate case-grant table.
- DRAFT posts are author-only. Private inquiries are buyer and seller only; private activity details are organizer and accepted participants only. A moderator sees reported message evidence through a separately authorized case snapshot, not all private conversations.
- Public replies inherit post access. STAFF notes require post access plus an assigned handler role; attachments can be PUBLIC, HANDLERS or REPORTER_HANDLERS within that parent. Attachment policy first resolves parentKind=POST|REPLY|SERVICE_REVIEW|REVIEW_CONTEXT_REQUEST|ACTIVITY_TEAM|INQUIRY|ONBOARDING and checks that parent's permission. A review file is never implicitly readable by the original issue's handler or subject; a team file requires accepted participation. CONTEXT_PARTIES files belong only to the sanitized context request's reviewer and recipient. An attachment is never broader than its actual parent, and generic file listings must filter these scopes.
- All content lists, counts, mentions, library results, notification previews, exports and AI requests call the same policy functions. Return 404 for an inaccessible object so IDs do not disclose existence. Return 403 for a visible object with a forbidden action.
- Campus directory search shows only display name, eligible role and permitted unit. It never lists other students' email, phone, private memberships or sensitive case assignments.

## 3C Action matrix

- Student: create posts in permitted scopes; edit own draft; revise own published content with history; reply; support once; confirm or reopen own issue; accept own question answer; manage own activities and listings; report abuse and appeal decisions affecting them.
- Primary issue owner: acknowledge, begin, wait, post progress, propose resolution and propose transfer. Requires unit grant plus explicit issue assignment. Cannot confirm closure on the reporter's behalf.
- Collaborator: reply and complete an assigned subtask; cannot transfer ownership, decline the issue, alter audience or confirm closure unless separately granted that role.
- Unit lead: triage and assign ordinary issues in their queue, accept transfers, handle overdue work and review unit metrics. For a restricted case, the sensitive-handler role and inclusion in caseHandlerIds are still required.
- Moderator: act on reported ordinary content within assigned scope, record restriction/redaction reasons, and route an appeal to an independent reviewer. Cannot erase history or read every restricted case by virtue of role.
- Appeal reviewer: read the specific appeal evidence granted to them and uphold or reverse the moderation decision. Must not be the deciding moderator, complaint subject, reporter or current issue owner.
- Campus administrator: configure directory, domains, invitations, role grants, service targets and feature flags; inspect administrative audit and aggregate operations. No implicit sensitive content permission.
- Operator: verify campuses, maintain infrastructure, perform documented recovery and exceptional support. Keep operator powers out of student UI; ordinary support uses explicit temporary grants.

## 3D Permission changes and privacy races

- Every canonical post has aclVersion and every membership has authVersion. Mutations carry expected version; authorization reads occur immediately before the write. High-risk writes include a ConditionCheck on the relevant membership version in the same transaction.
- Scope changes use a dedicated endpoint with reason. Widening never publishes the original private evidence or replies: create a linked redacted public summary, while retaining the original restricted case. A campus-to-group narrowing updates the original ACL and removes obsolete pointers transactionally.
- Reassignment grants access to the proposed new owner only after eligibility validation, with a pending-handler grant scoped to reviewing the transfer. The existing owner stays accountable until acceptance; declining expires the pending grant.
- Immediately clear browser query caches on logout, campus switch or a membership rejection. Use Cache-Control private, no-store for API responses containing content. Do not persist private feeds or drafts in a service worker.
- File download URLs expire in 60 seconds and are issued only after a fresh authorization check. Already-issued URLs remain usable until expiry; membership revocation cannot recall a downloaded file. Record this practical limit in the pilot policy.
- A mention never adds audience membership or grants a role. Only notify recipients with current access. Notification content is generated at read time after checking access.

## 3E Abuse and disclosure controls

- Plain-text bodies with safely rendered links; no raw HTML. Escape all user text and enforce a restrictive CSP. Limit request bodies to 64 KB before parsing.
- Per member defaults: 5 new posts per hour, 30 per day; 30 replies per hour; 10 AI requests per day; upload byte quota. Campus quotas override downward. Apply separate invitation and membership-request throttles.
- Freeze or redact a reported post with a visible reason and appeal route. Preserve a minimal audit record without duplicating removed sensitive text into permanent logs.
- Sensitive complaint subjects cannot assign themselves as handlers. Offer a route to a separately designated reviewer when the normal lead is the subject.
- Accessibility and emergency information remain reachable without opening a complaint. Configure real college emergency numbers before any real-campus launch; sample fixtures never display invented emergency contacts as real.
