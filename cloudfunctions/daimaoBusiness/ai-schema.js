module.exports = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "public_update_draft",
    "detected_events",
    "detected_tasks",
    "user_observations",
    "profile_memory_candidates"
  ],
  properties: {
    summary: { type: "string", maxLength: 2000 },
    public_update_draft: {
      type: "object",
      additionalProperties: false,
      required: ["title", "content", "suggested_visibility", "confidence"],
      properties: {
        title: { type: "string", maxLength: 180 },
        content: { type: "string", maxLength: 5000 },
        suggested_visibility: { enum: ["public", "project_members"] },
        confidence: { type: "number", minimum: 0, maximum: 1 }
      }
    },
    detected_events: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "time_text", "normalized_time", "timezone", "participants", "source_quote", "confidence", "needs_confirmation"],
        properties: {
          type: { enum: ["meeting", "followup", "milestone"] },
          title: { type: "string", maxLength: 180 },
          time_text: { type: "string", maxLength: 160 },
          normalized_time: { type: ["string", "null"], maxLength: 64 },
          timezone: { const: "Asia/Shanghai" },
          participants: { type: "array", items: { type: "string" }, maxItems: 50 },
          source_quote: { type: "string", minLength: 1, maxLength: 1000 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          needs_confirmation: { const: true }
        }
      }
    },
    detected_tasks: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "assignee", "deadline_text", "normalized_deadline", "source_quote", "confidence", "needs_confirmation"],
        properties: {
          title: { type: "string", maxLength: 180 },
          assignee: { type: ["string", "null"], maxLength: 128 },
          deadline_text: { type: "string", maxLength: 160 },
          normalized_deadline: { type: ["string", "null"], maxLength: 64 },
          source_quote: { type: "string", minLength: 1, maxLength: 1000 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          needs_confirmation: { const: true }
        }
      }
    },
    user_observations: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["user_id", "content", "source_type", "evidence_level", "confidence", "source_quote"],
        properties: {
          user_id: { type: "string" },
          content: { type: "string", maxLength: 1000 },
          source_type: { const: "project_record" },
          evidence_level: { const: "conversation_observed" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          source_quote: { type: "string", minLength: 1, maxLength: 1000 }
        }
      }
    },
    profile_memory_candidates: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["user_id", "content", "memory_type", "source_type", "confidence", "source_quote"],
        properties: {
          user_id: { type: "string" },
          content: { type: "string", maxLength: 1000 },
          memory_type: {
            enum: ["preference", "ability_claim", "resource_claim", "project_interest", "collaboration_style", "platform_observation", "project_experience"]
          },
          source_type: { const: "project_record" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          source_quote: { type: "string", minLength: 1, maxLength: 1000 }
        }
      }
    }
  }
};
