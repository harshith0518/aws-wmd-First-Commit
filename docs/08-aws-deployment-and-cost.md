# 8 AWS deployment operations and cost

## 8A Infrastructure specification

- Environment separation: independent dev and prod stacks, Cognito pools, tables and buckets. Default record-storage region ap-south-1. Use separate AWS accounts for production when the college can operate them. Never seed demo members into production.
- Frontend: private S3 origin and CloudFront Origin Access Control; HTTPS redirect, compression and immutable hashed assets. index.html uses short/no-cache headers. Rewrite navigation requests to index.html only for SPA paths; missing assets must remain 404.
- API: API Gateway HTTP API routed to one Hono Lambda. Set a JWT authorizer on every business route with scope campusfix/api; health is public and discloses no configuration. Configure exact allowed frontend origins and localhost only for dev.
- Lambda: arm64 when all native dependencies support it, 512 MB initial memory, 29-second timeout, no VPC attachment and no provisioned concurrency. Tune from measurements. Bundle only required AWS SDK v3 modules; reuse clients across warm invocations.
- Database: three on-demand tables from specs/dynamodb-tables.json. Enable point-in-time recovery, deletion protection and retained removal policies in prod; disposable dev resources require an explicit environment flag.
- Jobs: transactional outbox items enter SQS through a dispatcher; workers handle notifications, housekeeping and projections. Configure visibility timeout longer than worker processing, partial batch failure response, maximum receive count 5 and DLQ retention 14 days. The scheduler queries due Jobs every five minutes.
- Files: versioned private quarantine/evidence buckets and the scan pipeline in section 7. GuardDuty result events require matching bucket, key and version, not a user-provided clean flag. Images are processed by a separate Lambda with bounded memory/pixel limits.
- Email: SES verified sender/domain and production sending permission for real users. Until approved, use in-app notifications and permitted sandbox recipients. Template emails contain a generic action link, not complaint content.
- AI: separate narrowly scoped role or function can invoke only the configured Bedrock model/profile. A campus kill switch, request quota and token limit are checked server-side. The base API works with this role and feature disabled.
- Logs and audit: structured CloudWatch records with requestId, campusId, operation, safe error code and duration. Redact authorization headers and bodies. Export safe audit events to a bucket not writable by ordinary application roles.
- Secrets: browser variables are public and contain only API URL, Cognito client/pool/domain and region. Keep server secrets such as cursor encryption keys in Secrets Manager or encrypted Parameter Store. Do not place account keys, invitation tokens or production data in Git.

## 8B CDK stack boundaries and outputs

- IdentityStack: user pool, managed login domain, public client, resource server scope and configured callback/logout URLs. Require MFA for the real pilot. The initial operator is provisioned through an audited setup command, not open signup.
- DataStack: Core, Discovery, Jobs, file buckets, retention configuration and backup settings. Output table names and bucket names for the other stacks.
- AppStack: API Lambda, worker functions, API Gateway, queues, scheduler, IAM grants, alarms and optional Bedrock/GuardDuty integration. No wildcard administrator policies on application roles.
- WebStack: S3/CloudFront, deployment of apps/web/dist and security headers. Outputs web URL, API URL and identity settings; a script writes only PUBLIC values into the frontend build environment.
- Infrastructure code is an implementation task, not silently pre-provisioned by this design package. The starter contains the workspace and table specification; do not claim that an infra README has deployed AWS.

## 8C Deployment sequence

- Implement and locally validate the identity, data and application stacks. Run npm ci, typecheck, unit tests, contract validation, build and CDK synth. CDK diff must show only the intended environment and no destructive table replacement.
- Authenticate AWS CLI using SSO or an approved profile. Confirm account and region with sts get-caller-identity and configuration; AWS Builder ID alone is not an AWS account, IAM permission set or funded deployment profile.
- Bootstrap CDK in the chosen account/region once; deploy Identity/Data/App. Configure Cognito callbacks for the provisional CloudFront URL, then build and deploy Web using stack outputs. Resolve any circular URL dependency with a config update, not wildcard callbacks.
- Initialize category/unit configuration and seed synthetic demo identities in dev only. Production setup requires verified representative, actual owners, emergency contacts, policy and notification configuration.
- Run smoke tests using two students in different groups, one staff owner, one administrator and a second campus. Verify API authorizers, exact origin rules, S3 denial, resolution flow, queues and revoked access.
- Enable AI only after model access, inference geography, quotas and evaluation pass. Enable real file uploads only after scan failure tests pass. Enable SES external sending after the account permits it.
- Release a versioned backend artifact and immutable frontend build. Store commit hash, environment and deployment time. Run the acceptance checklist before sharing the URL.
- Rollback by restoring the previous Lambda version and frontend artifact. Database migrations are additive so old and new readers remain compatible; data rollback is a separately tested recovery operation.

## 8D Operations and failure responses

- Alert on API 5xx > 2 percent over five minutes with at least 100 requests, sustained p95 latency > 2 seconds, DLQ > 0, oldest job > 15 minutes, file scanning stuck > 15 minutes, and unusual authentication failures. Tune thresholds from pilot measurements.
- Alert on budget at 50, 80 and 100 percent. Budget alerts are delayed and are not hard spending caps. Apply API throttles, Lambda concurrency bounds, per-user upload limits and Bedrock quotas to reduce overspend.
- Initial API throttle proposal: 20 requests/second sustained, burst 40; Lambda reserved concurrency 10. Load-test before adopting these numbers because low caps can reject legitimate bursts. Return 429 with Retry-After and preserve drafts.
- Restore targets for pilot: RPO <= 24 hours for the complete application and RTO <= 4 hours, to be proved by a recovery drill. PITR may give a tighter database recovery point but does not by itself restore identity, files, config and deletion history.
- Recovery drill: restore tables to new names, verify evidence versions and configuration, replay deletion ledger, verify permissions and counts, then switch environment references. Never test restoration over the sole production copy.
- Security incident: disable affected feature or principal, preserve safe audit evidence, revoke grants, rotate relevant keys and have the college's named contact handle notifications under its policy. Do not publish sensitive incident details through the student feed.
- Graduations and staff departures: scheduled expiry and roster review, remove grants, reassign owned issues, transfer event ownership or cancel safely, and invalidate client sessions where possible.

## 8E Cost model and limits

- Planning workload per month: 1,000 active users, 2,000 posts, 10,000 replies, 300,000 API calls, 10 GB average stored files, 20 GB outbound, 5,000 emails and 2,000 AI suggestions. The prior $50/month figure remains a target, not a regional AWS quote.
- Lambda compute example: 300,000 invocations x 0.2 seconds x 0.5 GB = 30,000 GB-seconds, plus workers, cold-start time and requests. Apply current architecture and regional rates; do not assume the free tier applies independently per campus.
- DynamoDB model must count canonical strong reads, feed pointer queries, reference rehydration, GSIs and transactional writes. A read is not one API call. For <=4 KB items, 300,000 requests averaging six strongly consistent item reads would already be 1.8 million read units before list query overhead.
- For <=1 KB items, a transaction modifying six items costs 12 transactional write units before index work. Track actual consumed capacity; fanout, larger bodies and retries change this estimate. The UI's 25-result page is bounded to avoid unpriced scans.
- AI: 2,000 x 2,500 input tokens and 2,000 x 500 output tokens = 5 million input and 1 million output tokens. Cost equals those quantities times the selected model/profile rates. The $5 AI allowance is an allocation target, not a verified prediction.
- Files: price storage, versions, thumbnails, PUT/GET requests, egress, scanning and discarded quarantine files separately. Include CloudFront, SES, CloudWatch, backup storage and Cognito tier. Exclude hackathon credits when estimating sustainable cost.
- Practical reductions: fetch one feature tab at a time, use cursor pagination, resize thumbnails, poll notifications only while visible every 60 seconds, refresh feeds on navigation, batch jobs, avoid duplicated raw evidence in events, and keep AI user-triggered.
- Track daily cost drivers by campus in usage records. A production release needs a saved AWS Pricing Calculator estimate for the actual region and an initial 7-day usage review; obtain account-specific inputs at deployment without delaying local implementation.

## 8F Hackathon release implementation (20 September)

- The immediate deployable release is `infra/stack.ts`, a single synthetic-demo stack in Mumbai. Use `AWS-DEPLOY.md`; the earlier sections remain the full pilot target.
- Logical Identity/Data/App/Web boundaries are kept in one stack to reduce setup and callback dependencies. CloudFront serves S3; the browser calls the separately authenticated HTTP API origin. Exact CORS and callback URLs are derived from outputs.
- Node 24 x64 is used with explicitly packaged Linux Sharp. Demo tables, pool, web bucket and cursor secret are retained, with table deletion protection. PITR/restore checks are not claimed for the demo.
- MFA is optional; no real-college enrollment is supported. Seed creates six synthetic Cognito accounts and expiring memberships, including two hostels and a second campus.
- Only transfer-expiry scheduling is deployed. Notification delivery, deadline workers, SQS/SES, AI and the GuardDuty/evidence cloud pipeline remain outside this release. Files and AI are disabled.
- Error alarms have no notification actions. API throttling is configured; Lambda reserved concurrency is deferred because new-account quotas vary. Actual live sign-in, IAM, performance and billing acceptance must follow account deployment.
