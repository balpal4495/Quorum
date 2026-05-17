import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { findChronicleDir } from "../shared/chronicle.js"

// ── helpers ───────────────────────────────────────────────────────────────────

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "quorum-test-"))
}

async function rmrf(dir) {
  await fs.rm(dir, { recursive: true, force: true })
}

// ── findChronicleDir ──────────────────────────────────────────────────────────

describe("findChronicleDir", () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = await makeTmpDir()
  })

  afterEach(async () => {
    await rmrf(tmpDir)
  })

  it("returns the .chronicle path when found directly in startDir", async () => {
    const chronicleDir = path.join(tmpDir, ".chronicle")
    await fs.mkdir(chronicleDir)

    const result = await findChronicleDir(tmpDir)
    expect(result).toBe(chronicleDir)
  })

  it("walks up the tree to find .chronicle in a parent directory", async () => {
    const chronicleDir = path.join(tmpDir, ".chronicle")
    await fs.mkdir(chronicleDir)

    // Nested three levels deep — chronicle lives at root
    const nested = path.join(tmpDir, "src", "components", "ui")
    await fs.mkdir(nested, { recursive: true })

    const result = await findChronicleDir(nested)
    expect(result).toBe(chronicleDir)
  })

  it("returns null when no .chronicle directory exists anywhere in the tree", async () => {
    const nested = path.join(tmpDir, "src", "deep")
    await fs.mkdir(nested, { recursive: true })

    const result = await findChronicleDir(nested)
    expect(result).toBeNull()
  })

  it("ignores a .chronicle file (not a directory)", async () => {
    // .chronicle exists as a file — must not be returned
    await fs.writeFile(path.join(tmpDir, ".chronicle"), "not a dir")

    const result = await findChronicleDir(tmpDir)
    expect(result).toBeNull()
  })

  it("finds the nearest .chronicle when multiple exist in ancestor chain", async () => {
    // Parent has a .chronicle, nested subdir has its own .chronicle
    const parentChronicle = path.join(tmpDir, ".chronicle")
    await fs.mkdir(parentChronicle)

    const subDir = path.join(tmpDir, "sub")
    const subChronicle = path.join(subDir, ".chronicle")
    await fs.mkdir(subDir)
    await fs.mkdir(subChronicle)

    // From inside subDir — should find the closer one
    const result = await findChronicleDir(subDir)
    expect(result).toBe(subChronicle)
  })
})
