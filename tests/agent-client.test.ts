import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { callAgentJSON, AgentValidationError, RawCall } from "@/lib/agent/client";

const schema = z.object({ qty: z.number() });
const jsonSchema = {
  type: "object", properties: { qty: { type: "number" } },
  required: ["qty"], additionalProperties: false,
};
const opts = { system: "test system", user: "8 laptops", schema, jsonSchema };

describe("callAgentJSON", () => {
  it("returns validated data on first valid response", async () => {
    const raw: RawCall = vi.fn(async () => `{"qty": 8}`);
    const out = await callAgentJSON({ ...opts, rawCall: raw });
    expect(out).toEqual({ qty: 8 });
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it("strips markdown fences before parsing", async () => {
    const raw: RawCall = vi.fn(async () => "```json\n{\"qty\": 8}\n```");
    expect(await callAgentJSON({ ...opts, rawCall: raw })).toEqual({ qty: 8 });
  });

  it("retries once with the validation error appended, then succeeds", async () => {
    const raw = vi.fn()
      .mockResolvedValueOnce(`{"qty": "ocho"}`)   // fails zod
      .mockResolvedValueOnce(`{"qty": 8}`);
    const out = await callAgentJSON({ ...opts, rawCall: raw as RawCall });
    expect(out).toEqual({ qty: 8 });
    expect(raw).toHaveBeenCalledTimes(2);
    const secondUserMsg = (raw.mock.calls[1] as string[])[1];
    expect(secondUserMsg).toContain("no validó");
  });

  it("throws AgentValidationError after two failures (fail visibly)", async () => {
    const raw: RawCall = vi.fn(async () => "not json at all");
    await expect(callAgentJSON({ ...opts, rawCall: raw })).rejects.toBeInstanceOf(AgentValidationError);
  });
});
