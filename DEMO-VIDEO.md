# CampusFix demo video — maximum 3 minutes

Target **2:45–2:50**. Record the actual local application, using exactly the IIT Dholakpur seed. Upload the final video to YouTube as **unlisted or public** and paste its URL into the submission. This file is a script, not an already recorded/uploaded video.

## Before recording

1. Follow [DEMO.md](DEMO.md); stop the demo, run `npm run demo:reset`, then open http://127.0.0.1:3002.
2. Rehearse once, reset again, and leave the overview ready. Use 100% browser zoom; a 1280px-or-wider window helps.
3. Keep this script and the proposal text below beside the recording. Capture the browser; do not capture personal tabs, credentials or unrelated college data.
4. Prepare the repository README architecture diagram in a second tab. Do not show AWS Console resources as if deployed.

## Timed recording plan

| Time | What to do on screen | Suggested narration |
| --- | --- | --- |
| 0:00–0:18 | Campus overview; show IIT Dholakpur and personas | “CampusFix gives college service reports a named owner, visible progress and student-confirmed closure. This is IIT Dholakpur, a fictional college with seeded students and staff.” |
| 0:18–0:42 | **Explore as Aarav** → **Water purifier report**. Show title, audience, Prakash and deadlines. Scroll to the two public replies. | “Aarav reports a hostel purifier failure. Kaveri residents and assigned handlers can see it. Prakash is accountable, Neha collaborates, and students can follow attributed updates.” |
| 0:42–0:55 | **Explore as → Meera Nair · Student**. Show her feed briefly. | “Meera belongs to Narmada hostel, so she sees its reports and shared campus concerns, but not Kaveri's report. These checks run on the API, not just the interface.” |
| 0:55–1:35 | Switch to **Prakash Varma · Staff** → **Water purifier report**. Scroll to **Record the next step**, choose **Propose a resolution**, paste prepared fields, tick audience confirmation, submit. | “The owner records what failed, what was done and the outcome. A proposal remains open until the reporting student confirms it. This local story has no physical repair or evidence attachment.” |
| 1:35–1:53 | Switch to **Aarav Sharma · Student** → **Water purifier report**. Scroll to the proposal and confirmation form. Tick confirmation and submit **Confirm the issue is resolved**. Show closed status/history. | “Aarav reviews and confirms the result. The history preserves who acted; a staff member cannot confirm on the student's behalf.” |
| 1:53–2:08 | Switch to **Dr Saira Rao · Reviewer** → **Independent review**. | “If a response is poor, an independent reviewer handles a private case. This seeded ramp case is hidden from the original handler.” |
| 2:08–2:23 | Switch to Aarav → **Confirmed Wi-Fi repair** → **Open resolution library card**. Show its review and source link. | “Confirmed fixes become reviewed knowledge with source permissions. This is search and reuse, not generated AI advice.” |
| 2:23–2:48 | Repository README: local and planned AWS architecture; briefly show verification section. | “The stack is React, TypeScript and Hono, using AWS SDK v3 against DynamoDB Local. AWS CDK defines the Cognito, Lambda, API Gateway, DynamoDB and S3/CloudFront deployment. Account access blocked deployment, so this video shows local execution only. The reproducible demo and verification commands are in the repository.” |

Leave a few seconds for pauses and finish **before 3:00**. Cut typing pauses, not the before/after results. If running long, shorten the feed and library shots. Do not speed through unreadable forms or claim unfinished features.

## Prepared resolution fields

- **Problem addressed:** Kaveri hostel second-floor purifier was not dispensing water.
- **Cause (optional):** A failed inlet valve interrupted the water flow.
- **Work completed:** Replaced the inlet valve, flushed the line and tested the dispenser.
- **Observed outcome:** Water flows normally. The reporting resident can now verify the repair.
- **Why is evidence unsuitable or unavailable?:** Synthetic local demo: no physical repair or evidence file exists.
- Tick **I reviewed this action and its audience.** and submit.

For Aarav's confirmation tick **I reviewed this action and its audience.** and click **Confirm the issue is resolved**. No reason text is required.

## Submission honesty

- This recording uses local signed personas, not Cognito login. No live AWS resources or deployment URL exist yet.
- Actual AWS tooling used: AWS SDK for JavaScript v3, DynamoDB Local and AWS CDK. The AWS services shown in the diagram are the deployment design, not a completed cloud deployment.
- Bedrock is not used. Attachments are unavailable in the demo. Community modules are roadmap scope.
- All people and reports are fictional. No real campus complaints or personal identifiers are needed.
- The form's deployed-link field is optional, but the official **Ship It** track still requires AWS deployment. Read [SUBMISSION.md](SUBMISSION.md) before choosing a track.
