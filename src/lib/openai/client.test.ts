import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeFunctionCalls, completeJson, completeJsonFromImage, completeJsonWithWebSearch } from "./client";

const fetchMock = vi.fn();
const messages = [{ role: "user" as const, content: "Reply JSON" }];
const completion = (content: string, finish_reason = "stop") => Response.json({ choices: [{ finish_reason, message: { content } }] });
const requestBody = (index = 0) => JSON.parse(fetchMock.mock.calls[index][1].body);
const searchTool = { type: "function" as const, function: { name: "search_places", description: "Search records",
  strict: true, parameters: { type: "object", properties: { query: { type: "string" } },
    required: ["query"], additionalProperties: false } } };
const functionCall = (name = "search_places", argumentsText = '{"query":"서울 카페"}') => ({
  type: "function", function: { name, arguments: argumentsText },
});
const toolCompletion = (finish_reason = "tool_calls", calls: unknown[] = [functionCall()], refusal: string | null = null) =>
  Response.json({ choices: [{ finish_reason, message: { refusal, tool_calls: calls } }] });
const completedSearch = (text = '{"reply":"확인했어요."}', extra: unknown[] = []) => Response.json({
  status: "completed", output: [
    { type: "web_search_call", status: "completed", action: { sources: [{ url: "https://example.com/facts" }] } },
    { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] },
    ...extra,
  ],
});

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
  vi.stubEnv("OPENAI_SEARCH_MODEL", "");
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); fetchMock.mockReset(); });

describe("OpenAI JSON transport", () => {
  it("does not call the provider without a key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await completeJson({ messages })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("returns classic model JSON", async () => {
    fetchMock.mockResolvedValue(completion('{"ok":true}'));
    expect(await completeJson({ messages, maxTokens: 300 })).toEqual({ ok: true });
    expect(requestBody()).toMatchObject({ max_tokens: 300 });
    expect(requestBody()).not.toHaveProperty("reasoning_effort");
  });
  it("sends a strict JSON schema for a structured completion", async () => {
    fetchMock.mockResolvedValue(completion('{"ok":true}'));
    const jsonSchema = { name: "date_turn_test", strict: true as const,
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } };
    expect(await completeJson({ messages, jsonSchema })).toEqual({ ok: true });
    expect(requestBody().response_format).toEqual({ type: "json_schema", json_schema: jsonSchema });
  });
  it("reserves reasoning tokens for short router responses", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-5.6-terra");
    fetchMock.mockResolvedValue(completion('{"mode":"places"}'));
    expect(await completeJson({ messages, maxTokens: 300 })).toEqual({ mode: "places" });
    expect(requestBody().max_completion_tokens).toBeGreaterThan(2000);
  });
  it("retries truncation with more room within the same deadline", async () => {
    fetchMock.mockResolvedValueOnce(completion('{"ok":', "length")).mockResolvedValueOnce(completion('{"ok":true}'));
    expect(await completeJson({ messages, maxTokens: 300 })).toEqual({ ok: true });
    expect(requestBody(1).max_tokens).toBe(600);
    expect(fetchMock.mock.calls[0][1].signal).toBe(fetchMock.mock.calls[1][1].signal);
  });
  it("allows a bounded planner to disable an extra truncation generation", async () => {
    fetchMock.mockResolvedValue(completion('{"ok":', "length"));
    expect(await completeJson({ messages, retryOnTruncation: false })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("honors an externally canceled workflow without starting a request", async () => {
    const controller = new AbortController(); controller.abort();
    expect(await completeJson({ messages, signal: controller.signal })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not start web research after the design workflow is canceled", async () => {
    expect(await completeJsonWithWebSearch({ instructions: "Return JSON", payload: {}, signal: AbortSignal.abort() })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("cancels web research while its response body is stalled", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    const pending = completeJsonWithWebSearch({ instructions: "Return JSON", payload: {}, signal: controller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await pending).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404, 429, 500])("does not blindly retry HTTP %i", async status => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: "provider_error" } }, { status }));
    expect(await completeJson({ messages })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("only removes reasoning effort for a matching parameter rejection", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-5.6-terra");
    fetchMock.mockResolvedValueOnce(Response.json({ error: { param: "reasoning_effort" } }, { status: 400 })).mockResolvedValueOnce(completion('{"ok":true}'));
    expect(await completeJson({ messages })).toEqual({ ok: true });
    expect(requestBody(1)).not.toHaveProperty("reasoning_effort");
  });
  it.each(['[]', 'null', 'false', '[{"ok":true}]', '{bad json'])('rejects invalid object output %s', async content => {
    fetchMock.mockResolvedValue(completion(content));
    expect(await completeJson({ messages })).toBeNull();
  });
  it("returns null on network rejection", async () => {
    fetchMock.mockRejectedValue(new TypeError("network"));
    expect(await completeJson({ messages })).toBeNull();
  });
  it("uses the same guarded transport for vision", async () => {
    fetchMock.mockResolvedValue(completion('{"title":"예약"}'));
    expect(await completeJsonFromImage({ instructions: "Extract JSON", imageDataUrl: "data:image/png;base64,test" })).toEqual({ title: "예약" });
    expect(requestBody().messages[1].content[1].type).toBe("image_url");
  });
  it("does not start image interpretation for an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await completeJsonFromImage({ instructions: "Extract JSON", imageDataUrl: "data:image/png;base64,test",
      signal: controller.signal })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("cancels image interpretation while reading its response body", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => {}) });
    const result = completeJsonFromImage({ instructions: "Extract JSON", imageDataUrl: "data:image/png;base64/test",
      signal: controller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await result).toBeNull();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("supports a separate search model and preserves repair schema", async () => {
    vi.stubEnv("OPENAI_SEARCH_MODEL", "gpt-4.1-mini");
    fetchMock.mockResolvedValueOnce(Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "The reply should say 예약을 확인해 주세요." }] }] }))
      .mockResolvedValueOnce(completion('{"reply":"예약을 확인해 주세요."}'));
    expect(await completeJsonWithWebSearch({ instructions: 'Return {"reply":string}', payload: { question: "예약?" } })).toEqual({ reply: "예약을 확인해 주세요." });
    expect(requestBody().model).toBe("gpt-4.1-mini");
    expect(requestBody(1).messages[0].content).toContain('Return {"reply":string}');
    expect(requestBody(1).messages[0].content).not.toContain('"facts"');
  });
  it("rejects incomplete web search output instead of presenting partial facts", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "incomplete", output_text: '{"reply":"partial"}' }));
    expect(await completeJsonWithWebSearch({ instructions: "JSON", payload: {} })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, null, "tool_calls", "function_call", "unknown"])("rejects unfinished JSON completion status %s", async finish_reason => {
    fetchMock.mockResolvedValue(Response.json({ choices: [{ finish_reason, message: { content: '{"ok":true}' } }] }));
    expect(await completeJson({ messages })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not use valid JSON beside a provider refusal", async () => {
    fetchMock.mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}', refusal: "Refused" } }] }));
    expect(await completeJson({ messages })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects an error payload even when it includes a completed choice", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { message: "private user text" },
      choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] }));
    expect(await completeJson({ messages })).toBeNull();
  });
  it("never prints provider errors or request secrets", async () => {
    const secretText = "private-reservation-contents";
    fetchMock.mockResolvedValue(Response.json({ error: { message: secretText, code: secretText, param: secretText } }, { status: 400 }));
    expect(await completeJson({ messages: [{ role: "user", content: secretText }] })).toBeNull();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain(secretText);
    expect(logged).not.toContain("test-key");
  });
  it("does not retry a reasoning parameter rejection for a classic model", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { param: "reasoning_effort" } }, { status: 400 }));
    expect(await completeJson({ messages })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps a slow body read inside the request timeout", async () => {
    let release!: (value: unknown) => void;
    const body = new Promise(resolve => { release = resolve; });
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => body });
    expect(await completeJson({ messages, timeoutMs: 20 })).toBeNull();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    release({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("bounds a request even if the transport ignores the abort signal", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    expect(await completeJson({ messages, timeoutMs: 20 })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("fails safely without a provider call for an invalid timeout %s", async timeoutMs => {
    expect(await completeJson({ messages, timeoutMs })).toBeNull();
    expect(await completeJsonWithWebSearch({ instructions: "JSON", payload: {}, timeoutMs })).toBeNull();
    expect(await completeFunctionCalls({ messages, tools: [searchTool], timeoutMs })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("OpenAI function transport", () => {
  it("returns only declared function calls with object arguments", async () => {
    fetchMock.mockResolvedValue(toolCompletion("tool_calls", [
      functionCall("unknown_tool"), functionCall("search_places", "null"), functionCall("search_places", "[]"),
      functionCall("search_places", "true"), functionCall("search_places", "```json\n{}\n```"), functionCall(),
    ]));
    expect(await completeFunctionCalls({ messages, tools: [searchTool] }))
      .toEqual([{ name: "search_places", arguments: { query: "서울 카페" } }]);
    expect(requestBody().tools[0].function.strict).toBe(true);
  });
  it.each(["length", "content_filter", "function_call", "unknown"])("never executes partial or filtered tool calls (%s)", async finish_reason => {
    fetchMock.mockResolvedValue(toolCompletion(finish_reason));
    expect(await completeFunctionCalls({ messages, tools: [searchTool] })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects tool calls beside a refusal", async () => {
    fetchMock.mockResolvedValue(toolCompletion("tool_calls", [functionCall()], "Refused"));
    expect(await completeFunctionCalls({ messages, tools: [searchTool] })).toBeNull();
  });
  it("distinguishes an ordinary no-tool reply from a malformed provider response", async () => {
    fetchMock.mockResolvedValueOnce(completion("조사가 더 필요하지 않아요."));
    expect(await completeFunctionCalls({ messages, tools: [searchTool] })).toEqual([]);
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [] }));
    expect(await completeFunctionCalls({ messages, tools: [searchTool] })).toBeNull();
  });
  it("uses Responses so a reasoning model can actually reason with its tools", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-5.6-terra");
    fetchMock.mockResolvedValue(Response.json({ status: "completed", output: [
      { type: "reasoning", summary: [] },
      { type: "function_call", status: "completed", name: "search_places", arguments: '{"query":"서울 카페"}' },
    ] }));
    expect(await completeFunctionCalls({ messages, tools: [searchTool] }))
      .toEqual([{ name: "search_places", arguments: { query: "서울 카페" } }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    expect(requestBody()).toMatchObject({ input: messages, reasoning: { effort: "low" }, store: false });
    expect(requestBody().tools).toEqual([{ type: "function", ...searchTool.function }]);
    expect(requestBody()).not.toHaveProperty("messages");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["incomplete", "failed", "in_progress"])("rejects unfinished Responses tools (%s)", async status => {
    vi.stubEnv("OPENAI_MODEL", "gpt-6.1-sol");
    fetchMock.mockResolvedValue(Response.json({ status, output: [
      { type: "function_call", name: "search_places", arguments: '{"query":"서울 카페"}' },
    ] }));
    expect(await completeFunctionCalls({ messages, tools: [searchTool] })).toBeNull();
  });
  it("ignores undeclared Responses calls and rejects a partial individual call", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-5.6-terra");
    fetchMock.mockResolvedValueOnce(Response.json({ status: "completed", output: [
      { type: "function_call", name: "unknown_tool", arguments: "{}" },
      { type: "function_call", name: "search_places", arguments: "[]" },
      { type: "function_call", name: "search_places", arguments: '{"query":"서울 카페"}' },
    ] }));
    expect(await completeFunctionCalls({ messages, tools: [searchTool] }))
      .toEqual([{ name: "search_places", arguments: { query: "서울 카페" } }]);
    fetchMock.mockResolvedValueOnce(Response.json({ status: "completed", output: [
      { type: "function_call", status: "incomplete", name: "search_places", arguments: "{}" },
    ] }));
    expect(await completeFunctionCalls({ messages, tools: [searchTool] })).toBeNull();
  });
  it("distinguishes a completed no-tool Responses answer from missing output", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-5.6-terra");
    fetchMock.mockResolvedValueOnce(Response.json({ status: "completed", output: [
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "충분해요." }] },
    ] }));
    expect(await completeFunctionCalls({ messages, tools: [searchTool] })).toEqual([]);
    fetchMock.mockResolvedValueOnce(Response.json({ status: "completed", output: [] }));
    expect(await completeFunctionCalls({ messages, tools: [searchTool] })).toBeNull();
  });
  it("does not execute Responses calls beside a refusal", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-5.6-terra");
    fetchMock.mockResolvedValue(Response.json({ status: "completed", output: [
      { type: "message", content: [{ type: "refusal", refusal: "Refused" }] },
      { type: "function_call", name: "search_places", arguments: "{}" },
    ] }));
    expect(await completeFunctionCalls({ messages, tools: [searchTool] })).toBeNull();
  });
  it("reserves enough hidden tokens for substantive recommendation reasoning", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-5.6-terra");
    fetchMock.mockResolvedValue(completion('{"ok":true}'));
    expect(await completeJson({ messages, maxTokens: 1200, reasoningEffort: "medium" })).toEqual({ ok: true });
    expect(requestBody().max_completion_tokens).toBe(5296);
  });
  it("honors cancellation before starting a tool request", async () => {
    expect(await completeFunctionCalls({ messages, tools: [searchTool], signal: AbortSignal.abort() })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not call the provider when no functions are available", async () => {
    expect(await completeFunctionCalls({ messages, tools: [] })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("bounds tool response body reads without retrying", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => {}) });
    expect(await completeFunctionCalls({ messages, tools: [searchTool], timeoutMs: 20 })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("OpenAI search completion integrity", () => {
  it("routes a legacy chat model through a compatible hosted-search model", async () => {
    fetchMock.mockResolvedValue(completedSearch());
    expect(await completeJsonWithWebSearch({ instructions: "JSON", payload: {}, requireSearch: true }))
      .toEqual({ reply: "확인했어요." });
    expect(requestBody().model).toBe("gpt-4.1-mini");
    expect(requestBody().tools).toContainEqual(expect.objectContaining({ type: "web_search" }));
  });

  it.each(["queued", "in_progress", "cancelled", "failed", "incomplete", undefined])("rejects non-completed Responses status %s", async status => {
    fetchMock.mockResolvedValue(Response.json({ status, output_text: '{"reply":"partial"}' }));
    expect(await completeJsonWithWebSearch({ instructions: "JSON", payload: {} })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("requires an actually completed search when searching was requested", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "completed", output_text: '{"reply":"unchecked"}' }));
    expect(await completeJsonWithWebSearch({ instructions: "JSON", payload: {}, requireSearch: true })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not repair a refusal into an answer or emit sources", async () => {
    fetchMock.mockResolvedValue(completedSearch('{"reply":"unchecked"}', [{ type: "message", role: "assistant",
      content: [{ type: "refusal", refusal: "Refused" }] }]));
    const onSources = vi.fn();
    expect(await completeJsonWithWebSearch({ instructions: "JSON", payload: {}, onSources })).toBeNull();
    expect(onSources).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects an incomplete message even beside a completed top-level response", async () => {
    fetchMock.mockResolvedValue(completedSearch('{"reply":"partial"}', [{ type: "message", status: "incomplete",
      content: [{ type: "output_text", text: "partial" }] }]));
    expect(await completeJsonWithWebSearch({ instructions: "JSON", payload: {} })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("extracts canonical sources only from search records and URL citations", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "completed", output: [
      { type: "web_search_call", status: "completed", action: { sources: [
        { url: "https://example.com/facts" }, { url: "javascript:alert(1)" }, { url: "https://user:pass@example.com/private" },
      ] } },
      { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"reply":"checked"}', annotations: [
        { type: "url_citation", url: "https://example.com/facts" }, { type: "url_citation", url: "https://example.com/menu" },
        { type: "unknown", url: "https://example.com/fake" },
      ] }] },
    ] }));
    const onSources = vi.fn();
    expect(await completeJsonWithWebSearch({ instructions: "JSON", payload: {}, requireSearch: true, onSources }))
      .toEqual({ reply: "checked" });
    expect(onSources).toHaveBeenCalledWith(["https://example.com/facts", "https://example.com/menu"]);
  });
  it("uses one deadline for search and its JSON repair", async () => {
    fetchMock.mockResolvedValueOnce(completedSearch("Reply with checked facts."))
      .mockResolvedValueOnce(completion('{"reply":"checked"}'));
    expect(await completeJsonWithWebSearch({ instructions: "JSON", payload: {}, requireSearch: true }))
      .toEqual({ reply: "checked" });
    expect(fetchMock.mock.calls[1][1].signal).toBe(fetchMock.mock.calls[0][1].signal);
  });
  it("keeps search body reads within its deadline and starts no repair on timeout", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => {}) });
    expect(await completeJsonWithWebSearch({ instructions: "JSON", payload: {}, timeoutMs: 20 })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("fails safely on an unserializable payload without sending it", async () => {
    const payload: { self?: unknown } = {};
    payload.self = payload;
    expect(await completeJsonWithWebSearch({ instructions: "JSON", payload })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
