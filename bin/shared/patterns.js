/**
 * Mirrors modules/jury/preflight.ts (SENSITIVE_PATTERNS, ROLLBACK_PATTERN, TEST_PATTERN)
 * and modules/council/risk.ts (RISK_RULES).
 * Keep these in sync when modifying those files.
 */

export const SENSITIVE_PATTERNS = {
  auth:          /\b(auth(?:entication|orization)?|jwt|token|session|password|oauth|login|logout|credential|bearer)\b/i,
  database:      /\b(migrat(?:ion|e)|alter\s+table|schema\s+change|postgres|mysql|sqlite|prisma|drizzle|knex|sequelize)\b/i,
  crypto:        /\b(encrypt|decrypt|cipher|hash(?:ing)?|hmac|sign(?:ing)?|verify|private\s+key|certificate|tls|ssl)\b/i,
  payments:      /\b(payment|stripe|charge|billing|invoice|subscription|price|checkout|refund)\b/i,
  permissions:   /\b(permission|role(?:s)?|acl|access\s+control|rbac|authorization|entitlement)\b/i,
  pii:           /\b(pii|personal\s+data|gdpr|ccpa|email(?:\s+address)?|phone(?:\s+number)?|postal\s+address|ssn|passport)\b/i,
  data_deletion: /\b(delete(?:\s+all)?|drop\s+table|truncate|purge|wipe|destroy.*data|hard\s+delete)\b/i,
  secrets:       /\b(api\s+key|secret(?:s)?|env(?:ironment)?\s+var(?:iable)?|\.env|private\s+key|credentials?)\b/i,
}

export const ROLLBACK_PATTERN = /\b(rollback|roll\s+back|revert|undo|restore|recovery|fallback|backward[- ]compat)\b/i
export const TEST_PATTERN     = /\b(test(?:ing|s)?|spec(?:ification)?|unit\s+test|integration\s+test|coverage|vitest|jest|mocha)\b/i

const RISK_RULES = [
  // Critical
  { pattern: /\b(auth(?:entication|orization)?|jwt|token|session|password|oauth|credential|bearer)\b/i, level: "critical", reason: "authentication or authorisation logic" },
  { pattern: /\b(payment|stripe|charge|billing|checkout|refund|subscription)\b/i,                       level: "critical", reason: "payment or billing logic" },
  { pattern: /\b(encrypt|decrypt|private\s+key|certificate|tls|ssl|hmac|cipher)\b/i,                   level: "critical", reason: "cryptography or key management" },
  { pattern: /\b(delete\s+all|drop\s+table|truncate|wipe|destroy.*data|hard\s+delete)\b/i,             level: "critical", reason: "irreversible data deletion" },
  // High
  { pattern: /\b(migrat(?:ion|e)|alter\s+table|schema\s+change|not\s+null|backfill|pg_repack|shadow\s+column)\b/i, level: "high", reason: "database schema migration" },
  { pattern: /\b(permission|role(?:s)?|acl|rbac|access\s+control|entitlement)\b/i,                     level: "high", reason: "permissions or access control" },
  { pattern: /\b(pii|personal\s+data|gdpr|ccpa|email(?:\s+address)?|phone(?:\s+number)?|ssn|passport)\b/i, level: "high", reason: "PII or compliance-regulated data" },
  { pattern: /\b(api\s+key|secret(?:s)?|private\s+key|credentials?)\b/i,                               level: "high", reason: "secrets or credentials handling" },
  // Medium
  { pattern: /\b(cache|redis|memcached|invalidat(?:e|ion))\b/i,                                         level: "medium", reason: "cache strategy" },
  { pattern: /\b(rate\s*limit|throttl(?:e|ing)|quota)\b/i,                                             level: "medium", reason: "rate limiting or throttling" },
  { pattern: /\b(webhook|event|queue|pubsub|kafka|rabbitmq|sns|sqs)\b/i,                               level: "medium", reason: "async event or messaging" },
  { pattern: /\b(deploy(?:ment)?|ci(?:\/cd)?|docker|kubernetes|infra(?:structure)?)\b/i,               level: "medium", reason: "deployment or infrastructure" },
]

const RISK_ORDER = ["low", "medium", "high", "critical"]

function maxLevel(a, b) {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b
}

export function runPreflight(outcome, design) {
  const text = `${outcome} ${design}`
  const sensitive_areas = Object.entries(SENSITIVE_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([area]) => area)
  return {
    touches_sensitive_area: sensitive_areas.length > 0,
    sensitive_areas,
    rollback_mentioned:      ROLLBACK_PATTERN.test(text),
    test_strategy_mentioned: TEST_PATTERN.test(text),
  }
}

export function classifyRisk(outcome, design, refutedCount = 0) {
  const text = `${outcome} ${design}`
  let level = "low"
  const reasons = []

  for (const rule of RISK_RULES) {
    if (rule.pattern.test(text)) {
      const prev = level
      level = maxLevel(level, rule.level)
      if (!reasons.includes(rule.reason)) reasons.push(rule.reason)
      void prev
    }
  }

  if (refutedCount > 0) {
    const refutedRisk = refutedCount >= 2 ? "high" : "medium"
    level = maxLevel(level, refutedRisk)
    reasons.push(`${refutedCount} refuted Chronicle ${refutedCount === 1 ? "entry" : "entries"} in evidence pack`)
  }

  return {
    level,
    reasons: reasons.length > 0 ? reasons : ["no sensitive patterns detected"],
    council_mode: level === "low" ? "jury-only" : level === "medium" ? "lite" : "full",
  }
}
