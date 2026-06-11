import {
  StructuredRequisitionSchema, structuredRequisitionJsonSchema, StructuredRequisition,
  RfqDraftSchema, rfqDraftJsonSchema, RfqDraft,
  NormalizedQuoteSchema, normalizedQuoteJsonSchema, NormalizedQuote,
  ReasoningSchema, reasoningJsonSchema,
  SimulatedReplySchema, simulatedReplyJsonSchema,
  Locale, LANGUAGE_NAMES,
} from "@/lib/types";
import { callAgentJSON, loadPrompt } from "@/lib/agent/client";
import type { ScoredQuote } from "@/lib/services/quote-scorer";
import type { SavingsResult } from "@/lib/services/savings-calc";

/** Tenant context threaded into every agent call — output language + currency are data, not prompt text. */
export interface TenantCtx { locale: Locale; currency: string }

function ctxLines(ctx: TenantCtx): string[] {
  return [
    `Output language: ${LANGUAGE_NAMES[ctx.locale]} (${ctx.locale})`,
    `Currency: ${ctx.currency}`,
  ];
}

export async function parseRequisition(input: {
  raw_text: string;
  category_hint?: string;
  budget?: number;
  need_by?: string;
  clarification_answered?: boolean;
}, ctx: TenantCtx): Promise<StructuredRequisition> {
  const today = new Date().toISOString().slice(0, 10);
  const user = [
    ...ctxLines(ctx),
    `Current date: ${today}`,
    input.category_hint ? `User's category hint: ${input.category_hint}` : "",
    input.budget ? `Budget entered in the form: ${ctx.currency} ${input.budget}` : "",
    input.need_by ? `Deadline entered in the form: ${input.need_by}` : "",
    input.clarification_answered ? "The user already answered a previous clarification." : "",
    `Request:\n${input.raw_text}`,
  ].filter(Boolean).join("\n");

  return callAgentJSON({
    system: loadPrompt("parse_requisition"),
    user,
    schema: StructuredRequisitionSchema,
    jsonSchema: structuredRequisitionJsonSchema,
  });
}

export async function draftRFQ(input: {
  vendor_name: string;
  specs: string;        // serialized items + qty + need_by — identical across vendors
  reply_deadline: string;
  company_name: string;
}, ctx: TenantCtx): Promise<RfqDraft> {
  const user = [
    ...ctxLines(ctx),
    `Recipient vendor: ${input.vendor_name}`,
    `Requesting company: ${input.company_name}`,
    `Reply deadline: ${input.reply_deadline}`,
    `SPECIFICATIONS:\n${input.specs}`,
  ].join("\n");
  return callAgentJSON({
    system: loadPrompt("draft_rfq"),
    user,
    schema: RfqDraftSchema,
    jsonSchema: rfqDraftJsonSchema,
  });
}

export async function parseQuote(input: {
  raw_reply: string;
  qty: number;
}, ctx: TenantCtx): Promise<NormalizedQuote> {
  const user = [
    ...ctxLines(ctx),
    `RFQ currency (use if the reply states none): ${ctx.currency}`,
    `Quantity requested in the RFQ: ${input.qty}`,
    `Vendor reply:\n${input.raw_reply}`,
  ].join("\n");
  return callAgentJSON({
    system: loadPrompt("parse_quote"),
    user,
    schema: NormalizedQuoteSchema,
    jsonSchema: normalizedQuoteJsonSchema,
  });
}

export async function writeReasoning(input: {
  ranked: ScoredQuote[];
  weights: object;
  savings: SavingsResult;
}, ctx: TenantCtx): Promise<string> {
  const user = [
    ...ctxLines(ctx),
    `Weights used by the deterministic engine: ${JSON.stringify(input.weights)}`,
    `Scored table (order = final ranking):\n${JSON.stringify(input.ranked, null, 2)}`,
    `Estimated savings: ${JSON.stringify(input.savings)}`,
  ].join("\n\n");
  const out = await callAgentJSON({
    system: loadPrompt("write_reasoning"),
    user,
    schema: ReasoningSchema,
    jsonSchema: reasoningJsonSchema,
  });
  return out.reasoning_trace;
}

export type VendorProfile = "competitivo" | "equilibrado" | "premium" | "debil";
export const REPLY_PROFILES: VendorProfile[] = ["competitivo", "equilibrado", "premium", "debil"];

export async function simulateVendorReply(input: {
  rfq_body: string;
  vendor_name: string;
  profile: VendorProfile;
  budget_reference: number | null;
}, ctx: TenantCtx): Promise<string> {
  const user = [
    ...ctxLines(ctx),
    `Vendor: ${input.vendor_name}`,
    `Profile: ${input.profile}`,
    `Budget reference (total, ${ctx.currency}): ${input.budget_reference ?? "unknown"}`,
    `RFQ received:\n${input.rfq_body}`,
  ].join("\n");
  const out = await callAgentJSON({
    system: loadPrompt("simulate_vendor_reply"),
    user,
    schema: SimulatedReplySchema,
    jsonSchema: simulatedReplyJsonSchema,
  });
  return out.reply_text;
}
