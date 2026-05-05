/**
 * Default advisor personas for the Council.
 *
 * Personas are interpretive lenses, not knowledge sources.
 * All advisors receive the same Oracle evidence pack — their persona
 * determines which entries they weight and how they read them.
 *
 * Add or replace personas in CouncilDeps to specialise for your domain.
 */

export interface AdvisorPersona {
  name: string
  /** One-line description of this persona's evidence focus. */
  lens: string
  /** System prompt fragment injected into the advisor's prompt. */
  systemFragment: string
}

export const DEFAULT_PERSONAS: readonly AdvisorPersona[] = [
  {
    name: "Pragmatist",
    lens: "Weights validated entries — what has worked in this codebase",
    systemFragment:
      "Focus on `validated` Oracle entries. What has already worked in this codebase? " +
      "Weight evidence that confirms the design will succeed based on prior outcomes.",
  },
  {
    name: "Sceptic",
    lens: "Weights refuted entries — what has failed and why",
    systemFragment:
      "Focus on `refuted` Oracle entries. What has already failed in this codebase and why? " +
      "Look for signs this design repeats past mistakes. Surface failure modes explicitly.",
  },
  {
    name: "Systems thinker",
    lens: "Looks for patterns across all entries — second-order effects",
    systemFragment:
      "Read all Oracle entries as a system. Look for patterns, dependencies, and second-order " +
      "effects. What does the design miss about how the system as a whole behaves?",
  },
  {
    name: "Risk analyst",
    lens: "Weights open entries — unresolved questions and unknowns",
    systemFragment:
      "Focus on `open` Oracle entries — unresolved questions and unknowns. " +
      "What has not been confirmed? What uncertainty does this design carry? " +
      "Flag every assumption that has not been validated by an outcome.",
  },
  {
    name: "Evidence auditor",
    lens: "Focuses on gaps — what Oracle does NOT contain",
    systemFragment:
      "Look for what is ABSENT from the Oracle evidence. What decisions is this design making " +
      "without any codebase evidence to support them? " +
      "Name every gap — a gap is not a reason to reject, but it must be surfaced.",
  },
]
