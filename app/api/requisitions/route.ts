export const runtime = "nodejs"; // loadPrompt uses fs — must run on Node, not Edge

import { NextResponse } from "next/server";
import { getDb, getTenant, COMPANY_ID } from "@/lib/db";
import { createAuditLogger } from "@/lib/services/audit-logger";
import { evaluatePolicy, PolicyRule } from "@/lib/services/policy-engine";
import { parseRequisition } from "@/lib/agent/tasks";
import { AgentValidationError } from "@/lib/agent/client";
import { PERSONAS } from "@/lib/personas";

export async function GET() {
  const db = getDb();
  const { data, error } = await db
    .from("requisitions")
    .select("*")
    .eq("company_id", COMPANY_ID)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const db = getDb();
  const audit = createAuditLogger(db, COMPANY_ID);
  const body = await req.json() as {
    raw_text: string; category_hint?: string; budget?: number;
    need_by?: string; clarification_answered?: boolean;
  };
  if (!body.raw_text || typeof body.raw_text !== "string") {
    return NextResponse.json({ error: "raw_text_required" }, { status: 400 });
  }

  // [2] AGENT — intake & structuring (in the tenant's language/currency)
  const tenant = await getTenant();
  const ctx = { locale: tenant.locale, currency: tenant.currency };
  let structured;
  try {
    structured = await parseRequisition(body, ctx);
  } catch (e) {
    if (e instanceof AgentValidationError) {
      await audit.log({ requisition_id: null, actor: "agent", action: "agent.error",
        payload: { step: "parse_requisition", error: e.lastValidationError, raw_text: body.raw_text } });
      return NextResponse.json({ error: "could_not_parse_request" }, { status: 422 }); // UI renders t(error)
    }
    throw e;
  }

  // One clarifying question max (F1 AC): bounce back without persisting
  if (structured.clarifying_question && !body.clarification_answered) {
    return NextResponse.json({ needs_clarification: true, question: structured.clarifying_question });
  }

  const { data: reqRow, error: insErr } = await db.from("requisitions").insert({
    company_id: COMPANY_ID,
    requester_id: PERSONAS.requester.id,
    raw_text: body.raw_text,
    structured,
    category: structured.category,
    estimated_amount: structured.estimated_amount,
    currency: tenant.currency,
    need_by: structured.need_by,
    status: "policy_check",
  }).select().single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  await audit.log({ requisition_id: reqRow.id, actor: "agent",
    action: "requisition.parsed", payload: structured });

  // [3] POLICY ENGINE — deterministic
  const { data: ruleRows, error: rulesErr } = await db.from("policies")
    .select("*").eq("company_id", COMPANY_ID);
  if (rulesErr) return NextResponse.json({ error: rulesErr.message }, { status: 500 });

  const verdict = evaluatePolicy(ruleRows as PolicyRule[], {
    category: structured.category,
    estimated_amount: structured.estimated_amount,
  });

  const status =
    verdict.verdict === "reject" ? "rejected" :
    verdict.verdict === "flag" ? "flagged" : "sourcing";

  const { error: updErr } = await db.from("requisitions")
    .update({ policy_result: verdict, status }).eq("id", reqRow.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  await audit.log({ requisition_id: reqRow.id, actor: "system",
    action: "policy.evaluated", payload: verdict });

  return NextResponse.json({ id: reqRow.id, status, policy_result: verdict, structured });
}
