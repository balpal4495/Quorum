import { z } from "zod"

/**
 * Zod schema for the Jury's structured LLM output.
 * evaluate() validates all LLM responses against this before returning.
 */
export const JuryOutputSchema = z.object({
  confidence: z.number().min(0).max(1),
  assessment: z.string().min(1),
  gaps: z.array(z.string()),
  council_brief: z.enum(["challenge", "pressure-test"]),
  recommendation: z.enum(["proceed", "investigate-more", "redesign"]),
})

export type JuryOutputParsed = z.infer<typeof JuryOutputSchema>
