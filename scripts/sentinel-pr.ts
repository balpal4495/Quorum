/**
 * Called by the sentinel-pr GitHub Actions workflow.
 * Reads changed files from stdin (one per line) or from the first CLI argument
 * (newline-separated), generates the PR knowledge map, and writes it to
 * sentinel-report.md for the workflow to post as a PR comment.
 */
import { writeFile } from "fs/promises"
import { reviewContext } from "../modules/sentinel/review.js"

const raw = process.argv[2] ?? ""
const changedFiles = raw
  .split(/[\n,]+/)
  .map(f => f.trim())
  .filter(Boolean)

const report = await reviewContext(changedFiles, ".chronicle")
await writeFile("sentinel-report.md", report, "utf8")
console.log(`Sentinel: reviewed ${changedFiles.length} changed file(s)`)
