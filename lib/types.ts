import { z } from "zod";

export const CATEGORIES = [
  "computo", "mobiliario", "papeleria", "servicios", "viajes", "mantenimiento",
] as const;
export type Category = (typeof CATEGORIES)[number];

// ---------- F1: structured requisition (agent output) ----------
export const StructuredRequisitionSchema = z.object({
  category: z.enum(CATEGORIES),
  items: z.array(z.object({
    description: z.string(),
    qty: z.number().int().positive(),
    unit: z.string(),
  })).min(1),
  estimated_amount: z.number().nullable(),
  need_by: z.string().nullable(), // ISO date YYYY-MM-DD
  urgency: z.enum(["baja", "normal", "alta"]),
  clarifying_question: z.string().nullable(), // ONE max; null when clear enough
  assumptions: z.array(z.string()),
});
export type StructuredRequisition = z.infer<typeof StructuredRequisitionSchema>;

export const structuredRequisitionJsonSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          qty: { type: "integer" },
          unit: { type: "string" },
        },
        required: ["description", "qty", "unit"],
        additionalProperties: false,
      },
    },
    estimated_amount: { type: ["number", "null"] },
    need_by: { type: ["string", "null"] },
    urgency: { type: "string", enum: ["baja", "normal", "alta"] },
    clarifying_question: { type: ["string", "null"] },
    assumptions: { type: "array", items: { type: "string" } },
  },
  required: ["category", "items", "estimated_amount", "need_by", "urgency",
             "clarifying_question", "assumptions"],
  additionalProperties: false,
} as const;

// ---------- F4: RFQ draft (agent output) ----------
export const RfqDraftSchema = z.object({
  subject: z.string(),
  body_text: z.string(), // identical specs across vendors, written in the tenant language
});
export type RfqDraft = z.infer<typeof RfqDraftSchema>;

export const rfqDraftJsonSchema = {
  type: "object",
  properties: { subject: { type: "string" }, body_text: { type: "string" } },
  required: ["subject", "body_text"],
  additionalProperties: false,
} as const;

// ---------- F4 demo: simulated vendor reply (agent output) ----------
export const SimulatedReplySchema = z.object({ reply_text: z.string() });
export type SimulatedReply = z.infer<typeof SimulatedReplySchema>;

export const simulatedReplyJsonSchema = {
  type: "object",
  properties: { reply_text: { type: "string" } },
  required: ["reply_text"],
  additionalProperties: false,
} as const;

// ---------- F5: normalized quote (agent output) ----------
export const NormalizedQuoteSchema = z.object({
  unit_price: z.number().positive(),
  total: z.number().positive(),
  currency: z.string().length(3), // ISO 4217 — extracted from the reply, defaulting to the RFQ currency
  delivery_days: z.number().int().positive(),
  warranty_months: z.number().int().nonnegative(),
  payment_terms: z.string(),
});
export type NormalizedQuote = z.infer<typeof NormalizedQuoteSchema>;

export const normalizedQuoteJsonSchema = {
  type: "object",
  properties: {
    unit_price: { type: "number" },
    total: { type: "number" },
    currency: { type: "string" },
    delivery_days: { type: "integer" },
    warranty_months: { type: "integer" },
    payment_terms: { type: "string" },
  },
  required: ["unit_price", "total", "currency", "delivery_days", "warranty_months", "payment_terms"],
  additionalProperties: false,
} as const;

// ---------- F5: reasoning trace (agent output) ----------
export const ReasoningSchema = z.object({ reasoning_trace: z.string() });
export const reasoningJsonSchema = {
  type: "object",
  properties: { reasoning_trace: { type: "string" } },
  required: ["reasoning_trace"],
  additionalProperties: false,
} as const;

// ---------- Shared deterministic types ----------
export interface ScoringWeights { price: number; delivery: number; terms: number; rating: number }

export type RequisitionStatus =
  | "intake" | "policy_check" | "sourcing" | "quoted" | "recommended"
  | "approved" | "rejected" | "po_issued" | "flagged";

// ---------- i18n / currency ----------
export const LOCALES = ["es", "en", "pt"] as const;
export type Locale = (typeof LOCALES)[number];
export const LANGUAGE_NAMES: Record<Locale, string> = {
  es: "Spanish", en: "English", pt: "Portuguese", // used in agent prompts
};
