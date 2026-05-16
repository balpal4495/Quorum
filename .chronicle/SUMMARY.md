<!-- Chronicle Summary v1 — temporal orientation for agents. Use for sequence context; query Oracle by entry ID for full reasoning. -->

## Week 2026-W20

### [pr PR #1]
- **[d99b3438]** CLAUDE.md, GEMINI.md, SETUP.md, bin/init.js — `validated` (0.88) — Support Claude Code, Gemini CLI, and Copilot as first-class agents via conditional instruction files; Gemini is opt-in at runtime — projects without it are fully unaffected. Support Claude Code, Gemini CLI, and Copilot as first-class agents via conditional instruction files; Gemini is opt-in at runtime — projects without it are fully unaffected

### [pr PR #10]
- **[30646f01]** modules/sentinel/review.ts, modules/sentinel/assert.ts, modules/sentinel/coverage.ts, .github/workflows/sentinel-pr.yml — `validated` (0.90) — PR coverage comment shows full-project table and Mermaid heatmap (not a path diagram); test files excluded from coverage; minCoveragePercent defaults to 0 so new projects get advisory output not CI failures. PR coverage comment shows full-project table and Mermaid heatmap (not a path diagram); test files excluded from coverage; minCoveragePercent defaults to 0 so new projects get advisory output not CI failures

### [pr PR #11]
- **[bb131226]** bin/init.js, package.json, .github/workflows/release.yml, .npmignore — `validated` (0.85) — Distribute as @balpal4495/quorum npm package using OIDC Trusted Publishing via npx --package=npm@11; upgrade and sentinel subcommands deferred pending real deployment calibration. Distribute as @balpal4495/quorum npm package using OIDC Trusted Publishing via npx --package=npm@11; upgrade and sentinel subcommands deferred pending real deployment calibration

### [pr PR #12]
- **[0b49c565]** README.md — `validated` (0.82) — README leads with AI agent mode workflow (Claude Code, Copilot, Cursor) not TypeScript API examples; code examples moved to secondary section for custom pipeline builders. README leads with AI agent mode workflow (Claude Code, Copilot, Cursor) not TypeScript API examples; code examples moved to secondary section for custom pipeline builders

### [pr PR #16]
- **[88d2b11f]** scripts/chronicle-pr.js, .github/workflows/chronicle-on-merge.yml — `validated` (0.88) — PR merge Chronicle proposals use confidence 0.4 with source_quality: metadata-derived and needs_human_summary: true — they are drafts, not validated knowledge. PR merge Chronicle proposals use confidence 0.4 with source_quality: metadata-derived and needs_human_summary: true — they are drafts, not validated knowledge
- **[bf448871]** modules/council/deliberate.ts, modules/council/risk.ts, modules/council/types.ts — `validated` (0.95) — Low-risk designs skip Council entirely — Jury alone is sufficient and Council is not called at all (0 LLM calls from Council). Low-risk designs skip Council entirely — Jury alone is sufficient and Council is not called at all (0 LLM calls from Council)

### [pr PR #19]
- **[e57c30d5]** .github/workflows/auto-release.yml, .github/workflows/release.yml — `validated` (0.93) — Releases trigger from PR merge labels, not manual tag pushes — GITHUB_TOKEN pushes cannot trigger other workflows, so release.yml needs workflow_dispatch for recovery. Releases are triggered by PR labels (release:patch, release:minor, release:major) on merge to main — auto-release.yml bumps version, commits, tags, and publishes; release.yml is the manual recovery hatch via workflow_dispatch
- **[81cc81ca]** .github/workflows/auto-release.yml, .github/workflows/release.yml — `validated` (0.91) — npm publishes via OIDC Trusted Publishing with NODE_AUTH_TOKEN from NPM_TOKEN secret — granular token must have 2FA bypass disabled to work in CI. npm publishes via OIDC Trusted Publishing with NODE_AUTH_TOKEN from NPM_TOKEN secret — no classic tokens, no stored credentials in workflow files

### [pr PR #21]
- **[7ad64411]** bin/commands/growth.js — `validated` (0.95) — quorum growth shows STALLED/SLOW/HEALTHY/THRIVING status with weekly sparkline and recent learnings — visibility into whether Chronicle is actually being used.. quorum growth shows STALLED/SLOW/HEALTHY/THRIVING status with weekly sparkline and recent learnings — visibility into whether Chronicle is actually being used.
- **[17c26113]** bin/commands/evolve.js — `validated` (0.95) — quorum evolve sends all committed entries to an LLM for consolidate/resolve/promote analysis, staging every proposed change through the human gate — Chronicle improves without bypassing human approval.. quorum evolve sends all committed entries to an LLM for consolidate/resolve/promote analysis, staging every proposed change through the human gate — Chronicle improves without bypassing human approval.
- **[09676e84]** bin/commands/advisor.js, bin/commands/evolve.js — `validated` (0.93) — When no LLM is configured, advisor and evolve output Chronicle evidence + a synthesis request to stdout (exit 0) rather than erroring — the parent AI agent (Claude Code, Copilot, Codex) answers inline.. When no LLM is configured, advisor and evolve output Chronicle evidence + a synthesis request to stdout (exit 0) rather than erroring — the parent AI agent (Claude Code, Copilot, Codex) answers inline.
- **[a183c37e]** bin/shared/llm.js — `validated` (0.92) — LLM detection priority: ANTHROPIC_API_KEY → OPENAI_API_KEY → GEMINI_API_KEY → OPENAI_BASE_URL keyless → Ollama probe → Gemini CLI with auth check; implemented as single detectProvider() returning { llm, name }.. LLM detection priority: ANTHROPIC_API_KEY → OPENAI_API_KEY → GEMINI_API_KEY → OPENAI_BASE_URL keyless → Ollama probe → Gemini CLI with auth check; implemented as single detectProvider() returning { llm, name }.
- **[66c3b4bb]** scripts/chronicle-growth.js, .github/workflows/chronicle-on-merge.yml — `validated` (0.91) — chronicle-on-merge.yml posts a PR comment on every merge showing Chronicle entry count delta and which entries were committed during that PR — team-visible proof of learning attached to specific work.. chronicle-on-merge.yml posts a PR comment on every merge showing Chronicle entry count delta and which entries were committed during that PR — team-visible proof of learning attached to specific work.
- **[090c7dc6]** modules/advisor/ask.ts, modules/setup.ts — `validated` (0.97) — Advisor is a strictly read-only path — it never calls oracle.propose() or oracle.commit(). Advisor is a strictly read-only path — it never calls oracle.propose() or oracle.commit(). Any write to Chronicle must go through Jury/Council or direct oracle.propose() in the host application.
- **[3efb1789]** modules/advisor/ask.ts, modules/advisor/prompt.ts — `validated` (0.92) — Advisor validates its own answers before returning — retries up to 2 times when confidence < 0.7 or blockers are present, passing the previous answer as context. Advisor validates its own answers before returning — retries up to 2 times when confidence < 0.7 or blockers are present, passing the previous answer as context

### [pr PR #6]
- **[10b848a2]** docs, README.md, mermaid — `validated` (0.97) — Mermaid node labels do not support \n line breaks — the escape is parsed literally and causes the entire diagram to fail silently on GitHub with a blank render and no error message.
- **[e51cc52f]** docs, README.md, mermaid — `validated` (0.95) — Mermaid sequence diagram activation markers inside alt/else blocks trigger GitHub's 'svg element not in render tree' error — strip all plus/minus activation syntax for reliable rendering.

### [pr PR #7]
- **[3af41e8a]** docs, mermaid, workflow — `validated` (0.99) — GitHub renders Mermaid diagrams in PR body descriptions as well as in markdown files — add diagram code blocks to PR descriptions to validate rendering before merging to main.
- **[d93b6f40]** docs, README.md, mermaid — `validated` (0.97) — Mermaid flowcharts with multiple back-edges fail layout with 'Could not find a suitable point' — structure as a DAG and move feedback loop narrative to a sequence diagram instead.

### [pr PR #9]
- **[6296d310]** modules/sentinel/coverage.ts, modules/sentinel/drift.ts, modules/sentinel/assert.ts, modules/sentinel/index.ts — `validated` (0.92) — Coverage tests are deterministic and can fail CI; drift tests skip gracefully without an LLM — advisory never blocking — consistent with the warn-not-hard-block principle. Coverage tests are deterministic and can fail CI; drift tests skip gracefully without an LLM — advisory never blocking — consistent with the warn-not-hard-block principle

### [pr v2.0.0 breaking change]
- **[4af1fb64]** bin/commands/init.js, SETUP.md, package.json, scripts/sentinel-pr.ts — `validated` (0.95) — Vendoring solved AI visibility of module source, but the CLI now handles the main interaction surface. Docs give agents what they need; source in node_modules gives teams clean npm update upgrades.. Quorum modules live in node_modules (@balpal4495/quorum), not copied into host repos. init writes only quorum/CLAUDE.md, quorum/AGENTS.md, quorum/SETUP.md as documentation. evals stay in the package.

### (no work context — query Oracle by entry ID for details)
- **[20aac893]** bin/commands/growth.js, bin/quorum.js — `validated` (0.95) — quorum growth command provides Chronicle learning health monitoring with growth rate, days-since-last-commit, and actionable advice when stalled.. quorum growth is a standalone CLI command (not a sentinel subcommand) that measures Chronicle growth rate, flags SLOW (7d) / STALLED (14d) status, shows a weekly sparkline, and surfaces pending proposals with commit instructions.
- **[30bdc1c1]** oracle/propose.ts, chronicle/write-path, shared/types.ts — `validated` (0.88) — key_insight specificity in propose.ts enforced by schema constraints, not LLM self-evaluation.
- **[55278b3d]** oracle/propose.ts, shared/types.ts, chronicle/write-path — `open` (0.78) — SUMMARY.md gives agents temporal sequence that vector search cannot — what work happened and in what order; Oracle query gives semantic relevance; both are needed.
- **[716ab32b]** oracle/query.ts, chronicle/read-path — `validated` (0.82) — Synthesis layer in oracle/query.ts deferred until Chronicle has real entries for calibration.
- **[b0ae359a]** oracle/propose.ts, chronicle/write-path — `validated` (0.85) — High-similarity commits in oracle/propose.ts warn of supersession, not hard-block.
