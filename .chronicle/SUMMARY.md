<!-- Chronicle Summary v1 — temporal orientation for agents. Use for sequence context; query Oracle by entry ID for full reasoning. -->

## Week 2026-W20

### [pr PR #16]
- **[88d2b11f]** scripts/chronicle-pr.js, .github/workflows/chronicle-on-merge.yml — `validated` (0.88) — PR merge Chronicle proposals use confidence 0.4 with source_quality: metadata-derived and needs_human_summary: true — they are drafts, not validated knowledge. PR merge Chronicle proposals use confidence 0.4 with source_quality: metadata-derived and needs_human_summary: true — they are drafts, not validated knowledge
- **[bf448871]** modules/council/deliberate.ts, modules/council/risk.ts, modules/council/types.ts — `validated` (0.95) — Low-risk designs skip Council entirely — Jury alone is sufficient and Council is not called at all (0 LLM calls from Council). Low-risk designs skip Council entirely — Jury alone is sufficient and Council is not called at all (0 LLM calls from Council)

### [pr PR #19]
- **[e57c30d5]** .github/workflows/auto-release.yml, .github/workflows/release.yml — `validated` (0.93) — Releases trigger from PR merge labels, not manual tag pushes — GITHUB_TOKEN pushes cannot trigger other workflows, so release.yml needs workflow_dispatch for recovery. Releases are triggered by PR labels (release:patch, release:minor, release:major) on merge to main — auto-release.yml bumps version, commits, tags, and publishes; release.yml is the manual recovery hatch via workflow_dispatch
- **[81cc81ca]** .github/workflows/auto-release.yml, .github/workflows/release.yml — `validated` (0.91) — npm publishes via OIDC Trusted Publishing with NODE_AUTH_TOKEN from NPM_TOKEN secret — granular token must have 2FA bypass disabled to work in CI. npm publishes via OIDC Trusted Publishing with NODE_AUTH_TOKEN from NPM_TOKEN secret — no classic tokens, no stored credentials in workflow files

### [pr PR #21]
- **[090c7dc6]** modules/advisor/ask.ts, modules/setup.ts — `validated` (0.97) — Advisor is a strictly read-only path — it never calls oracle.propose() or oracle.commit(). Advisor is a strictly read-only path — it never calls oracle.propose() or oracle.commit(). Any write to Chronicle must go through Jury/Council or direct oracle.propose() in the host application.
- **[3efb1789]** modules/advisor/ask.ts, modules/advisor/prompt.ts — `validated` (0.92) — Advisor validates its own answers before returning — retries up to 2 times when confidence < 0.7 or blockers are present, passing the previous answer as context. Advisor validates its own answers before returning — retries up to 2 times when confidence < 0.7 or blockers are present, passing the previous answer as context

### [pr PR #6]
- **[10b848a2]** docs, README.md, mermaid — `validated` (0.97) — Mermaid node labels do not support \n line breaks — the escape is parsed literally and causes the entire diagram to fail silently on GitHub with a blank render and no error message.
- **[e51cc52f]** docs, README.md, mermaid — `validated` (0.95) — Mermaid sequence diagram activation markers inside alt/else blocks trigger GitHub's 'svg element not in render tree' error — strip all plus/minus activation syntax for reliable rendering.

### [pr PR #7]
- **[3af41e8a]** docs, mermaid, workflow — `validated` (0.99) — GitHub renders Mermaid diagrams in PR body descriptions as well as in markdown files — add diagram code blocks to PR descriptions to validate rendering before merging to main.
- **[d93b6f40]** docs, README.md, mermaid — `validated` (0.97) — Mermaid flowcharts with multiple back-edges fail layout with 'Could not find a suitable point' — structure as a DAG and move feedback loop narrative to a sequence diagram instead.

### (no work context — query Oracle by entry ID for details)
- **[30bdc1c1]** oracle/propose.ts, chronicle/write-path, shared/types.ts — `validated` (0.88) — key_insight specificity in propose.ts enforced by schema constraints, not LLM self-evaluation.
- **[55278b3d]** oracle/propose.ts, shared/types.ts, chronicle/write-path — `open` (0.78) — SUMMARY.md gives agents temporal sequence that vector search cannot — what work happened and in what order; Oracle query gives semantic relevance; both are needed.
- **[716ab32b]** oracle/query.ts, chronicle/read-path — `validated` (0.82) — Synthesis layer in oracle/query.ts deferred until Chronicle has real entries for calibration.
- **[b0ae359a]** oracle/propose.ts, chronicle/write-path — `validated` (0.85) — High-similarity commits in oracle/propose.ts warn of supersession, not hard-block.
