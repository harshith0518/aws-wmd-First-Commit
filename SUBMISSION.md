# CampusFix submission copy

## Fields to complete

| Form field | Value / action |
| --- | --- |
| Team leader's WeMakeDevs username | Enter your exact username from wemakedevs.org/home |
| Team leader's GitHub | https://github.com/harshith0518 |
| Team leader's LinkedIn | Enter your own public profile URL |
| Team leader's resume | Optional for submission; publicly accessible resume required for Amazon Fast Track consideration per the supplied form |
| Project title | **CampusFix — Accountable Campus Services** |
| Track | See the track note below before selecting |
| GitHub project | **https://github.com/harshith0518/aws-wmd-First-Commit** (main branch) |
| Deployed link | Leave blank while no public deployment exists; localhost is not a deployed URL |
| YouTube demo | Record [DEMO-VIDEO.md](DEMO-VIDEO.md), keep under 3 minutes, upload public/unlisted, then paste the actual URL |
| Other team members | Leave empty if participating solo |
| Blog links | Leave empty unless you publish a real AWS Builder Center post |

## Track decision

The [official First Commit page](https://www.wemakedevs.org/aws/first-commit) separates **Build It** (AWS open-source stack; local execution allowed) from **Ship It** (deploy on AWS). With the current account blocker, Build It is the appropriate track to evaluate. This repository uses open-source [AWS SDK v3](https://github.com/aws/aws-sdk-js-v3) and [AWS CDK](https://github.com/aws/aws-cdk), plus DynamoDB Local for local service emulation. Do not describe DynamoDB Local itself as an open-source project or claim guaranteed prize eligibility. Organizers decide whether the submitted tool usage meets their requirements. The form's optional deployment field does not waive the Ship It hosting requirement.

## What does your project do?

CampusFix is a college service-accountability application for students and campus teams. Reports are separated by campus, hostel, department or club, routed to a responsible team and tracked with a named owner, deadlines, attributed replies and an audit history. The owner proposes a structured fix; the reporting student confirms whether the issue is resolved. Private independent reviews let students challenge a poor response without exposing the case to the original handler. Reviewed resolutions form a permission-aware library for future problems. Our reproducible demo uses IIT Dholakpur, a fictional college with eight personas and nine reports, and persists real workflow changes locally.

## How did you use AWS?

We use the AWS SDK for JavaScript v3 for DynamoDB access, conditional writes and transactions. DynamoDB Local lets us run and test those workflows without a cloud account. AWS CDK, written in TypeScript, defines an AWS deployment with a private S3 frontend behind CloudFront, Cognito code/PKCE authentication, API Gateway and Lambda, three DynamoDB tables, an EventBridge transfer-expiry schedule, Secrets Manager and CloudWatch. We generated and tested the infrastructure template and prepared packaging, seeding and smoke-check scripts. AWS account access blocked live deployment; no running AWS-hosted environment or successful cloud Cognito journey is claimed. Bedrock is not used.

## Team leader's contributions

Designed the campus accountability workflows, audience rules, database access patterns and page-level low-level design. Built and integrated the React frontend, TypeScript/Hono API, DynamoDB persistence, issue lifecycle, discussions, ownership handovers, independent service reviews and reviewed resolution library. Prepared AWS CDK deployment tooling, automated authorization/concurrency checks and a resettable IIT Dholakpur demonstration dataset. Used Codex to assist implementation, review and verification. Review this statement so it accurately reflects your own contribution before submitting.

## Feedback: what could be better?

AWS account/Free Tier sign-in and credential setup were the main blocker: the local CLI credentials were invalid and we could not complete account access before the demo. A clearer onboarding path from Builder ID to an active deployment account, with actionable credential troubleshooting, would help new builders. DynamoDB transactions are powerful, but keeping access-pattern indexes and conditional writes correct requires careful design and real integration tests. DynamoDB Local also adds a Java prerequisite. These comments describe our actual local development experience, not a production AWS deployment.

## What worked well?

AWS SDK v3 provides typed, modular clients that let the same data layer target DynamoDB Local for testing and DynamoDB in the deployment design. DynamoDB Local made it practical to test concurrent writes, idempotency and permission-sensitive workflows without provisioning cloud resources. AWS CDK let us define and inspect the infrastructure in TypeScript and assert security properties of the generated CloudFormation template. This helped keep the application and deployment configuration together in one reproducible repository.

## Before clicking submit

- Verify the GitHub repository is public, opens on main and contains the latest commit.
- Run the demo once, reset before recording, upload a real <=3-minute YouTube video and check that its link works while signed out.
- Supply your own WeMakeDevs username, LinkedIn and optional public resume. Do not invent teammates or URLs.
- Leave deployment blank unless the actual site is available; choose the track consistent with what you built.
- Do not claim full LLD completion: onboarding/admin, notifications/escalations, AI and community modules are unfinished. Evidence uploads are deliberately disabled in this demo.

Exact verification results and limitations are in [SETUP-VERIFICATION.md](SETUP-VERIFICATION.md). Local setup and reset instructions are in [DEMO.md](DEMO.md); future AWS deployment steps are in [AWS-DEPLOY.md](AWS-DEPLOY.md).
