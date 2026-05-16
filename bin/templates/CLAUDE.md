# Quorum — How to use this project's memory layer

Quorum gives every AI session access to this project's approved decisions, rejected
approaches, and institutional knowledge. It runs as a CLI tool backed by a local
`.chronicle/` store.

---

## Start every session with memory

Before proposing or planning anything, run:

```bash
quorum advisor brief
```

This shows the full Chronicle summary — what the team has already learned and approved.

Then query for the specific area you are about to work in:

```bash
quorum advisor query "topic of the work"
```

If relevant entries exist, treat them as ground truth. **Refuted entries are hard stops** —
do not retry a refuted approach without explicitly surfacing the failure reason to the user.

---

## Check designs before coding

For any significant change, run a preflight check first:

```bash
quorum check \
  --outcome "what you want to achieve" \
  --design  "how you plan to do it"
```

Exit codes: `0` = low/medium risk — proceed. `1` = high risk — human review first.
`2` = critical — stop and get explicit sign-off.

Auth, payments, crypto, database migrations, PII, and data deletion always trigger
elevated risk, regardless of how the design is framed.

---

## Propose what was learned

When a significant decision is made or an approach is ruled out, stage a Chronicle
proposal for human review:

The Council stages proposals automatically after deliberation. You can also stage
them manually by following the Chronicle proposal template in SETUP.md.

```bash
quorum commit --list        # see all pending proposals
quorum commit <id>          # approve and index a proposal
```

**Never call `oracle.commit()` autonomously.** Only propose. A human must approve.

---

## Keep memory healthy

```bash
quorum growth               # is Chronicle actually growing?
quorum evolve               # consolidate duplicate or stale entries (uses LLM)
quorum sentinel coverage    # which source files have Chronicle entries?
```

---

## Chronicle structure

```
.chronicle/
  committed/      ← approved entries, indexed and searchable (commit to git)
  proposals/      ← staged entries awaiting your approval (do not commit)
  SUMMARY.md      ← auto-generated context, rebuilt on every commit
```

Commit `.chronicle/committed/` so every teammate and every new AI session starts with
the same accumulated knowledge. Never commit `.chronicle/proposals/`.

---

## CLI quick reference

```bash
quorum advisor brief                          # full Chronicle summary, no LLM
quorum advisor query "topic"                  # keyword search, no LLM
quorum advisor "plain-language question"      # synthesised answer via LLM
quorum check --outcome "..." --design "..."   # instant risk triage
quorum commit --list                          # review pending proposals
quorum commit <id>                            # approve a Chronicle entry
quorum growth                                 # Chronicle learning health
quorum evolve                                 # consolidate stale entries (LLM)
quorum sync                                   # refresh Quorum instruction blocks after npm update
```
