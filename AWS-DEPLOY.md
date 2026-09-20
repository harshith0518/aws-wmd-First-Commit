# Deploy CampusFix on AWS tonight

This deploys the **working accountability core** with real Cognito sign-in and DynamoDB persistence. The complete LLD is larger than this release. No AWS deployment or real Cognito acceptance has yet been performed from the development machine: its local credentials are invalid. These commands use your AWS Console session instead.

## 1. Open CloudShell

1. Sign in to your AWS account, choose **Asia Pacific (Mumbai), ap-south-1**, and open **CloudShell** from the console toolbar.
2. Use an account/role allowed to deploy CloudFormation and create the required IAM roles, Cognito, Lambda, API Gateway, DynamoDB, S3, CloudFront, Secrets Manager, EventBridge and CloudWatch resources. An AWS Builder ID is not the deployment login.
3. Check **Billing → Credits** and create a small AWS Budget alert (for example $5 and $10). Free Tier/credits depend on your account; this is not a guaranteed zero-cost deployment. Budgets warn; they do not cap spending.

CloudShell is [already authenticated to your console identity](https://docs.aws.amazon.com/cloudshell/latest/userguide/welcome.html). Do not run `aws configure` or paste access keys into chat.

## 2. Get the checked release

Run in **CloudShell Bash**, not Windows PowerShell:

```bash
aws sts get-caller-identity
sudo dnf install -y nodejs24 nodejs24-npm
sudo alternatives --set node /usr/bin/node-24
node --version
npm --version
export npm_config_cache=/tmp/campusfix-npm-cache
git clone --branch codex/campusfix-lld --single-branch https://github.com/harshith0518/aws-wmd-First-Commit.git campusfix-release
cd campusfix-release
npm ci
npm run check
```

Node must report **v24.x**. Amazon Linux supports the [versioned Node 24 packages and alternatives command](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html). If the console session is old and the packages are unavailable, open a fresh CloudShell environment before retrying. If `campusfix-release` already exists, enter that folder and use `git pull --ff-only` instead of cloning over it.

`check` validates contracts, types, domain/auth tests, web/API builds and CDK security tests. It does not require AWS permissions or DynamoDB Local. The separately tested database integration suite requires localhost:8000; do not run it against AWS.

## 3. Deploy

```bash
npm run aws:deploy
```

This command:

- Verifies the actual account and fixes the region to Mumbai.
- Packages the API and transfer worker for **Node 24 / Linux x64**, including Sharp; performs a Linux cold-start import check in CloudShell.
- Bootstraps CDK, synthesizes and displays the infrastructure diff, then deploys `CampusFixDemo`.
- Creates a private S3 web origin, HTTPS CloudFront distribution, Cognito user pool/domain/public client, JWT-protected HTTP API, two Lambdas, three DynamoDB tables, a cursor secret and a five-minute transfer-expiry schedule.
- Builds the frontend using the real stack URLs; uploads hashed assets before `index.html`; waits for CloudFront invalidation; runs public smoke checks.
- Writes public resource outputs to `.artifacts/aws-outputs.json`. Prints the **CloudFront HTTPS URL** to submit.

Allow time for CloudFront and Cognito creation. This provisions resources and may consume credits. Keep the CloudShell tab open. Do not submit a localhost URL or the S3 bucket URL.

The API permits 20 requests/second with burst 40. There is no EC2, NAT gateway, RDS, provisioned concurrency, Bedrock or file-scanning service in this demo stack. A small Secrets Manager storage charge and usage/storage/logging charges can remain outside your allowance. Check your own Billing view.

## 4. Create demo logins and sample workflows

```bash
npm run aws:seed
cat .artifacts/demo-credentials.json
```

The second command shows **your generated demo passwords** in your private CloudShell session. Never commit this file or publish privileged demo passwords. Seed creates genuine Cognito users and synthetic memberships, not an auth bypass. Their reserved `.example` addresses are operator-provisioned demo identities; no emails are sent and no real college affiliation is claimed.

| Login | What to demonstrate |
| --- | --- |
| student-a@campusfix.example | Hostel A, Computer Science, coding club; report and confirm a fix |
| student-b@campusfix.example | Hostel B, Computer Science; cannot read Hostel A reports |
| owner@campusfix.example | Campus services lead; staff queue, replies, progress, resolution proposal, curation |
| backup@campusfix.example | Second eligible lead; collaborator and accepted ownership handover |
| reviewer@campusfix.example | Independent review of a poor response; no automatic source-issue access |
| outsider@campusfix.example | Separate campus; cannot enter the main demo campus |

Seed includes a Hostel A issue, a campus-wide placement issue and a completed Wi-Fi issue with a reviewed library card. Students still create and change real records through the app. Memberships/roles expire after 14 days. Preserve the credentials file: reruns retain users/passwords and do not reset an existing campus. Initial retry is supported; do not use seeding as a reset tool after editing demo records.

Save deployment state before leaving CloudShell:

```bash
mkdir -p "$HOME/campusfix-demo-backup"
cp .artifacts/aws-outputs.json .artifacts/demo-credentials.json "$HOME/campusfix-demo-backup/"
chmod 600 "$HOME/campusfix-demo-backup/demo-credentials.json"
```

Use CloudShell **Actions → Download file** if you need a private local backup. Keep credentials out of the submission repository and video; share a limited demo login only through a private judging field if the organizer supports one.

## 5. Verify the live site before submission

```bash
npm run aws:smoke
```

Automated cloud checks: Lambda health; absent/invalid JWT rejected; allowed-origin preflight and foreign-origin rejection; HTTPS page routes; missing assets stay failures; S3 origin is private; Cognito discovery responds. These checks **do not** prove a successful login or the signed-in workflow.

Then open the printed CloudFront URL:

1. Sign in as student A; choose the synthetic campus; open the Hostel A issue and create one report with an explicitly selected audience.
2. Sign out; sign in as student B. Confirm the Hostel A issue is absent while campus-wide placement is visible. A copied Hostel A issue URL must not reveal its content.
3. Sign in as owner. Open **Staff queue**, acknowledge/start a report, add a reply, and propose a resolution with a truthful evidence-omission reason. Staff must not be able to confirm for the student.
4. Sign in as its reporter; confirm the fix, inspect attributed history, and reopen if needed.
5. On an unresolved report, student A requests a service review. The original owner must not discover that private case. The independent reviewer can begin/respond/decide.
6. Open **Resolution library**, choose **Network connectivity**, and search `router`. Open the seeded card and its confirmed source. Curators can publish a new card from a new confirmed resolution.
7. Sign in as the outsider; only the separate campus is listed. Use separate browser profiles or sign out between identities.

Access tokens stay in memory. A full page refresh requires signing in again in this release. Normal in-app navigation preserves the session. Real uploads are deliberately unavailable; the UI says so and text reports remain functional.

## 6. Submit

- Live URL: the `WebUrl` value printed by deployment.
- Code: the `codex/campusfix-lld` branch, including `README.md`, the LLD and this guide.
- Demo: record the short walkthrough in `SUBMISSION.md`. Show AWS CloudFormation/Lambda/CloudFront to establish deployment, without exposing credentials or private data.
- Description: student report → responsible team → visible progress → reporter-confirmed resolution → reusable reviewed knowledge, with private independent service reviews.
- Be explicit: AI/Bedrock, community modules and the complete campus-admin/pilot scope are not included in this release.

## If something fails

| Symptom | Next action |
| --- | --- |
| `AccessDenied` / bootstrap fails | Check the console role can deploy these services and pass/create the scoped roles. Ask the account administrator if restricted; do not weaken app IAM or make buckets public. |
| Account/service unavailable | Finish AWS activation and check that your account plan allows the required service. Do not silently upgrade a paid account plan; review the console notice. |
| Stack rollback | Open **CloudFormation → CampusFixDemo → Events**; use the first failed resource's reason. Fix that cause, then rerun deployment. If the stack is `ROLLBACK_COMPLETE`, remove only the failed stack after inspecting its retained resources; do not destroy data from a working demo. |
| Deploy succeeded but upload/smoke failed | Keep `.artifacts/aws-outputs.json`; run `npm run aws:publish`, then `npm run aws:smoke`. This rebuilds with the correct URLs and does not recreate data. |
| Callback mismatch / blank login page | Use the exact CloudFront hostname, not localhost. Check the user-pool client callback is `<WebUrl>/auth/callback`, logout is `<WebUrl>/`, and code grant with `campusfix/api` scope is enabled. |
| `503` on API | Check the API Lambda's CloudWatch logs for the request ID and safe error category. Confirm tables and Cognito settings from stack outputs. Do not log access tokens or complaint bodies. |
| Seed interrupted | Rerun `npm run aws:seed` with its saved `.artifacts/demo-credentials.json`. It refuses foreign pools or unrecognized existing campus data. For a confirmed user with lost local seed state, recover through the Cognito Console; do not delete the whole user pool. |
| CloudShell storage is full | Check `df -h`; npm cache is already placed in `/tmp`. Download important artifacts and use a fresh checkout in a new environment if necessary; do not delete stored credentials indiscriminately. |

## Scope and operating limits

- **Included:** identity, canonical membership/role checks, private drafts, scoped issues, replies/staff notes, affected count, fourteen issue commands, transfers/collaborators, private independent reviews, reviewed resolution library and bounded keyword search.
- **Disabled on AWS:** attachments/GuardDuty, optional AI and sensitive-case intake. No public uploads or unscanned file release.
- **Not finished:** real-campus onboarding/admin UI, notifications/outbox delivery, overdue reminders/escalations, review evidence/reassignment/appeal submission, questions, event teams, marketplace, verified MFA requirement and restore/load/cost acceptance.
- The scheduled worker expires transfers only. Outbox rows and CloudWatch alarms do not imply notification delivery. Alarm actions are not connected to a human recipient yet.
- This is a synthetic hackathon demo, not approval to operate a real college complaints system. Real pilot requires the remaining security/operational checks in chapters 8–9.
- Tables, user pool, web bucket and cursor secret are retained on stack deletion. Deleting a stack alone will not remove those resources or their charges. After judging, review the exact retained resources and backups before cleanup; do not run a broad account deletion command.
- Frontend archives are in `.artifacts/releases/`. For rollback, rebuild the last known good commit with the same outputs and rerun deployment/publish. Data rollback is not implemented or verified; avoid schema changes during the demo.
