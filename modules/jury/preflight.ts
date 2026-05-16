import type { OracleResult } from "../shared/types.js"
import { entryText } from "../shared/types.js"

/** Areas that warrant elevated scrutiny. */
const SENSITIVE_PATTERNS: Record<string, RegExp> = {
  auth:          /\b(auth(?:entication|orization)?|jwt|token|session|password|oauth|login|logout|credential|bearer)\b/i,
  database:      /\b(migrat(?:ion|e)|alter\s+table|schema\s+change|postgres|mysql|sqlite|prisma|drizzle|knex|sequelize)\b/i,
  crypto:        /\b(encrypt|decrypt|cipher|hash(?:ing)?|hmac|sign(?:ing)?|verify|private\s+key|certificate|tls|ssl)\b/i,
  payments:      /\b(payment|stripe|charge|billing|invoice|subscription|price|checkout|refund)\b/i,
  permissions:   /\b(permission|role(?:s)?|acl|access\s+control|rbac|authorization|entitlement)\b/i,
  pii:           /\b(pii|personal\s+data|gdpr|ccpa|email(?:\s+address)?|phone(?:\s+number)?|postal\s+address|ssn|passport)\b/i,
  data_deletion: /\b(delete(?:\s+all)?|drop\s+table|truncate|purge|wipe|destroy.*data|hard\s+delete)\b/i,
  secrets:       /\b(api\s+key|secret(?:s)?|env(?:ironment)?\s+var(?:iable)?|\.env|private\s+key|credentials?)\b/i,
}

const ROLLBACK_PATTERNS = /\b(rollback|roll\s+back|revert|undo|restore|recovery|fallback|backward[- ]compat)\b/i
const TEST_PATTERNS     = /\b(test(?:ing|s)?|spec(?:ification)?|unit\s+test|integration\s+test|coverage|vitest|jest|mocha)\b/i

export interface PreflightResult {
  touches_sensitive_area: boolean
  /** Which sensitive area categories were detected. */
  sensitive_areas: string[]
  /** Whether the design mentions a rollback or recovery strategy. */
  rollback_mentioned: boolean
  /** Whether the design mentions testing. */
  test_strategy_mentioned: boolean
  /**
   * IDs of refuted Chronicle entries that semantically overlap with the design text.
   * These are potential conflicts — Jury should surface them.
   */
  chronicle_conflicts: string[]
}

/**
 * Static preflight analysis — no LLM required.
 *
 * Runs deterministic checks on the outcome + design text and the evidence pack
 * before any LLM call. Results are injected into the Jury prompt so the LLM
 * reasons over concrete signals rather than discovering them itself.
 */
export function runPreflight(
  outcome: string,
  design: string,
  evidence: OracleResult[],
): PreflightResult {
  const text = `${outcome} ${design}`

  const sensitive_areas = Object.entries(SENSITIVE_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([area]) => area)

  // Refuted entries whose primary text shares at least one significant word with the design
  const designWords = new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 4),
  )

  const chronicle_conflicts = evidence
    .filter(e => {
      if (e.status !== "refuted") return false
      const entryWords = entryText(e)
        .toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 4)
      return entryWords.some(w => designWords.has(w))
    })
    .map(e => e.id)

  return {
    touches_sensitive_area: sensitive_areas.length > 0,
    sensitive_areas,
    rollback_mentioned: ROLLBACK_PATTERNS.test(text),
    test_strategy_mentioned: TEST_PATTERNS.test(text),
    chronicle_conflicts,
  }
}

/** Format preflight result for injection into the Jury prompt. */
export function formatPreflight(preflight: PreflightResult): string {
  const lines: string[] = ["## Deterministic Preflight (machine-checked, not LLM-inferred)"]

  if (preflight.touches_sensitive_area) {
    lines.push(`⚠ Sensitive areas detected: ${preflight.sensitive_areas.join(", ")}`)
  } else {
    lines.push("✓ No sensitive areas detected")
  }

  lines.push(preflight.rollback_mentioned ? "✓ Rollback strategy mentioned" : "✗ No rollback strategy mentioned")
  lines.push(preflight.test_strategy_mentioned ? "✓ Test strategy mentioned" : "✗ No test strategy mentioned")

  if (preflight.chronicle_conflicts.length > 0) {
    lines.push(`⚠ Refuted Chronicle entries potentially conflicting: ${preflight.chronicle_conflicts.join(", ")}`)
    lines.push("  These entries were previously tried and failed — verify the design addresses the documented failure reason.")
  } else {
    lines.push("✓ No conflicting refuted Chronicle entries")
  }

  return lines.join("\n")
}
