import { NextResponse } from "next/server";
import { getDb, getTenant, COMPANY_ID } from "@/lib/db";
import { createAuditLogger } from "@/lib/services/audit-logger";
import { parseQuote, writeReasoning } from "@/lib/agent/tasks";
import { AgentValidationError } from "@/lib/agent/client";
import { scoreQuotes, ScorableQuote } from "@/lib/services/quote-scorer";
import { computeSavings } from "@/lib/services/savings-calc";
import type { StructuredRequisition } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const db = getDb();
  const audit = createAuditLogger(db, COMPANY_ID);
  const { requisition_id } = await req.json() as { requisition_id: string };
  if (!requisition_id) return NextResponse.json({ error: "requisition_id_required" }, { status: 400 });

  const { data: r, error: rErr } = await db.from("requisitions").select("*").eq("id", requisition_id).single();
  if (rErr || !r) return NextResponse.json({ error: "requisition not found" }, { status: 404 });
  if (r.status !== "quoted") return NextResponse.json({ error: `invalid status: ${r.status}` }, { status: 409 });
  const structured = r.structured as StructuredRequisition;
  const qty = structured.items.reduce((s, i) => s + i.qty, 0);
  const tenant = await getTenant();
  const ctx = { locale: tenant.locale, currency: tenant.currency };

  // [6a] AGENT — normalize each raw reply
  const { data: quotes, error: qErr } = await db.from("quotes")
    .select("*, vendors(id, name, rating), rfqs!inner(requisition_id)")
    .eq("rfqs.requisition_id", requisition_id);
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
  if (!quotes?.length) return NextResponse.json({ error: "no quotes" }, { status: 409 });

  const scorable: ScorableQuote[] = [];
  for (const q of quotes) {
    const vendor = q.vendors as { id: string; name: string; rating: number | string };
    let normalized;
    try {
      normalized = await parseQuote({ raw_reply: q.raw_reply, qty }, ctx);
    } catch (e) {
      if (e instanceof AgentValidationError) {
        await audit.log({ requisition_id, actor: "agent", action: "agent.error",
          payload: { step: "parse_quote", quote_id: q.id, error: e.lastValidationError } });
        continue;
      }
      throw e;
    }
    const { error: updErr } = await db.from("quotes").update({ normalized }).eq("id", q.id);
    if (updErr) {
      await audit.log({ requisition_id, actor: "system", action: "quote.update_failed",
        payload: { quote_id: q.id, error: updErr.message } });
      continue;
    }
    await audit.log({ requisition_id, actor: "agent", action: "quote.normalized",
      payload: { quote_id: q.id, vendor: vendor.name, normalized } });
    scorable.push({
      quote_id: q.id, vendor_id: vendor.id, vendor_name: vendor.name,
      vendor_rating: Number(vendor.rating), ...normalized,
    });
  }
  if (scorable.length === 0) {
    return NextResponse.json({ error: "no_quotes_normalized" }, { status: 422 });
  }

  // [6b] DETERMINISTIC — score with company weights
  const weights = tenant.scoring_weights;
  const ranked = scoreQuotes(scorable, weights);
  const winner = ranked[0];
  await audit.log({ requisition_id, actor: "system", action: "quotes.scored",
    payload: { weights, ranking: ranked.map(x => ({ vendor: x.vendor_name, total_score: x.total_score, rank: x.rank })) } });

  // [F8] DETERMINISTIC — savings vs SAME-CURRENCY baseline (never guessed, no FX in v0)
  const { data: baseline } = await db.from("baseline_purchases")
    .select("unit_price").eq("company_id", COMPANY_ID)
    .eq("category", r.category).eq("currency", winner.currency);
  const savings = computeSavings({
    category: r.category, qty,
    winning_unit_price: winner.unit_price,
    currency: winner.currency,
    baseline_unit_prices: (baseline ?? []).map(b => Number(b.unit_price)),
  });
  await audit.log({ requisition_id, actor: "system", action: "savings.computed", payload: savings });

  // [6c] AGENT — plain-language reasoning trace in the tenant's locale (explains, never decides)
  let reasoningTrace: string;
  try {
    reasoningTrace = await writeReasoning({ ranked, weights, savings }, ctx);
  } catch (e) {
    if (e instanceof AgentValidationError) {
      await audit.log({ requisition_id, actor: "agent", action: "agent.error",
        payload: { step: "write_reasoning", error: e.lastValidationError } });
      // locale-neutral deterministic fallback so the demo never dies here
      reasoningTrace = `#1 ${winner.vendor_name} — score ${winner.total_score.toFixed(2)} | ` +
        `${winner.currency} ${winner.unit_price} c/u | ${winner.delivery_days}d | ` +
        `${winner.warranty_months}m | ${winner.payment_terms}`;
    } else throw e;
  }

  const { data: rec, error: recErr } = await db.from("recommendations").insert({
    requisition_id,
    winning_quote_id: winner.quote_id,
    scoring: { weights, ranked, savings },   // structured savings lives here; UI localizes it
    reasoning_trace: reasoningTrace,
    savings_vs_baseline: savings.counted ? savings.savings : null,
    baseline_source: savings.counted
      ? `median:${savings.baseline_count}:${savings.category}:${savings.currency}` // machine-readable; UI renders t("savings_baseline_source")
      : "not_counted",
  }).select().single();
  if (recErr || !rec) return NextResponse.json({ error: recErr?.message ?? "insert failed" }, { status: 500 });

  const { error: stErr } = await db.from("requisitions").update({ status: "recommended" }).eq("id", requisition_id);
  if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 });
  await audit.log({ requisition_id, actor: "agent", action: "recommendation.created",
    payload: { recommendation_id: rec.id, winner: winner.vendor_name, savings } });

  return NextResponse.json({ recommendation_id: rec.id, winner: winner.vendor_name });
}
