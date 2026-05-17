/**
 * quorum bootstrap [--from-git] [--since P90D] [--propose]
 *
 * Cold-start helper: seeds Chronicle with low-trust evidence from the project's
 * own history. Currently supports --from-git (git commit history).
 *
 * Evidence is written to .chronicle/sources/ and .chronicle/evidence/.
 * With --propose, draft proposals are also written to .chronicle/proposals/
 * for review with: quorum commit --list
 */

import { c } from "../shared/colors.js"
import { findChronicleDir } from "../shared/chronicle.js"

function parseArgs(argv) {
  const args = { fromGit: false, since: "P90D", propose: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from-git")          { args.fromGit = true; continue }
    if (argv[i] === "--propose")           { args.propose = true; continue }
    if (argv[i] === "--since" && argv[i + 1]) { args.since = argv[++i]; continue }
    if (argv[i].startsWith("--since="))   { args.since = argv[i].slice(8); continue }
  }
  return args
}

export async function run(argv) {
  const args = parseArgs(argv)

  if (!args.fromGit) {
    console.error(c.red("Usage: quorum bootstrap --from-git [--since P90D] [--propose]"))
    console.error(c.dim(""))
    console.error(c.dim("  --from-git        Bootstrap from git commit history"))
    console.error(c.dim("  --since P90D      ISO 8601 duration (P30D, P6M, P1Y)  [default: P90D]"))
    console.error(c.dim("  --propose         Also stage evidence as Chronicle proposals"))
    process.exit(1)
  }

  const chronicleDir = await findChronicleDir()
  if (!chronicleDir) {
    console.error(c.red("No .chronicle/ directory found. Run quorum init first."))
    process.exit(1)
  }

  console.log(c.bold(`\nBootstrapping Chronicle from git history...`))
  console.log(c.dim(`  since: ${args.since}   propose: ${args.propose}\n`))

  const { run: runIngestGit } = await import("./ingest-git.js")
  const ingestArgs = ["--since", args.since]
  if (args.propose) ingestArgs.push("--propose")
  await runIngestGit(ingestArgs)

  console.log()
  console.log(c.bold("Bootstrap complete."))
  if (!args.propose) {
    console.log(c.dim("\n  Evidence is in .chronicle/evidence/ — low-trust drafts, not yet Chronicle."))
    console.log(c.dim("  Next steps:"))
    console.log(c.dim("    quorum bootstrap --from-git --propose   stage evidence as proposals"))
    console.log(c.dim("    quorum commit --list                     review pending proposals"))
    console.log(c.dim("    quorum commit <id>                       approve a proposal"))
  } else {
    console.log(c.dim("\n  Review and approve proposals:"))
    console.log(c.dim("    quorum commit --list"))
    console.log(c.dim("    quorum commit <id>"))
  }
}
