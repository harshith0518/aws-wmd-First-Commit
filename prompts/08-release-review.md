# Complete release audit

Read AGENTS.md, docs/00-remarks-and-decisions.md, docs/09-build-plan-and-acceptance.md, specs/openapi.json and the implementation sequence in chapter 9.

Review the implemented release against page, API, DB, permission and operations contracts. Run the appropriate acceptance checks, including real browser flows. Fix gaps within the release scope, document remaining external inputs and produce a concise release report. Do not count mock or skipped features as completed.

Keep the implementation compact and preserve existing work. Update relevant contracts and docs together when resolving a mismatch. Run npm.cmd run check and meaningful module tests. End with implemented behavior, tests run, a reviewable diff and any remaining blockers.
