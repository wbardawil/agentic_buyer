import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb, COMPANY_ID } from "@/lib/db";
import { createAuditLogger } from "@/lib/services/audit-logger";
import { getERPAdapter } from "@/lib/adapters/erp";
import { PERSONAS, resolvePersona } from "@/lib/personas";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const db = getDb();
  const audit = createAuditLogger(db, COMPANY_ID);
  const body = await req.json() as {
    requisition_id: string;
    decision: "approved" | "rejected" | "info_requested";
    comment?: string;
  };
  if (!body.requisition_id) return NextResponse.json({ error: "requisition_id_required" }, { status: 400 });
  if (!["approved", "rejected", "info_requested"].includes(body.decision)) {
    return NextResponse.json({ error: "invalid_decision" }, { status: 400 });
  }

  const persona = resolvePersona((await cookies()).get("persona")?.value);
  const approverId = PERSONAS[persona].id; // demo: persona switcher stands in for auth

  if (body.decision === "rejected" && !body.comment?.trim()) {
    return NextResponse.json({ error: "rejection requires a comment" }, { status: 400 });
  }

  const { data: r, error: rErr } = await db.from("requisitions").select("*").eq("id", body.requisition_id).single();
  if (rErr || !r) return NextResponse.json({ error: "requisition not found" }, { status: 404 });
  if (r.status !== "recommended") return NextResponse.json({ error: `invalid status: ${r.status}` }, { status: 409 });

  const { error: apErr } = await db.from("approvals").insert({
    requisition_id: body.requisition_id, approver_id: approverId,
    decision: body.decision, comment: body.comment ?? null,
  });
  if (apErr) return NextResponse.json({ error: apErr.message }, { status: 500 });
  await audit.log({ requisition_id: body.requisition_id, actor: approverId,
    action: `approval.${body.decision}`, payload: { comment: body.comment ?? null } });

  if (body.decision === "rejected") {
    const { error: stErr } = await db.from("requisitions").update({ status: "rejected" }).eq("id", body.requisition_id);
    if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 });
    return NextResponse.json({ status: "rejected" });
  }
  if (body.decision === "info_requested") {
    return NextResponse.json({ status: "recommended", info_requested: true });
  }

  // [8] PO generation via stub ERP adapter (F7) — latest recommendation wins
  const { data: rec, error: recErr } = await db.from("recommendations")
    .select("*, quotes:winning_quote_id(id, normalized, vendor_id, vendors(name))")
    .eq("requisition_id", body.requisition_id)
    .order("created_at", { ascending: false }).limit(1).single();
  if (recErr || !rec) return NextResponse.json({ error: "recommendation not found" }, { status: 500 });
  const winningQuote = rec.quotes as {
    id: string; normalized: { total: number; currency: string };
    vendor_id: string; vendors: { name: string };
  };
  const poCurrency = winningQuote.normalized.currency; // PO inherits the quote's currency

  const { count } = await db.from("purchase_orders").select("*", { count: "exact", head: true });
  const poNumber = `PO-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(4, "0")}`;

  const erp = getERPAdapter();
  const { erp_ref } = await erp.createPO({
    po_number: poNumber, vendor_name: winningQuote.vendors.name,
    total: winningQuote.normalized.total, currency: poCurrency,
  });

  const { data: po, error: poErr } = await db.from("purchase_orders").insert({
    requisition_id: body.requisition_id, vendor_id: winningQuote.vendor_id,
    po_number: poNumber, total: winningQuote.normalized.total, currency: poCurrency, erp_ref,
  }).select().single();
  if (poErr || !po) return NextResponse.json({ error: poErr?.message ?? "po insert failed" }, { status: 500 });

  const { error: stErr } = await db.from("requisitions").update({ status: "po_issued" }).eq("id", body.requisition_id);
  if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 });
  await audit.log({ requisition_id: body.requisition_id, actor: "system",
    action: "po.issued", payload: { po_number: poNumber, erp_ref, total: winningQuote.normalized.total, currency: poCurrency } });
  await audit.log({ requisition_id: body.requisition_id, actor: "system",
    action: "requester.notified", payload: { channel: "simulated", to: PERSONAS.requester.name } });

  return NextResponse.json({ status: "po_issued", po_id: po.id, po_number: poNumber, erp_ref });
}
