/**
 * quorum ingest-url <url...> [--propose]
 *
 * Fetches one or more URLs and stores each as a low-trust evidence record in
 * .chronicle/sources/ and .chronicle/evidence/.
 *
 * With --propose, each URL is also written to .chronicle/proposals/
 * for review with: quorum commit --list
 *
 * Only http:// and https:// URLs are accepted.
 */

import { createHash, randomUUID } from "crypto"
import { promises as fs } from "fs"
import https from "https"
import http from "http"
import path from "path"
import { c } from "../shared/colors.js"
import { findChronicleDir } from "../shared/chronicle.js"

function parseArgs(argv) {
  const args = { urls: [], propose: false }
  for (const arg of argv) {
    if (arg === "--propose")                                      args.propose = true
    else if (arg.startsWith("http://") || arg.startsWith("https://")) args.urls.push(arg)
    else if (!arg.startsWith("-")) {
      console.warn(c.dim(`  skip: ${arg} (not an http/https URL)`))
    }
  }
  return args
}

/**
 * Validate that a URL uses only http or https — no file://, ftp://, etc.
 */
function validateUrl(raw) {
  let u
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null
  return u
}

/**
 * Fetch a URL, following one redirect, returning raw body as a string.
 * Resolves with the text body or rejects with an Error.
 */
function fetchUrl(url, redirectDepth = 0) {
  if (redirectDepth > 3) return Promise.reject(new Error("Too many redirects"))
  const parsed = validateUrl(url)
  if (!parsed) return Promise.reject(new Error(`Rejected URL scheme: ${url}`))

  return new Promise((resolve, reject) => {
    const protocol = parsed.protocol === "https:" ? https : http
    const req = protocol.get(url, { headers: { "User-Agent": "quorum-ingest/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect — re-validate the Location header
        const location = res.headers.location
        res.resume()
        fetchUrl(location, redirectDepth + 1).then(resolve).catch(reject)
        return
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      const chunks = []
      res.on("data", chunk => chunks.push(chunk))
      res.on("end",  () => resolve(Buffer.concat(chunks).toString("utf8")))
      res.on("error", reject)
    })
    req.on("error", reject)
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error("Request timeout")) })
  })
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000)
}

function extractTitle(html) {
  const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html)
  return m ? m[1].trim().slice(0, 150) : ""
}

function deriveScope(url) {
  try {
    const u = new URL(url)
    const first = u.pathname.split("/").filter(Boolean)[0]
    return ["external", ...(first ? [first.slice(0, 20)] : [])]
  } catch {
    return ["external"]
  }
}

export async function run(argv) {
  const args = parseArgs(argv)
  if (args.urls.length === 0) {
    console.error(c.red("Usage: quorum ingest-url <url...> [--propose]"))
    console.error(c.dim("  Only http:// and https:// URLs are supported."))
    process.exit(1)
  }

  const chronicleDir = await findChronicleDir()
  if (!chronicleDir) {
    console.error(c.red("No .chronicle/ directory found. Run quorum init first."))
    process.exit(1)
  }

  const sourcesDir   = path.join(chronicleDir, "sources")
  const evidenceDir  = path.join(chronicleDir, "evidence")
  const proposalsDir = path.join(chronicleDir, "proposals")
  await fs.mkdir(sourcesDir,  { recursive: true })
  await fs.mkdir(evidenceDir, { recursive: true })
  if (args.propose) await fs.mkdir(proposalsDir, { recursive: true })

  // Load already-ingested URLs to skip duplicates
  const existingRefs = new Set()
  try {
    for (const f of await fs.readdir(sourcesDir)) {
      if (!f.endsWith(".json")) continue
      try {
        const src = JSON.parse(await fs.readFile(path.join(sourcesDir, f), "utf8"))
        if (src.type === "url" && src.ref) existingRefs.add(src.ref)
      } catch { /* skip malformed */ }
    }
  } catch { /* no sources yet */ }

  let ingested = 0, skipped = 0, proposed = 0
  const now = new Date().toISOString()
  console.log(c.bold(`\nIngesting ${args.urls.length} URL(s)...\n`))

  for (const url of args.urls) {
    if (existingRefs.has(url)) {
      skipped++
      console.log(c.dim(`  ≡ skip  ${url} (already ingested)`))
      continue
    }

    let rawHtml
    try {
      rawHtml = await fetchUrl(url)
    } catch (err) {
      console.warn(c.red(`  ✗ error  ${url} — ${err.message}`))
      continue
    }

    const title    = extractTitle(rawHtml) || url
    const text     = stripHtml(rawHtml)
    const hashKey  = `sha256:${createHash("sha256").update(text).digest("hex")}`
    const scope    = deriveScope(url)
    const summary  = `${title} — ${text.slice(0, 120)}`
    const sourceId   = randomUUID()
    const evidenceId = randomUUID()

    const sourceRecord = {
      id: sourceId,
      type: "url",
      ref: url,
      ingested_at: now,
      content_hash: hashKey,
      metadata: { title, content_length: text.length },
    }
    await fs.writeFile(
      path.join(sourcesDir, `${sourceId}.json`),
      JSON.stringify(sourceRecord, null, 2),
    )
    existingRefs.add(url)

    const evidenceRecord = {
      id: evidenceId,
      source_id: sourceId,
      schema_version: 2,
      topic: `url: ${title.slice(0, 80)}`,
      key_insight: summary.slice(0, 150),
      decision: summary.slice(0, 150),
      affected_areas: [url],
      scope,
      alternatives_considered: [],
      rejected_reason: [],
      status: "open",
      confidence: 0.4,
      source_quality: "metadata-derived",
      needs_human_summary: true,
      source_module: "ingest-url",
      work_ref: { type: "url", ref: url },
      ingested_at: now,
    }
    await fs.writeFile(
      path.join(evidenceDir, `${evidenceId}.json`),
      JSON.stringify(evidenceRecord, null, 2),
    )

    if (args.propose) {
      const proposalId = randomUUID()
      const { id: _id, ingested_at: _ts, ...proposalBody } = evidenceRecord
      await fs.writeFile(
        path.join(proposalsDir, `${proposalId}.json`),
        JSON.stringify(proposalBody, null, 2),
      )
      proposed++
      console.log(c.green(`  ✓ propose  ${url}`))
    } else {
      console.log(c.green(`  ✓ ingest   ${url}`))
    }
    ingested++
  }

  const suffix = args.propose ? `  ${proposed} proposed` : ""
  console.log(`\n${c.bold("Done.")}  ${ingested} ingested  ${skipped} already ingested${suffix}`)
  if (ingested > 0 && !args.propose) {
    console.log(c.dim(`\n  Evidence in .chronicle/evidence/`))
    console.log(c.dim(`  Re-run with --propose to stage as Chronicle proposals.`))
  } else if (proposed > 0) {
    console.log(c.dim(`\n  Review proposals:  quorum commit --list`))
  }
}
