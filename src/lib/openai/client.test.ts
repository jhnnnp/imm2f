import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeJson, completeJsonFromImage, completeJsonWithWebSearch } from "./client";

const fetchMock = vi.fn();
const messages = [{ role: "user" as const, content: "Reply JSON" }];
const completion = (content: string, finish_reason = "stop") => Response.json({ choices: [{ finish_reason, message: { content } }] });
const requestBody = (index = 0) => JSON.parse(fetchMock.mock.calls[index][1].body);

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
});
