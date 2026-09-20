# M5 infrastructure and demo readiness

Read AGENTS.md, docs/00-remarks-and-decisions.md, docs/08-aws-deployment-and-cost.md, specs/openapi.json and the implementation sequence in chapter 9.

Implement the described CDK stacks, build artifacts, configuration outputs, permissions, alarms and smoke-test scripts. Run synth and inspect diff. Prepare a reproducible deployment and synthetic demo; do not claim or execute a paid deployment unless the current user task authorizes it. Verify account, region and IAM separately from Builder ID.

Keep the implementation compact and preserve existing work. Update relevant contracts and docs together when resolving a mismatch. Run npm.cmd run check and meaningful module tests. End with implemented behavior, tests run, a reviewable diff and any remaining blockers.
