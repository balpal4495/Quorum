import type { OracleResult } from "../shared/types.js"
import type { RiskLevel, CouncilMode, RiskAssessment } from "./types.js"

/**
 * Patterns that trigger risk escalation.
 * Each entry has a level (the minimum risk level it triggers) and a reason label.
 */
const RISK_RULES: Array<{ pattern: RegExp; level: RiskLevel; reason: string }> = [
  // Critical — always run full Council + flag for human architecture review
  { pattern: /\b(auth(?:entication|orization)?|jwt|token|session|password|oauth|credential|bearer)\b/i, level: "critical", reason: "authentication or authorisation logic" },
  { pattern: /\b(payment|stripe|charge|billing|checkout|refund|subscription)\b/i, level: "critical", reason: "payment or billing logic" },
  { pattern: /\b(encrypt|decrypt|private\s+key|certificate|tls|ssl|hmac|cipher)\b/i, level: "critical", reason: "cryptography or key management" },
  { pattern: /\b(delete\s+all|drop\s+table|truncate|wipe|destroy.*data|hard\s+delete)\b/i, level: "critical", reason: "irreversible data deletion" },

  // High — full Council
  { pattern: /\b(migrat(?:ion|e)|alter\s+table|schema\s+change|not\s+null|backfill|pg_repack|shadow\s+column)\b/i, level: "high", reason: "database schema migration" },
  { pattern: /\b(permission|role(?:s)?|acl|rbac|access\s+control|entitlement)\b/i, level: "high", reason: "permissions or access control" },
  { pattern: /\b(pii|personal\s+data|gdpr|ccpa|email(?:\s+address)?|phone(?:\s+number)?|ssn|passport)\b/i, level: "high", reason: "PII or compliance-regulated data" },
  { pattern: /\b(api\s+key|secret(?:s)?|private\s+key|credentials?)\b/i, level: "high", reason: "secrets or credentials handling" },

  // Medium — Jury + lite Council
  { pattern: /\b(cache|redis|memcached|invalidat(?:e|ion))\b/i, level: "medium", reason: "cache strategy" },
  { pattern: /\b(rate\s*limit|throttl(?:e|ing)|quota)\b/i, level: "medium", reason: "rate limiting or throttling" },
  { pattern: /\b(webhook|event|queue|pubsub|kafka|rabbitmq|sns|sqs)\b/i, level: "medium", reason: "async event or messaging" },
  { pattern: /\b(deploy(?:ment)?|ci(?:\/cd)?|docker|kubernetes|infra(?:structure)?)\b/i, level: "medium", reason: "deployment or infrastructure" },
]

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"]

function maxLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b
}

function councilModeForLevel(level: RiskLevel): CouncilMode {
  switch (level) {
    case "low":      return "jury-only"
    case "medium":   return "lite"
    case "high":     return "full"
    case "critical": return "full"
  }
}

/**
 * Classify the risk level of a proposed change from its text and evidence.
 *
 * Risk determines Council mode — avoid running full fan-out on low-risk changes:
 *   low      → jury-only  (no advisor/reviewer fan-out)
 *   medium   → lite       (Jury + 2 reviewers)
 *   high     → full       (standard 5 advisors + 5 reviewers)
 *   critical → full       (same as high, but Chronicle entry flags for human architecture review)
 *
 * Refuted Oracle entries also elevate risk — a known failure mode in the evidence pack
 * means the design is repeating something that already went wrong.
 */
export function classifyRisk(
  outcome: string,
  design: string,
  evidence: OracleResult[],
): RiskAssessment {
  const text = `${outcome} ${design}`
  let level: RiskLevel = "low"
  const reasons: string[] = []

  for (const rule of RISK_RULES) {
    if (rule.pattern.test(text)) {
      const matched = maxLevel(level, rule.level)
      if (matched !== level || !reasons.includes(rule.reason)) {
        level = matched
        reasons.push(rule.reason)
      }
    }
  }

  // Refuted entries in the evidence pack are a direct risk signal
  const refutedCount = evidence.filter(e => e.status === "refuted").length
  if (refutedCount > 0) {
    const refutedRisk: RiskLevel = refutedCount >= 2 ? "high" : "medium"
    if (RISK_ORDER.indexOf(refutedRisk) > RISK_ORDER.indexOf(level)) {
      level = maxLevel(level, refutedRisk)
    }
    reasons.push(`${refutedCount} refuted Chronicle ${refutedCount === 1 ? "entry" : "entries"} in evidence pack`)
  }

  return {
    level,
    reasons: reasons.length > 0 ? reasons : ["no sensitive patterns detected"],
    council_mode: councilModeForLevel(level),
  }
}
