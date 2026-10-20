/** Provider identities and supported travel days are part of the API contract. */
export function courseProposalSchema(candidateIds: string[], days: number, selectedCount = 0, proposalCount: 1 | 2 | 3 = selectedCount ? 1 : 3) {
  // A single enum containing >250 long provider IDs can exceed OpenAI's 15k
  // character constraint. Smaller enum branches preserve the exact whitelist.
  const idSchema = candidateIds.length > 250 && candidateIds.join("").length > 15000
    ? { anyOf: Array.from({ length: Math.ceil(candidateIds.length / 250) }, (_, index) =>
      ({ type: "string", enum: candidateIds.slice(index * 250, (index + 1) * 250) })) }
    : { type: "string", enum: candidateIds };
  return {
    name: "date_course_proposals_v3", strict: true as const,
    schema: {
      type: "object", additionalProperties: false, required: ["courses"],
      properties: {
        courses: { type: "array", minItems: 1, maxItems: selectedCount ? 1 : proposalCount, items: {
          type: "object", additionalProperties: false, required: ["theme", "intro", "selected"],
          properties: {
            theme: { type: "string" },
            intro: { type: "string" },
            selected: { type: "array", minItems: Math.max(1, selectedCount), maxItems: candidateIds.length, items: {
              type: "object", additionalProperties: false,
              required: ["id", "day_index", "duration_minutes", "reason", "evidenceIds"],
              properties: {
                id: idSchema,
                day_index: { type: "integer", minimum: 0, maximum: days - 1 },
                duration_minutes: { type: "integer", minimum: 30, maximum: 180 },
                reason: { type: "string" },
                evidenceIds: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
              },
            } },
          },
        } },
      },
    },
  };
}
