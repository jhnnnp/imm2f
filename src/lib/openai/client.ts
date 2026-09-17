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

  const first = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${getOpenAiApiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(reasoning ? reasoningBody : classicBody),
  });
  const parsed = await parse(first);
  if (parsed) return parsed;
  if (!reasoning) return null;

  const retry = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${getOpenAiApiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...bodyBase, max_completion_tokens: input.maxTokens ?? 4000 }),
  });
  return parse(retry);
}
