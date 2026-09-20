# IIT Dholakpur: reproducible CampusFix demo

A fictional college with real, persisted workflows. No AWS account, access keys, Cognito configuration or AI subscription is needed. This is the dataset used by the [video walkthrough](DEMO-VIDEO.md).

## Start in three commands

Prerequisites: Git, **Node 24**, and a **Java 17+ JDK** with `java` and `jar` available on PATH (or JAVA_HOME). [Amazon Corretto 21](https://docs.aws.amazon.com/corretto/latest/corretto-21-ug/downloads-list.html) is one suitable JDK. The first run needs internet for npm and the official DynamoDB Local download.

```bash
git clone https://github.com/harshith0518/aws-wmd-First-Commit.git
cd aws-wmd-First-Commit
npm ci
npm run demo
```

On Windows PowerShell use `npm.cmd` in place of `npm` if its PowerShell shim is blocked. Open **http://127.0.0.1:3002** and keep the terminal running. Click **Explore as Aarav**, or choose a persona card. No passwords. Ctrl+C stops the app and the database it started.

The launcher downloads the checksum-pinned official DynamoDB Local distribution, starts it on port 8000, creates three isolated demo tables, seeds real records using application services and serves the React app with the actual Hono API. The app binds to 127.0.0.1 only. No cloud resources are provisioned.

## Repeat the exact recording

Stop the running demo with Ctrl+C, then:

```bash
npm run demo:reset
```

This replaces **only** `campusfix-demo-core`, `campusfix-demo-discovery` and `campusfix-demo-jobs` on `http://127.0.0.1:8000`. It starts the app again with the same people and stories. Timestamps are fresh and record IDs can change; use the on-screen shortcuts instead of saved issue URLs. Reset discards changes made during rehearsal.

Normal `npm run demo` preserves changes in `.local/demo/database`. If a database already occupies port 8000, the launcher uses it and persistence follows that server's configuration. Stop an older in-memory test database first for persistence across restarts. Port 3002 must be free; stop its existing demo before resetting. Do not delete unrelated database files to resolve a conflict.

The seed has a version marker and supports retry after an interrupted first seed. A different dataset version requires the explicit reset. Demo memberships expire after fourteen days; reset then. Sessions last two hours; select the persona again after expiry. Refreshing the page returns to the overview, but retains database records.

## Built-in college

**IIT Dholakpur is fictional and has no affiliation with a real IIT.** Names, accounts, reports and conversations are synthetic. Four topic categories route to one Campus services team; more independent teams can be configured later. This demo does not claim a campus-admin UI.

| Persona | Membership / responsibility | Useful demonstration |
| --- | --- | --- |
| Aarav Sharma | Final-year CSE; Kaveri hostel; Coding club | Reporter of purifier issue; confirm its resolution |
| Meera Nair | Final-year CSE; Narmada hostel | Different hostel feed; private draft; placement/fee concerns |
| Kabir Rao | Third-year CSE; Kaveri hostel; Coding club | Public reply; requester of private ramp review |
| Sana Khan | Second-year Mechanical; Narmada hostel | Mechanical and Narmada reports; no CSE/club access |
| Prakash Varma | Campus services lead | Accountable owner; queue, updates, resolution proposal, curation |
| Neha Iyer | Deputy services lead | Assigned purifier collaborator; eligible ownership recipient |
| Dr Saira Rao | Independent reviewer | Private review of the ramp response; no automatic issue access |
| Rohan Sen | Dholakpur Institute of Design | Another campus, with no access to IIT Dholakpur |

The **Explore as** selector switches the demo identity. The server issues local signed tokens and then applies normal membership, role, source and audience checks. A persona selector is intentionally a local demonstration aid, not production authentication. The AWS application excludes these routes and requires Cognito.

## Seeded stories

| Report | Audience | Starting state |
| --- | --- | --- |
| Kaveri hostel water purifier needs repair | Kaveri residents + assigned handlers | In progress; Prakash owner, Neha collaborator |
| Placement registration link is unavailable | Campus | Submitted |
| Library Wi-Fi restored after adapter replacement | Campus | Reporter-confirmed closed; reviewed library card |
| CSE lab LAN ports are intermittent | CSE | In progress |
| Coding club projector HDMI input fails | Coding club | Acknowledged |
| Fee portal receipt download fails | Campus | Waiting for vendor |
| Narmada mess drinking-water tap leaks | Narmada residents | Submitted |
| Library access ramp needs a handrail repair | Campus | In progress |
| Workshop corridor lights need replacement | Mechanical | Submitted |

Also seeded: Meera's private fan draft; two public purifier replies; one private staff note; a placement reply; Kabir's private ramp service review assigned to Dr Saira. The original handler cannot read that review. Every audience also includes its reporter and assigned handlers under the canonical policy.

## What works

- Create/edit private drafts and publish a real issue with an explicit audience and responsible team.
- Browse scoped feeds, staff queues, named owners, deadlines, histories and workflow actions.
- Add public replies/private notes, mark affected, assign collaborators and accept ownership handovers.
- Propose a structured resolution; only its reporter confirms it; reopen with a reason.
- Request and handle private independent reviews; search reviewed, permission-checked resolutions.
- **My access** shows the selected person's actual membership and group/role records.

## Checks

```bash
npm run check
# While npm run demo keeps DynamoDB Local running in another terminal:
npm run test:integration
```

The check gate covers contracts, types, domain/security tests, production builds, CDK and local-demo restrictions. Integration tests use separate temporary tables. See [SETUP-VERIFICATION.md](SETUP-VERIFICATION.md) for exact observed results.

## Release limits

- No live AWS deployment, real Cognito login or AWS cost validation is claimed. Deployment code is in [AWS-DEPLOY.md](AWS-DEPLOY.md).
- Evidence uploads are disabled in this demo until secure cloud storage/scanning acceptance; no fake proof files are displayed.
- No AI/Bedrock generation. Resolution search is bounded, permission-aware keyword retrieval.
- Notifications, overdue escalation, campus onboarding/admin, review appeals/files/reassignment and Q&A/activities/marketplace remain unfinished LLD scope.
- Local persona access is not a publicly hostable login system. Do not tunnel or deploy this demo server. Use the separate Cognito/CDK path when an AWS account becomes available.
