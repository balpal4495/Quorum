export function buildBriefPrompt(params: {
  chronicleContext: string
  behaviorContext: string
  area?: string
}): string {
  return `Produce a Compass Brief — a summary of current product direction.

${params.area ? `Focus area: ${params.area}\n` : ""}

## Chronicle evidence (approved project memory)
${params.chronicleContext}

## Current product behaviour
${params.behaviorContext}

Return ONLY valid JSON with this exact schema (no markdown fences, no explanation):
{
  "product_direction": "<one clear sentence describing where the product is pointed>",
  "known_from_chronicle": ["<fact from Chronicle>"],
  "known_from_behavior": ["<fact from code/docs/tests>"],
  "inferred": ["<inference — not stated directly in evidence>"],
  "assumptions": ["<assumption being made>"],
  "unknowns": ["<what is not known — especially user behaviour>"],
  "missing_evidence": ["<what evidence would improve this brief>"],
  "recommended_next_step": "<specific quorum command or action>",
  "confidence": <number 0–1>
}

Rules:
- known_from_chronicle must cite specific decisions, not paraphrase
- unknowns must include "No analytics or support evidence connected" if no user data provided
- confidence reflects how strongly the direction can be stated from available evidence`
}

export function buildPathwaysPrompt(params: {
  goal: string
  horizon?: string
  appetite?: string
  chronicleContext: string
  behaviorContext: string
  area?: string
  limit?: number
}): string {
  return `Generate ${params.limit ?? 5} product pathways toward the following goal.

Goal: ${params.goal}
${params.horizon ? `Horizon: ${params.horizon}` : ""}
${params.appetite ? `Appetite: ${params.appetite}` : ""}
${params.area ? `Focus area: ${params.area}` : ""}

## Chronicle evidence (approved project memory)
${params.chronicleContext}

## Current product behaviour
${params.behaviorContext}

Return ONLY valid JSON with this exact schema (no markdown fences, no explanation):
{
  "pathways": [
    {
      "id": "<slug-id>",
      "kind": "product_pathway",
      "title": "<pathway title>",
      "goal": "<goal this pathway serves>",
      "target_user": "<who this is for>",
      "problem": "<user problem being solved>",
      "current_behaviors": ["<existing behaviour this builds on>"],
      "opportunity": "<what gap or need this addresses>",
      "why_now": "<why this makes sense at this stage>",
      "smallest_useful_version": "<minimum version that validates the idea>",
      "phases": [
        {
          "name": "<phase name>",
          "outcome": "<what this phase delivers>",
          "user_value": "<value to the user>",
          "build_notes": ["<optional implementation note>"],
          "dependencies": ["<dependency>"],
          "risks": ["<risk>"]
        }
      ],
      "dependencies": ["<dependency>"],
      "risks": ["<risk>"],
      "assumptions": ["<assumption — must be present>"],
      "open_questions": ["<unanswered question>"],
      "evidence": [
        {
          "id": "<evidence id>",
          "kind": "chronicle|docs|cli|code|inference|assumption",
          "source": "<source path or label>",
          "summary": "<what this evidence says>",
          "confidence": <0–1>
        }
      ],
      "scores": {
        "strategic_fit": <0–1>,
        "user_problem_clarity": <0–1>,
        "evidence_strength": <0–1>,
        "leverage": <0–1>,
        "feasibility": <0–1>,
        "time_to_signal": <0–1>,
        "reversibility": <0–1>,
        "complexity_penalty": <0–1>,
        "dependency_penalty": <0–1>,
        "contradiction_penalty": <0–1>,
        "evidence_gap_penalty": <0–1>,
        "total": <0–100>
      },
      "confidence": <0–1>,
      "time_to_signal": "<e.g. '1-2 sessions', '2 weeks'>",
      "reversibility": "high|medium|low",
      "suggested_next_step": "<specific actionable next step>"
    }
  ]
}

Rules:
- Every pathway must cite at least one evidence reference
- Reject generic feature ideas — every pathway must build on current behaviour or approved memory
- Compute scores.total using: strategic_fit*20 + user_problem_clarity*15 + evidence_strength*20 + leverage*10 + feasibility*15 + time_to_signal*10 + reversibility*10 - complexity_penalty*10 - dependency_penalty*8 - contradiction_penalty*15 - evidence_gap_penalty*12
- Clamp total to 0–100
- Assumptions must always be present (minimum 1)
- unknowns must note if no user evidence is connected
- Sort by scores.total descending`
}

export function buildBetsPrompt(params: {
  horizon?: string
  goal?: string
  appetite?: string
  chronicleContext: string
  behaviorContext: string
}): string {
  return `Generate 2–3 strategic product bets.

${params.horizon ? `Horizon: ${params.horizon}` : ""}
${params.goal ? `Goal: ${params.goal}` : ""}
${params.appetite ? `Appetite: ${params.appetite}` : ""}

## Chronicle evidence
${params.chronicleContext}

## Current product behaviour
${params.behaviorContext}

Return ONLY valid JSON with this exact schema (no markdown fences):
{
  "bets": [
    {
      "id": "<slug-id>",
      "kind": "product_bet",
      "title": "<bet title>",
      "thesis": "<falsifiable product hypothesis — one sentence>",
      "why_now": "<why this moment>",
      "target_user": "<who>",
      "upside": "<best case>",
      "downside": "<realistic downside>",
      "assumptions": ["<assumption — minimum 2>"],
      "validation_signals": ["<signal that confirms the thesis>"],
      "invalidation_signals": ["<signal that refutes the thesis>"],
      "kill_criteria": ["<when to stop>"],
      "first_experiment": "<smallest first test>",
      "build_path": ["<phase 1>", "<phase 2>"],
      "evidence": [{ "id": "<id>", "kind": "chronicle|inference|docs|cli", "source": "<source>", "summary": "<summary>", "confidence": <0–1> }],
      "scores": {
        "strategic_fit": <0–1>, "user_problem_clarity": <0–1>, "evidence_strength": <0–1>,
        "leverage": <0–1>, "feasibility": <0–1>, "time_to_signal": <0–1>, "reversibility": <0–1>,
        "complexity_penalty": <0–1>, "dependency_penalty": <0–1>, "contradiction_penalty": <0–1>,
        "evidence_gap_penalty": <0–1>, "total": <0–100>
      },
      "confidence": <0–1>,
      "time_to_signal": "<timeframe>",
      "reversibility": "high|medium|low",
      "appetite": "small|medium|large"
    }
  ]
}

Rules:
- A bet is a falsifiable hypothesis, not a feature list
- Kill criteria must be present
- Invalidation signals must be present
- If no user evidence is available, evidence_strength should be ≤ 0.4`
}

export function buildScorePrompt(params: {
  idea: string
  context?: string
  chronicleContext: string
  behaviorContext: string
}): string {
  return `Evaluate this product idea.

Idea: ${params.idea}
${params.context ? `Context: ${params.context}` : ""}

## Chronicle evidence
${params.chronicleContext}

## Current product behaviour
${params.behaviorContext}

Return ONLY valid JSON with this exact schema (no markdown fences):
{
  "idea": "${params.idea}",
  "summary": "<one sentence summary of what this idea is>",
  "recommendation": "pursue|pursue-small-test|investigate-more|defer|avoid",
  "scores": {
    "strategic_fit": <0–1>, "user_problem_clarity": <0–1>, "evidence_strength": <0–1>,
    "leverage": <0–1>, "feasibility": <0–1>, "time_to_signal": <0–1>, "reversibility": <0–1>,
    "complexity_penalty": <0–1>, "dependency_penalty": <0–1>, "contradiction_penalty": <0–1>,
    "evidence_gap_penalty": <0–1>, "total": <0–100>
  },
  "evidence": [{ "id": "<id>", "kind": "<kind>", "source": "<source>", "summary": "<summary>", "confidence": <0–1> }],
  "supporting_reasons": ["<reason this scores well>"],
  "risks": ["<risk>"],
  "assumptions": ["<assumption>"],
  "open_questions": ["<question>"],
  "suggested_next_step": "<specific next action>"
}

Score total = strategic_fit*20 + user_problem_clarity*15 + evidence_strength*20 + leverage*10 + feasibility*15 + time_to_signal*10 + reversibility*10 - complexity_penalty*10 - dependency_penalty*8 - contradiction_penalty*15 - evidence_gap_penalty*12. Clamp 0–100.

Penalise:
- weak or missing evidence
- conflicts with Chronicle decisions
- high infrastructure/hosting/auth burden
- unclear user problem
- long time-to-signal
- low reversibility`
}
