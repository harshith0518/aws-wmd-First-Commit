# M6 real campus pilot

Read AGENTS.md, docs/00-remarks-and-decisions.md, docs/03-identity-and-permissions.md, docs/06-workflows-and-consistency.md, docs/08-aws-deployment-and-cost.md, specs/openapi.json and the implementation sequence in chapter 9.

Implement verified onboarding, Questions/notices, full service-review/moderation/appeals queues, SES, scan result handling, exports, retention and backup restoration. Enforce independent reviewers and no silent closure. List real policy/contact inputs without inventing them.

Keep the implementation compact and preserve existing work. Update relevant contracts and docs together when resolving a mismatch. Run npm.cmd run check and meaningful module tests. End with implemented behavior, tests run, a reviewable diff and any remaining blockers.
