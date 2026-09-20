# CampusFix submission notes

## One sentence

CampusFix makes student concerns accountable: the right audience, a named owner, visible progress, student-confirmed closure and a reviewed record of what fixed the problem.

## What to show in 3–4 minutes

1. **Problem, 20 seconds:** reports disappear across email and group chats; students cannot identify an owner or verify closure.
2. **Student report, 40 seconds:** sign in, choose Hostel A visibility, create a report; show a named handling team and deadline. All data shown is synthetic.
3. **Accountable work, 60 seconds:** staff queue, attributed reply/progress, proposed resolution; the reporting student confirms. Show preserved history and reopening.
4. **Privacy, 30 seconds:** another hostel does not see Hostel A's report. Private service review goes to an independent reviewer; the original handler cannot see it.
5. **Reuse, 30 seconds:** search the resolution library and open the verified source, current reviewer and review date. This is bounded authorized search; do not describe it as AI generation.
6. **AWS, 20 seconds:** show the CloudFront URL and deployed stack resources. Frontend: S3/CloudFront; API: API Gateway/Lambda; identity: Cognito; data: DynamoDB; transfer schedule: EventBridge.

## Why the implementation matters

- Current campus/group/role checks at the server; discovery indexes do not grant permission.
- Atomic versions, idempotency, audit history and durable outbox records prevent duplicate or conflicting workflow writes.
- The reporter confirms the outcome. A staff member cannot silently close their own work as student-confirmed.
- Independent service-review routing excludes current and previous involved handlers.
- Reviewed knowledge inherits source permissions and becomes unavailable when its source is reopened or inaccessible.
- Serverless, bounded queries, small text payloads and no always-on servers; usage-based billing still requires account monitoring.

## Truthful release boundary

- Local evidence upload/scan/sanitize tests pass, but **real AWS uploads are disabled** until GuardDuty acceptance. Do not demonstrate a fake scanner as AWS.
- AI/Bedrock is optional and not implemented in this release. The organizer's supplied email permits this; deployment on AWS is still necessary.
- Notifications, full campus administration, overdue escalation, review appeals/files and community modules are roadmap work.
- A passed local build or health check is not deployment proof. Fill the live URL only after AWS deployment, public smoke and signed-in acceptance.

## Submission fields

- Name: **CampusFix**
- Source: https://github.com/harshith0518/aws-wmd-First-Commit/tree/codex/campusfix-lld
- Live URL: use `WebUrl` from `.artifacts/aws-outputs.json` after deployment.
- Video: record the real deployed workflow above; upload using the organizer's requested method.
- Test credentials: use only a private judging field if supported. Never publish the owner/reviewer passwords in this repository.
- Design: `docs/00-remarks-and-decisions.md` and numbered LLD chapters; deployment: `AWS-DEPLOY.md`; evidence: `SETUP-VERIFICATION.md`.
