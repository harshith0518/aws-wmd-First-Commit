# M2 issue reporting and evidence

Read AGENTS.md, docs/00-remarks-and-decisions.md, docs/02-pages-and-interactions.md, docs/07-files-ai-and-retention.md, specs/openapi.json and the implementation sequence in chapter 9.

Implement custom directory configuration, drafts, issue submission, permitted feeds, detail and secure upload lifecycle. Add the W01-W04 screens and parent-specific file permissions. Use actual API writes and reads. Real uploads must fail closed unless scanning is available; local synthetic fixtures must never enable a deployed bypass.

Keep the implementation compact and preserve existing work. Update relevant contracts and docs together when resolving a mismatch. Run npm.cmd run check and meaningful module tests. End with implemented behavior, tests run, a reviewable diff and any remaining blockers.
