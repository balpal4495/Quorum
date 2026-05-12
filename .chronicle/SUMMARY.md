<!-- Chronicle Summary v1 — temporal orientation for agents. Use for sequence context; query Oracle by entry ID for full reasoning. -->

## Week 2026-W20

### [pr PR #6]
- **[10b848a2]** docs, README.md, mermaid — `validated` (0.97) — Mermaid node labels do not support \n line breaks — the escape is parsed literally and causes the entire diagram to fail silently on GitHub with a blank render and no error message
- **[e51cc52f]** docs, README.md, mermaid — `validated` (0.95) — Mermaid sequence diagram activation markers inside alt/else blocks trigger GitHub's 'svg element not in render tree' error — strip all plus/minus activation syntax for reliable rendering

### [pr PR #7]
- **[3af41e8a]** docs, mermaid, workflow — `validated` (0.99) — GitHub renders Mermaid diagrams in PR body descriptions as well as in markdown files — add diagram code blocks to PR descriptions to validate rendering before merging to main
- **[d93b6f40]** docs, README.md, mermaid — `validated` (0.97) — Mermaid flowcharts with multiple back-edges fail layout with 'Could not find a suitable point' — structure as a DAG and move feedback loop narrative to a sequence diagram instead

### (no work context — query Oracle by entry ID for details)
- **[30bdc1c1]** oracle/propose.ts, chronicle/write-path, shared/types.ts — `validated` (0.88) — key_insight specificity in propose.ts enforced by schema constraints, not LLM self-evaluation
- **[55278b3d]** oracle/propose.ts, shared/types.ts, chronicle/write-path — `open` (0.78) — SUMMARY.md gives agents temporal sequence that vector search cannot — what work happened and in what order; Oracle query gives semantic relevance; both are needed
- **[716ab32b]** oracle/query.ts, chronicle/read-path — `validated` (0.82) — Synthesis layer in oracle/query.ts deferred until Chronicle has real entries for calibration
- **[b0ae359a]** oracle/propose.ts, chronicle/write-path — `validated` (0.85) — High-similarity commits in oracle/propose.ts warn of supersession, not hard-block
