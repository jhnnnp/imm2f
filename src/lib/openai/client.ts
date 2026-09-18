import { getOpenAiApiKey, getOpenAiModel } from "./env";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function usesReasoning(model: string) {
  return /^gpt-5/i.test(model);
}

export async function completeJson<T>(input: {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
}): Promise<T | null> {
  const model = getOpenAiModel();
  const reasoning = usesReasoning(model);
  const bodyBase = {
    model,
    response_format: { type: "json_object" as const },
    messages: input.messages,
  };
  const reasoningBody = {
    ...bodyBase,
    max_completion_tokens: input.maxTokens ?? 4000,
    reasoning_effort: input.reasoningEffort ?? "low",
  };
  const classicBody = {
    ...bodyBase,
    temperature: input.temperature ?? 0.2,
    max_tokens: input.maxTokens ?? 2000,
  };

  const parse = async (response: Response) => {
    if (!response.ok) return null;
    const body = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return null;
    try {
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  };

  try {
    const first = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${getOpenAiApiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify(reasoning ? reasoningBody : classicBody),
      signal: AbortSignal.timeout(12000),
    });
    const parsed = await parse(first);
    if (parsed) return parsed;
    if (!reasoning) return null;

    const retry = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${getOpenAiApiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...bodyBase, max_completion_tokens: input.maxTokens ?? 4000 }),
      signal: AbortSignal.timeout(12000),
    });
    return parse(retry);
  } catch {
    return null;
  }
}

function extractOutputText(body: {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
}) {
  if (body.output_text?.trim()) return body.output_text.trim();
  for (const item of body.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.text?.trim()) return part.text.trim();
    }
  }
  return "";
}

function parseJsonObject<T>(content: string): T | null {
  const trimmed = content.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export async function completeJsonWithWebSearch<T>(input: {
  instructions: string;
  payload: unknown;
  maxTokens?: number;
  timeoutMs?: number;
  requireSearch?: boolean;
}): Promise<T | null> {
  const model = getOpenAiModel();
  const body = {
    model,
    tools: [{
      type: "web_search",
      user_location: { type: "approximate", country: "KR" },
      search_context_size: "medium",
    }],
    ...(input.requireSearch ? { tool_choice: "required" as const } : {}),
    include: ["web_search_call.action.sources"],
    instructions: `${input.instructions} After searching, reply with one raw JSON object only. No markdown, no headings, no fences. Web search cannot use JSON mode, so wrap the answer yourself.`,
    input: JSON.stringify(input.payload),
    max_output_tokens: input.maxTokens ?? 4000,
    ...(usesReasoning(model) ? { reasoning: { effort: "low" } } : {}),
  };

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${getOpenAiApiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs ?? 55000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as {
      output_text?: string;
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    };
    const text = extractOutputText(payload);
    const direct = parseJsonObject<T>(text);
    if (direct) return direct;
    if (!text.trim()) return null;
    return completeJson<T>({
      temperature: 0,
      maxTokens: input.maxTokens ?? 4000,
      reasoningEffort: "low",
      messages: [
        {
          role: "system",
          content: "Extract one JSON object from the notes. Copy rating, ratingCount, food, and sourceUrl only when that exact value appears in the notes next to that shop. Never invent a 4.x score, a review count, a menu, or a URL. If a field is not in the notes, omit it. Schema: {\"facts\":[{\"id\":string,\"rating\":number,\"ratingCount\":number,\"food\":string,\"sourceUrl\":string}]} Reply JSON only.",
        },
        { role: "user", content: text.slice(0, 12000) },
      ],
    });
  } catch {
    return null;
  }
}
