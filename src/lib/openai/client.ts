import "server-only";
import { getOpenAiApiKey, getOpenAiModel, getOpenAiSearchModel } from "./env";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };
type VisionMessage = { role: "system" | "user"; content: string | VisionContentPart[] };
type JsonSchemaFormat = { name: string; strict: true; schema: Record<string, unknown> };
type FunctionTool = { type: "function"; function: { name: string; description: string;
  parameters: Record<string, unknown>; strict?: boolean } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createDeadline(timeoutMs: number | undefined, fallback: number) {
  const duration = timeoutMs ?? fallback;
  return Number.isSafeInteger(duration) && duration > 0 && duration <= 4294967295
    ? AbortSignal.timeout(duration) : null;
}

/** Bound both the request and body read, even if a transport ignores abort. */
function withinDeadline<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function fetchPayload(endpoint: string, key: string, body: Record<string, unknown>, signal: AbortSignal) {
  return withinDeadline(signal, async () => {
    const response = await fetch(`https://api.openai.com/v1/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    signal.throwIfAborted();
    return { response, payload };
  });
}

function rejectsReasoningEffort(response: Response, payload: unknown) {
  return response.status === 400 && isRecord(payload) && isRecord(payload.error)
    && payload.error.param === "reasoning_effort";
}

function firstChoice(payload: unknown) {
  if (!isRecord(payload) || payload.error != null || !Array.isArray(payload.choices)) return null;
  return isRecord(payload.choices[0]) ? payload.choices[0] : null;
}

function usesReasoning(model: string) {
  const gptGeneration = /^gpt-(\d+)(?:[.-]|$)/i.exec(model)?.[1];
  return Boolean(gptGeneration && Number(gptGeneration) >= 5) || /^o[134](?:-|$)/i.test(model);
}

const DEFAULT_JSON_TIMEOUT_MS = 25000;

// The limit includes hidden reasoning, not just the requested JSON text.
function completionBudget(model: string, outputTokens: number, effort = "low") {
  return usesReasoning(model) ? outputTokens + (effort === "high" ? 8192 : effort === "medium" ? 4096 : 2048) : outputTokens;
}

async function requestJson<T>(input: {
  messages: Array<ChatMessage | VisionMessage>;
  jsonSchema?: JsonSchemaFormat;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
  timeoutMs?: number;
  requestSignal?: AbortSignal;
  signal?: AbortSignal;
  retryOnTruncation?: boolean;
}): Promise<T | null> {
  const key = getOpenAiApiKey();
  if (!key) return null;
  const model = getOpenAiModel();
  const reasoning = usesReasoning(model);
  const deadline = input.requestSignal ?? createDeadline(input.timeoutMs, DEFAULT_JSON_TIMEOUT_MS);
  if (!deadline) return null;
  const signal = input.signal ? AbortSignal.any([deadline, input.signal]) : deadline;
  const body: Record<string, unknown> = {
    model,
    store: false,
    response_format: input.jsonSchema
      ? { type: "json_schema", json_schema: input.jsonSchema }
      : { type: "json_object" },
    messages: input.messages,
    ...(reasoning ? {
      max_completion_tokens: completionBudget(model, input.maxTokens ?? 2000, input.reasoningEffort),
      reasoning_effort: input.reasoningEffort ?? "low",
    } : { temperature: input.temperature ?? 0.2, max_tokens: input.maxTokens ?? 2000 }),
  };
  try {
    // At most one targeted retry, sharing the original deadline.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { response, payload } = await fetchPayload("chat/completions", key, body, signal);
      if (!response.ok) {
        console.error("OpenAI completion failed", { model, status: response.status });
        if (attempt === 0 && rejectsReasoningEffort(response, payload) && "reasoning_effort" in body) {
          delete body.reasoning_effort;
          continue;
        }
        return null;
      }
      const choice = firstChoice(payload);
      const message = isRecord(choice?.message) ? choice.message : null;
      if (message?.refusal || choice?.finish_reason === "content_filter") return null;
      if (choice?.finish_reason === "length") {
        console.error("OpenAI completion truncated", { model, attempt });
        if (attempt === 0 && input.retryOnTruncation !== false) {
          const field = reasoning ? "max_completion_tokens" : "max_tokens";
          body[field] = Number(body[field]) * 2;
          continue;
        }
        return null;
      }
      if (choice?.finish_reason !== "stop" || typeof message?.content !== "string") return null;
      const parsed = parseJsonObject<T>(message.content);
      if (!parsed) console.error("OpenAI completion returned invalid JSON", { model });
      return parsed;
    }
  } catch {
    // Never log request payloads, credentials, or raw provider error messages.
    console.error("OpenAI completion unavailable", { model, reason: signal.aborted ? "timeout" : "request_or_response_error" });
  }
  return null;
}

export async function completeJsonFromImage<T>(input: {
  instructions: string;
  imageDataUrl: string;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<T | null> {
  return requestJson<T>({
    temperature: 0.1,
    maxTokens: input.maxTokens ?? 2500,
    timeoutMs: input.timeoutMs ?? 45000,
    signal: input.signal,
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
  /** Share a deadline across a multi-stage workflow. */
  signal?: AbortSignal;
  /** A planner can reserve its bounded repair for a concrete validation error. */
  retryOnTruncation?: boolean;
}): Promise<T | null> {
  return requestJson<T>(input);
}

/** Returns model-requested function calls. The caller must validate all arguments. */
export async function completeFunctionCalls(input: {
  messages: ChatMessage[];
  tools: FunctionTool[];
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<Array<{ name: string; arguments: unknown }> | null> {
  const key = getOpenAiApiKey();
  if (!key) return null;
  if (!input.tools.length) return [];
  const model = getOpenAiModel();
  const reasoning = usesReasoning(model);
  const deadline = createDeadline(input.timeoutMs, 15000);
  if (!deadline) return null;
  const signal = input.signal ? AbortSignal.any([deadline, input.signal]) : deadline;
  // Reasoning with tools requires Responses for current GPT models. Removing
  // reasoning_effort from a rejected Chat request silently disables reasoning.
  if (reasoning) return requestReasoningFunctionCalls(input, key, model, signal);
  const body: Record<string, unknown> = {
    model, store: false, messages: input.messages, tools: input.tools,
    tool_choice: "auto", parallel_tool_calls: true,
    ...(reasoning ? { max_completion_tokens: completionBudget(model, input.maxTokens ?? 700), reasoning_effort: "low" }
      : { max_tokens: input.maxTokens ?? 700, temperature: 0.1 }),
  };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { response, payload } = await fetchPayload("chat/completions", key, body, signal);
      if (!response.ok) {
        console.error("OpenAI function calling failed", { model, status: response.status });
        // A rejected parameter was not a generation. Do not retry partial calls.
        if (attempt === 0 && rejectsReasoningEffort(response, payload) && "reasoning_effort" in body) {
          delete body.reasoning_effort;
          continue;
        }
        return null;
      }
      const choice = firstChoice(payload);
      const message = isRecord(choice?.message) ? choice.message : null;
      if (!message || message.refusal) return null;
      if (choice?.finish_reason === "stop" && !message.tool_calls) return [];
      if (choice?.finish_reason !== "tool_calls" || !Array.isArray(message.tool_calls)) return null;
      const allowedNames = new Set(input.tools.map(tool => tool.function.name));
      return message.tool_calls.slice(0, 6).flatMap((call: unknown) => {
        if (!isRecord(call) || call.type !== "function" || !isRecord(call.function)
          || typeof call.function.name !== "string" || !allowedNames.has(call.function.name)
          || typeof call.function.arguments !== "string") return [];
        try {
          const argumentsObject: unknown = JSON.parse(call.function.arguments);
          return isRecord(argumentsObject) ? [{ name: call.function.name, arguments: argumentsObject }] : [];
        } catch { return []; }
      });
    }
  } catch {
    console.error("OpenAI function calling unavailable", { model,
      reason: signal.aborted ? "timeout" : "request_or_response_error" });
  }
  return null;
}

async function requestReasoningFunctionCalls(input: {
  messages: ChatMessage[]; tools: FunctionTool[]; maxTokens?: number;
}, key: string, model: string, signal: AbortSignal): Promise<Array<{ name: string; arguments: unknown }> | null> {
  try {
    const { response, payload } = await fetchPayload("responses", key, {
      model, store: false, input: input.messages,
      tools: input.tools.map(tool => ({ type: "function", ...tool.function })),
      tool_choice: "auto", parallel_tool_calls: true,
      reasoning: { effort: "low" },
      max_output_tokens: completionBudget(model, input.maxTokens ?? 700),
    }, signal);
    if (!response.ok) {
      console.error("OpenAI function calling failed", { model, status: response.status });
      return null;
    }
    if (!isRecord(payload) || payload.error != null || payload.status !== "completed"
      || !Array.isArray(payload.output)) return null;
    const output = payload.output.filter(isRecord);
    const messages = outputMessages(output);
    if (output.some(item => item.status != null && item.status !== "completed")
      || outputContent(messages).some(part => part.type === "refusal")) return null;
    const calls = output.filter(item => item.type === "function_call");
    if (!calls.length) return messages.length ? [] : null;
    const allowedNames = new Set(input.tools.map(tool => tool.function.name));
    return calls.slice(0, 6).flatMap(call => {
      if (typeof call.name !== "string" || !allowedNames.has(call.name)
        || typeof call.arguments !== "string") return [];
      try {
        const argumentsObject: unknown = JSON.parse(call.arguments);
        return isRecord(argumentsObject) ? [{ name: call.name, arguments: argumentsObject }] : [];
      } catch { return []; }
    });
  } catch {
    console.error("OpenAI function calling unavailable", { model,
      reason: signal.aborted ? "timeout" : "request_or_response_error" });
    return null;
  }
}

function outputMessages(output: Record<string, unknown>[]) {
  return output.filter(item => item.type === "message" && (item.role == null || item.role === "assistant"));
}

function outputContent(messages: Record<string, unknown>[]) {
  return messages.flatMap(item => Array.isArray(item.content) ? item.content.filter(isRecord) : []);
}

function extractOutputText(body: Record<string, unknown>, content: Record<string, unknown>[]) {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text.trim();
  return content.filter(part => part.type === "output_text" && typeof part.text === "string")
    .map(part => part.text).join("\n").trim();
}

function sourceUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}

function extractSources(searchCalls: Record<string, unknown>[], content: Record<string, unknown>[]) {
  const sources = searchCalls.flatMap(item => isRecord(item.action) && Array.isArray(item.action.sources)
    ? item.action.sources.filter(isRecord).map(source => source.url) : []);
  const citations = content.flatMap(part => Array.isArray(part.annotations)
    ? part.annotations.filter(isRecord).filter(annotation => annotation.type === "url_citation").map(annotation => annotation.url) : []);
  return [...new Set([...sources, ...citations].map(sourceUrl).filter((url): url is string => url !== null))];
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
  signal?: AbortSignal;
  requireSearch?: boolean;
  searchContextSize?: "low" | "medium" | "high";
}): Promise<T | null> {
  const key = getOpenAiApiKey();
  if (!key) return null;
  const model = getOpenAiSearchModel();
  const deadline = createDeadline(input.timeoutMs, 55000);
  if (!deadline) return null;
  const signal = input.signal ? AbortSignal.any([deadline, input.signal]) : deadline;
  try {
    const body: Record<string, unknown> = {
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
    const { response, payload } = await fetchPayload("responses", key, body, signal);
    if (!response.ok) {
      console.error("OpenAI web search response failed", { model, status: response.status });
      return null;
    }
    if (!isRecord(payload) || payload.error != null || payload.status !== "completed") return null;
    const output = Array.isArray(payload.output) ? payload.output.filter(isRecord) : [];
    const messages = outputMessages(output);
    const content = outputContent(messages);
    const searchCalls = output.filter(item => item.type === "web_search_call");
    if (content.some(part => part.type === "refusal")
      || messages.some(item => item.status != null && item.status !== "completed")
      || searchCalls.some(item => item.status !== "completed")
      || (input.requireSearch && !searchCalls.length)) return null;
    const text = extractOutputText(payload, content);
    const sources = searchCalls.length ? extractSources(searchCalls, content) : [];
    input.onSources?.(sources);
    const direct = parseJsonObject<T>(text);
    if (direct) return direct;
    if (!text.trim() || signal.aborted) return null;
    return requestJson<T>({
      requestSignal: signal,
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
    console.error("OpenAI web search unavailable", { model,
      reason: signal.aborted ? "timeout" : "request_or_response_error" });
    return null;
  }
}
