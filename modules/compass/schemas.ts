import { z } from "zod"

export const CompassEvidenceRefSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "chronicle", "advisor", "sentinel", "code", "docs", "tests",
    "config", "cli", "package", "issue", "analytics", "support",
    "inference", "assumption", "unknown",
  ]),
  source: z.string(),
  path: z.string().optional(),
  line: z.number().optional(),
  entry_id: z.string().optional(),
  summary: z.string().min(1),
  quote: z.string().optional(),
  confidence: z.number().min(0).max(1),
})

export const ProductScoreBreakdownSchema = z.object({
  strategic_fit:         z.number().min(0).max(1),
  user_problem_clarity:  z.number().min(0).max(1),
  evidence_strength:     z.number().min(0).max(1),
  leverage:              z.number().min(0).max(1),
  feasibility:           z.number().min(0).max(1),
  time_to_signal:        z.number().min(0).max(1),
  reversibility:         z.number().min(0).max(1),
  complexity_penalty:    z.number().min(0).max(1),
  dependency_penalty:    z.number().min(0).max(1),
  contradiction_penalty: z.number().min(0).max(1),
  evidence_gap_penalty:  z.number().min(0).max(1),
  total:                 z.number().min(0).max(100),
})

export const ProductPathwayPhaseSchema = z.object({
  name:         z.string().min(1),
  outcome:      z.string().min(1),
  user_value:   z.string().min(1),
  build_notes:  z.array(z.string()).optional(),
  dependencies: z.array(z.string()),
  risks:        z.array(z.string()),
})

export const ProductPathwaySchema = z.object({
  id:                    z.string(),
  kind:                  z.literal("product_pathway"),
  title:                 z.string().min(1),
  goal:                  z.string().min(1),
  target_user:           z.string().optional(),
  problem:               z.string().optional(),
  current_behaviors:     z.array(z.string()).min(1),
  opportunity:           z.string().min(1),
  why_now:               z.string().min(1),
  smallest_useful_version: z.string().min(1),
  phases:                z.array(ProductPathwayPhaseSchema),
  dependencies:          z.array(z.string()),
  risks:                 z.array(z.string()),
  assumptions:           z.array(z.string()).min(1),
  open_questions:        z.array(z.string()),
  evidence:              z.array(CompassEvidenceRefSchema).min(1),
  scores:                ProductScoreBreakdownSchema,
  confidence:            z.number().min(0).max(1),
  time_to_signal:        z.string().min(1),
  reversibility:         z.enum(["high", "medium", "low"]),
  suggested_next_step:   z.string().min(1),
})

export const ProductBetSchema = z.object({
  id:                   z.string(),
  kind:                 z.literal("product_bet"),
  title:                z.string().min(1),
  thesis:               z.string().min(1),
  why_now:              z.string().min(1),
  target_user:          z.string().optional(),
  upside:               z.string().min(1),
  downside:             z.string().min(1),
  assumptions:          z.array(z.string()).min(1),
  validation_signals:   z.array(z.string()).min(1),
  invalidation_signals: z.array(z.string()).min(1),
  kill_criteria:        z.array(z.string()).min(1),
  first_experiment:     z.string().min(1),
  build_path:           z.array(z.string()),
  evidence:             z.array(CompassEvidenceRefSchema).min(1),
  scores:               ProductScoreBreakdownSchema,
  confidence:           z.number().min(0).max(1),
  time_to_signal:       z.string().min(1),
  reversibility:        z.enum(["high", "medium", "low"]),
  appetite:             z.enum(["small", "medium", "large"]),
})

export const ProductIdeaScoreSchema = z.object({
  idea:               z.string().min(1),
  summary:            z.string().min(1),
  recommendation:     z.enum(["pursue", "pursue-small-test", "investigate-more", "defer", "avoid"]),
  scores:             ProductScoreBreakdownSchema,
  evidence:           z.array(CompassEvidenceRefSchema),
  supporting_reasons: z.array(z.string()),
  risks:              z.array(z.string()),
  assumptions:        z.array(z.string()),
  open_questions:     z.array(z.string()),
  suggested_next_step: z.string().min(1),
})

export const CompassBriefLLMSchema = z.object({
  product_direction:        z.string().min(1),
  known_from_chronicle:     z.array(z.string()),
  known_from_behavior:      z.array(z.string()),
  inferred:                 z.array(z.string()),
  assumptions:              z.array(z.string()),
  unknowns:                 z.array(z.string()),
  missing_evidence:         z.array(z.string()),
  recommended_next_step:    z.string().min(1),
  confidence:               z.number().min(0).max(1),
})

export const PathwaysLLMSchema = z.object({
  pathways: z.array(ProductPathwaySchema),
})

export const BetsLLMSchema = z.object({
  bets: z.array(ProductBetSchema),
})
