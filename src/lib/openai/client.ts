import { getOpenAiApiKey, getOpenAiModel, getOpenAiSearchModel } from "./env";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };
type VisionMessage = { role: "system" | "user"; content: string | VisionContentPart[] };
type JsonSchemaFormat = { name: string; strict: true; schema: Record<string, unknown> };

function usesReasoning(model: string) {
  return /^(?:gpt-[5-9]|o[134](?:-|$))/i.test(model);
}

const DEFAULT_JSON_TIMEOUT_MS = 25000;

// The limit includes hidden reasoning, not just the requested JSON text.
function completionBudget(model: string, outputTokens: number) {
  return usesReasoning(model) ? outputTokens + 2048 : outputTokens;
}

async function requestJson<T>(input: {
  messages: Array<ChatMessage | VisionMessage>;
  jsonSchema?: JsonSchemaFormat;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
  timeoutMs?: number;
}): Promise<T | null> {
  const key = getOpenAiApiKey();
  if (!key) return null;
  const model = getOpenAiModel();
  const reasoning = usesReasoning(model);
  const signal = AbortSignal.timeout(input.timeoutMs ?? DEFAULT_JSON_TIMEOUT_MS);
  const body: Record<string, unknown> = {
    model,
    store: false,
    response_format: input.jsonSchema
      ? { type: "json_schema", json_schema: input.jsonSchema }
      : { type: "json_object" },
    messages: input.messages,
    ...(reasoning ? {
      max_completion_tokens: completionBudget(model, input.maxTokens ?? 2000),
      reasoning_effort: input.reasoningEffort ?? "low",
    } : { temperature: input.temperature ?? 0.2, max_tokens: input.maxTokens ?? 2000 }),
  };
  try {
    // At most one targeted retry, sharing the original deadline.
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: { code?: string; param?: string } } | null;
        console.error("OpenAI completion failed", { model, status: response.status, requestId: response.headers.get("x-request-id"), code: error?.error?.code, param: error?.error?.param });
        if (attempt === 0 && response.status === 400 && error?.error?.param === "reasoning_effort") {
          delete body.reasoning_effort;
          continue;
        }
        return null;
      }
      const payload = await response.json() as {
        choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>;
      };
      const choice = payload.choices?.[0];
      if (choice?.message?.refusal || choice?.finish_reason === "content_filter") return null;
      if (choice?.finish_reason === "length") {
        console.error("OpenAI completion truncated", { model, attempt });
        if (attempt === 0) {
          const field = reasoning ? "max_completion_tokens" : "max_tokens";
          body[field] = Number(body[field]) * 2;
          continue;
        }
        return null;
      }
      const parsed = parseJsonObject<T>(choice?.message?.content ?? "");
      if (!parsed) console.error("OpenAI completion returned invalid JSON", { model });
      return parsed;
    }
  } catch (error) {
    // Never log request payloads, credentials, or raw provider error messages.
    console.error("OpenAI completion unavailable", { model, reason: signal.aborted ? "timeout" : error instanceof Error ? error.name : "unknown" });
  }
  return null;
}

export async function completeJsonFromImage<T>(input: {
  instructions: string;
  imageDataUrl: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<T | null> {
  return requestJson<T>({
    temperature: 0.1,
    maxTokens: input.maxTokens ?? 2500,
    timeoutMs: input.timeoutMs ?? 45000,
    messages: [
      { role: "system", content: input.instructions },
      { role: "user", content: [
        { type: "text", text: "Read this reservation screenshot and reply with JSON only." },
        { type: "image_url", image_url: { url: input.imageDataUrl, detail: "high" } },
      ] },
    ],
  });
}

export async function completeJson<T>(input: {
  messages: ChatMessage[];
  jsonSchema?: JsonSchemaFormat;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
  timeoutMs?: number;
}): Promise<T | null> {
  return requestJson<T>(input);
}

/** Returns model-requested function calls. The caller must validate all arguments. */
export async function completeFunctionCalls(input: {
  messages: ChatMessage[];
  tools: Array<{ type: "function"; function: { name: string; description: string;
    parameters: Record<string, unknown> } }>;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<Array<{ name: string; arguments: unknown }> | null> {
  const key = getOpenAiApiKey();
  if (!key) return null;
  const model = getOpenAiModel();
  const reasoning = usesReasoning(model);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, store: false, messages: input.messages, tools: input.tools,
        tool_choice: "auto", parallel_tool_calls: true,
        ...(reasoning ? { max_completion_tokens: completionBudget(model, input.maxTokens ?? 700), reasoning_effort: "low" }
          : { max_tokens: input.maxTokens ?? 700, temperature: 0.1 }) }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 7500),
    });
    if (!response.ok) {
      console.error("OpenAI function calling failed", { model, status: response.status,
        requestId: response.headers.get("x-request-id") });
      return null;
    }
    const payload = await response.json() as { choices?: Array<{ message?: { tool_calls?: Array<{
      type?: string; function?: { name?: string; arguments?: string } }> } }> };
    const calls = payload.choices?.[0]?.message?.tool_calls ?? [];
    return calls.slice(0, 6).flatMap(call => {
      if (call.type !== "function" || !call.function?.name || !call.function.arguments) return [];
      try { return [{ name: call.function.name, arguments: JSON.parse(call.function.arguments) as unknown }]; }
      catch { return []; }
    });
  } catch (error) {
    console.error("OpenAI function calling unavailable", { model,
      reason: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}

function extractOutputText(body: {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
}) {
  if (body.output_text?.trim()) return body.output_text.trim();
  return (body.output ?? []).filter(item => item.type === "message")
    .flatMap(item => item.content ?? [])
    .filter(part => part.type === "output_text" && typeof part.text === "string")
    .map(part => part.text).join("\n").trim();
}

function parseJsonObject<T>(content: string): T | null {
  const trimmed = content.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1").trim();
  try {
    const value: unknown = JSON.parse(trimmed);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as T : null;
  } catch {
    return null;
  }
}

export async function completeJsonWithWebSearch<T>(input: {
  onSources?: (urls: string[]) => void;
  instructions: string;
  payload: unknown;
  maxTokens?: number;
  timeoutMs?: number;
  requireSearch?: boolean;
  searchContextSize?: "low" | "medium" | "high";
}): Promise<T | null> {
  if (!getOpenAiApiKey()) return null;
  const model = getOpenAiSearchModel();
  const body = {
    model,
    store: false,
    tools: [{
      type: "web_search",
      user_location: { type: "approximate", country: "KR" },
      search_context_size: input.searchContextSize ?? "medium",
    }],
    ...(input.requireSearch ? { tool_choice: "required" as const } : {}),
    include: ["web_search_call.action.sources"],
    instructions: `${input.instructions} After searching, reply with one raw JSON object only. No markdown, no headings, no fences. Web search cannot use JSON mode, so wrap the answer yourself.`,
    input: JSON.stringify(input.payload),
    max_output_tokens: completionBudget(model, input.maxTokens ?? 4000),
    ...(usesReasoning(model) ? { reasoning: { effort: "low" } } : {}),
  };

  const deadline = Date.now() + (input.timeoutMs ?? 55000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${getOpenAiApiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs ?? 55000),
    });
    if (!response.ok) {
      console.error("OpenAI web search response failed", { model, status: response.status, requestId: response.headers.get("x-request-id") });
      return null;
    }
    const payload = await response.json() as {
      status?: string;
      output_text?: string;
      output?: Array<{ type?: string; action?: { sources?: Array<{ url?: string }> }; content?: Array<{ type?: string; text?: string; annotations?: Array<{ url?: string }> }> }>;
    };
    if (payload.status === "incomplete" || payload.status === "failed") return null;
    input.onSources?.([...new Set((payload.output ?? []).flatMap(item => [
      ...(item.action?.sources ?? []).map(source => source.url),
      ...(item.content ?? []).flatMap(part => (part.annotations ?? []).map(annotation => annotation.url)),
    ]).filter((url): url is string => typeof url === "string" && /^https?:\/\//.test(url)))]);
    const text = extractOutputText(payload);
    const direct = parseJsonObject<T>(text);
    if (direct) return direct;
    const remainingMs = deadline - Date.now();
    if (!text.trim() || remainingMs <= 0) return null;
    return completeJson<T>({
      timeoutMs: remainingMs,
      temperature: 0,
      maxTokens: input.maxTokens ?? 4000,
      reasoningEffort: "low",
      messages: [
        {
          role: "system",
          content: `Convert the search notes to the JSON schema in the original instructions below. Only copy facts present in the notes. Do not search, add facts, or invent missing values. Preserve the requested top-level shape. Original instructions: ${input.instructions}`,
        },
        { role: "user", content: JSON.stringify({ request: input.payload, notes: text.slice(0, 12000) }) },
      ],
    });
  } catch {
    return null;
  }
}
