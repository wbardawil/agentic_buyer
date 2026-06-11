import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import fs from "node:fs";
import path from "node:path";

export const MODEL = "claude-sonnet-4-6"; // spec §7: claude-sonnet-4 family

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
  return _anthropic;
}

export class AgentValidationError extends Error {
  constructor(public lastValidationError: string) {
    super(`agent output failed validation after retry: ${lastValidationError}`);
  }
}

/** System prompts are product surface area — versioned files in /prompts (spec §7). */
export function loadPrompt(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), "prompts", `${name}.md`), "utf8");
}

export type RawCall = (system: string, user: string, jsonSchema: object) => Promise<string>;

const defaultRawCall: RawCall = async (system, user, jsonSchema) => {
  const res = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
    // structured outputs — param newer than the installed SDK types; spread-cast stays
    // valid whether or not a future SDK upgrade adds the typing
    ...({ output_config: { format: { type: "json_schema", schema: jsonSchema } } } as object),
  });
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("empty model response");
  return text.text;
};

export async function callAgentJSON<T>(opts: {
  system: string;
  user: string;
  schema: ZodType<T>;
  jsonSchema: object;
  rawCall?: RawCall;
}): Promise<T> {
  const raw = opts.rawCall ?? defaultRawCall;
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      attempt === 0
        ? opts.user
        : `${opts.user}\n\nTu respuesta anterior no validó contra el esquema: ${lastError}\nResponde únicamente con JSON válido que cumpla el esquema.`;
    const text = (await raw(opts.system, user, opts.jsonSchema))
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    try {
      const result = opts.schema.safeParse(JSON.parse(text));
      if (result.success) return result.data;
      lastError = result.error.message;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new AgentValidationError(lastError);
}
