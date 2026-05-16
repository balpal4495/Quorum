import { randomUUID } from "crypto"
import type { LLMProvider } from "../shared/types.js"
import type {
  Compass, CreateCompassOptions,
  CompassBrief, CompassBriefInput,
  BehaviorMap, BehaviorMapInput,
  BehaviorAnswer, BehaviorQuestionInput,
  ProductOpportunity, OpportunitiesInput,
  ProductPathway, PathwaysInput,
  ProductBet, BigBetsInput,
  ProductIdeaScore, ScoreIdeaInput,
  ProductBrief, ProductBriefInput,
  CompassProposalInput, CompassProposalResult,
  CompassOutcomeInput, CompassOutcomeResultPayload,
} from "./types.js"
import { defaultSources } from "./sources/index.js"
import { collectBearings, collectTerrain, formatBearingsForPrompt, formatTerrainForPrompt } from "./evidence/collect.js"
import { mapBehaviorsFromFindings, summarizeBehaviorMap } from "./behavior.js"
import { computeScore, scoreToRecommendation, explainScore } from "./score.js"
import { stageProposal, stageOutcome } from "./propose.js"
import { COMPASS_SYSTEM_PROMPT } from "./prompts/system.js"
import {
  buildBriefPrompt, buildPathwaysPrompt,
  buildBetsPrompt, buildScorePrompt,
} from "./prompts/index.js"
import {
  CompassBriefLLMSchema, PathwaysLLMSchema,
  BetsLLMSchema, ProductIdeaScoreSchema,
} from "./schemas.js"

function parseLLMJson(raw: string): unknown {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim()
  return JSON.parse(cleaned)
}

async function callLLM(
  llm: LLMProvider | undefined,
  userPrompt: string,
  model?: string,
): Promise<string> {
  if (!llm) throw new Error("Compass: LLM provider is required for this command. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or pass llm to setup().")
  return llm(
    [
      { role: "system" as const, content: COMPASS_SYSTEM_PROMPT },
      { role: "user" as const, content: userPrompt },
    ],
    model,
  )
}

export function createCompass(options: CreateCompassOptions): Compass {
  const {
    oracle,
    llm,
    rootDir = process.cwd(),
    chronicleDir = ".chronicle",
    sources = defaultSources(),
    models = {},
    minimumEvidence = "balanced",
  } = options

  // ── Shared context helpers ─────────────────────────────────────────────────

  async function getContext(area?: string) {
    const [bearings, terrain] = await Promise.all([
      collectBearings(oracle, area),
      collectTerrain(sources, rootDir, area),
    ])
    const chronicleContext = formatBearingsForPrompt(bearings)
    const behaviorContext = formatTerrainForPrompt(terrain.findings)
    const behaviorMap = mapBehaviorsFromFindings(terrain.findings, { area })
    return { bearings, terrain, chronicleContext, behaviorContext, behaviorMap }
  }

  // ── brief ──────────────────────────────────────────────────────────────────

  async function brief(input?: CompassBriefInput): Promise<CompassBrief> {
    const { chronicleContext, behaviorContext, terrain, behaviorMap } = await getContext(input?.area)

    if (!llm) {
      // Deterministic fallback
      return {
        generated_at: new Date().toISOString(),
        area: input?.area,
        product_direction: "Unable to synthesize direction — no LLM configured. See Chronicle and behaviour map for raw evidence.",
        known_from_chronicle: [],
        known_from_behavior: behaviorMap.behaviors.slice(0, 5).map(b => b.current_behavior),
        inferred: [],
        assumptions: [],
        unknowns: ["LLM not configured — full synthesis unavailable."],
        opportunities: [],
        missing_evidence: ["LLM provider required for synthesis"],
        recommended_next_step: "Run: quorum advisor brief",
        confidence: 0.4,
      }
    }

    const raw = await callLLM(llm, buildBriefPrompt({ chronicleContext, behaviorContext, area: input?.area }), models.brief)
    let parsed: unknown
    try { parsed = parseLLMJson(raw) } catch {
      throw new Error(`Compass brief: LLM returned non-JSON. Raw (first 300): ${raw.slice(0, 300)}`)
    }

    const result = CompassBriefLLMSchema.safeParse(parsed)
    if (!result.success) throw new Error(`Compass brief: LLM output failed validation: ${JSON.stringify(result.error.issues)}`)

    const d = result.data
    // Build opportunity items from behavior map gaps
    const opportunities: ProductOpportunity[] = behaviorMap.gaps.slice(0, 3).map((g, i) => ({
      id: `opp-gap-${i}`,
      title: g.gap,
      area: g.area,
      why_it_matters: g.why_it_matters,
      evidence_strength: "inferred" as const,
      suggested_next_step: "Run: quorum compass map",
      evidence: g.evidence,
      confidence: g.confidence,
    }))

    return {
      generated_at: new Date().toISOString(),
      area: input?.area,
      ...d,
      opportunities,
    }
  }

  // ── mapBehaviors ────────────────────────────────────────────────────────────

  async function mapBehaviors(input?: BehaviorMapInput): Promise<BehaviorMap> {
    const terrain = await collectTerrain(sources, rootDir, input?.area)
    return mapBehaviorsFromFindings(terrain.findings, input)
  }

  // ── behavior (single question) ──────────────────────────────────────────────

  async function behavior(input: BehaviorQuestionInput): Promise<BehaviorAnswer> {
    const terrain = await collectTerrain(sources, rootDir, input.area)
    const map = mapBehaviorsFromFindings(terrain.findings, { area: input.area })

    const relevant = terrain.findings.filter(f =>
      f.summary.toLowerCase().includes(input.question.toLowerCase().split(" ").slice(0, 3).join(" ")) ||
      f.tags.some(t => input.question.toLowerCase().includes(t)),
    ).slice(0, 10)

    if (!llm || input.deterministic) {
      // Deterministic answer from behaviour map
      const what_exists = map.behaviors.slice(0, 6).map(b => b.current_behavior)
      const what_missing = map.gaps.slice(0, 4).map(g => g.gap)
      return {
        question: input.question,
        what_exists,
        what_appears_missing: what_missing,
        product_implication: map.gaps.length > 0
          ? `The area has ${map.behaviors.length} documented behaviours but ${map.gaps.length} notable gaps.`
          : `The area appears well-covered with ${map.behaviors.length} documented behaviours.`,
        evidence: relevant.map(f => ({ id: f.id, kind: f.kind, source: f.source, path: f.path, summary: f.summary, confidence: f.confidence })),
        confidence: map.confidence,
      }
    }

    // LLM-backed synthesis
    const contextLines = [
      "## Behaviours found",
      ...map.behaviors.slice(0, 10).map(b => `  ✓ ${b.current_behavior}`),
      "## Gaps found",
      ...map.gaps.slice(0, 5).map(g => `  ? ${g.gap}`),
    ].join("\n")

    const prompt = `Answer this product-behaviour question by combining repo evidence with known behaviours.

Question: ${input.question}

${contextLines}

Return JSON:
{
  "question": "${input.question}",
  "what_exists": ["<existing behaviour>"],
  "what_appears_missing": ["<missing capability>"],
  "product_implication": "<one sentence product implication>",
  "evidence": [{ "id": "<id>", "kind": "<kind>", "source": "<source>", "summary": "<summary>", "confidence": <0–1> }],
  "confidence": <0–1>
}`

    const raw = await callLLM(llm, prompt, models.brief)
    try {
      const parsed = parseLLMJson(raw) as BehaviorAnswer
      return { ...parsed, question: input.question }
    } catch {
      // Fall back to deterministic
      return behavior({ ...input, deterministic: true })
    }
  }

  // ── opportunities ───────────────────────────────────────────────────────────

  async function opportunities(input?: OpportunitiesInput): Promise<ProductOpportunity[]> {
    const terrain = await collectTerrain(sources, rootDir, input?.area)
    const map = mapBehaviorsFromFindings(terrain.findings, { area: input?.area })

    const opps: ProductOpportunity[] = map.gaps.map((g, i) => ({
      id: `opp-${i}`,
      title: g.gap,
      area: g.area,
      why_it_matters: g.why_it_matters,
      evidence_strength: g.confidence >= 0.7 ? "strong" as const
        : g.confidence >= 0.5 ? "medium" as const
        : "inferred" as const,
      suggested_next_step: `quorum compass pathways --goal "${g.gap.slice(0, 50)}"`,
      evidence: g.evidence,
      confidence: g.confidence,
    }))

    const limited = input?.limit ? opps.slice(0, input.limit) : opps
    return input?.goal
      ? limited.filter(o => o.title.toLowerCase().includes(input.goal!.toLowerCase()) || o.area.toLowerCase().includes(input.goal!.toLowerCase()))
      : limited
  }

  // ── pathways ────────────────────────────────────────────────────────────────

  async function pathways(input: PathwaysInput): Promise<ProductPathway[]> {
    const { chronicleContext, behaviorContext } = await getContext(input.area)
    const raw = await callLLM(
      llm,
      buildPathwaysPrompt({ ...input, chronicleContext, behaviorContext, limit: input.limit ?? 5 }),
      models.pathways,
    )

    let parsed: unknown
    try { parsed = parseLLMJson(raw) } catch {
      throw new Error(`Compass pathways: LLM returned non-JSON. Raw (first 300): ${raw.slice(0, 300)}`)
    }
    const result = PathwaysLLMSchema.safeParse(parsed)
    if (!result.success) throw new Error(`Compass pathways: LLM output failed validation: ${JSON.stringify(result.error.issues)}`)

    // Recompute scores deterministically
    return result.data.pathways.map(p => ({
      ...p,
      scores: computeScore(p.scores),
    }))
  }

  // ── bigBets ─────────────────────────────────────────────────────────────────

  async function bigBets(input: BigBetsInput): Promise<ProductBet[]> {
    const { chronicleContext, behaviorContext } = await getContext()
    const raw = await callLLM(
      llm,
      buildBetsPrompt({ ...input, chronicleContext, behaviorContext }),
      models.bets,
    )

    let parsed: unknown
    try { parsed = parseLLMJson(raw) } catch {
      throw new Error(`Compass bets: LLM returned non-JSON. Raw (first 300): ${raw.slice(0, 300)}`)
    }
    const result = BetsLLMSchema.safeParse(parsed)
    if (!result.success) throw new Error(`Compass bets: LLM output failed validation: ${JSON.stringify(result.error.issues)}`)

    return result.data.bets.map(b => ({
      ...b,
      scores: computeScore(b.scores),
    }))
  }

  // ── scoreIdea ───────────────────────────────────────────────────────────────

  async function scoreIdea(input: ScoreIdeaInput): Promise<ProductIdeaScore> {
    const { chronicleContext, behaviorContext } = await getContext()
    const raw = await callLLM(
      llm,
      buildScorePrompt({ ...input, chronicleContext, behaviorContext }),
      models.score,
    )

    let parsed: unknown
    try { parsed = parseLLMJson(raw) } catch {
      throw new Error(`Compass score: LLM returned non-JSON. Raw (first 300): ${raw.slice(0, 300)}`)
    }
    const result = ProductIdeaScoreSchema.safeParse(parsed)
    if (!result.success) throw new Error(`Compass score: LLM output failed validation: ${JSON.stringify(result.error.issues)}`)

    const d = result.data
    return {
      ...d,
      scores: computeScore(d.scores),
      recommendation: scoreToRecommendation(d.scores.total),
    }
  }

  // ── productBrief ─────────────────────────────────────────────────────────────

  async function productBrief(input: ProductBriefInput): Promise<ProductBrief> {
    const { chronicleContext, behaviorContext, terrain } = await getContext()

    const prompt = `Generate a product brief for implementation planning.

Title: ${input.title}
${input.idea ? `Idea: ${input.idea}` : ""}
${input.context ? `Context: ${input.context}` : ""}

## Chronicle evidence
${chronicleContext}

## Current behaviour
${behaviorContext}

Return JSON:
{
  "title": "${input.title}",
  "problem": "<problem being solved>",
  "target_user": "<who>",
  "current_behavior": ["<relevant current behaviour>"],
  "product_opportunity": "<gap or need>",
  "recommended_solution": "<recommended approach>",
  "smallest_useful_version": "<minimum useful version>",
  "non_goals": ["<explicit non-goal>"],
  "user_flow": ["<step in user flow>"],
  "implementation_notes": ["<implementation note>"],
  "dependencies": ["<dependency>"],
  "risks": ["<risk>"],
  "open_questions": ["<open question>"],
  "assumptions": ["<assumption>"],
  "validation_signals": ["<signal>"],
  "invalidation_signals": ["<signal>"],
  "evidence": [{ "id": "<id>", "kind": "<kind>", "source": "<source>", "summary": "<summary>", "confidence": <0–1> }],
  "suggested_quorum_checks": ["<quorum check command>"]
}`

    const raw = await callLLM(llm, prompt, models.brief)
    try {
      const parsed = parseLLMJson(raw) as ProductBrief
      return parsed
    } catch {
      throw new Error(`Compass productBrief: LLM returned non-JSON. Raw (first 300): ${raw.slice(0, 300)}`)
    }
  }

  // ── propose ──────────────────────────────────────────────────────────────────

  async function propose(input: CompassProposalInput): Promise<CompassProposalResult> {
    return stageProposal(input, oracle)
  }

  // ── outcome ──────────────────────────────────────────────────────────────────

  async function outcome(input: CompassOutcomeInput): Promise<CompassOutcomeResultPayload> {
    return stageOutcome(input, oracle)
  }

  return {
    brief,
    mapBehaviors,
    behavior,
    opportunities,
    pathways,
    bigBets,
    scoreIdea,
    productBrief,
    propose,
    outcome,
  }
}
