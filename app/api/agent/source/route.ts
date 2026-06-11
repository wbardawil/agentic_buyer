import { NextResponse } from "next/server";
import { getDb, getTenant, COMPANY_ID } from "@/lib/db";
import { createAuditLogger } from "@/lib/services/audit-logger";
import { draftRFQ } from "@/lib/agent/tasks";
import { AgentValidationError } from "@/lib/agent/client";
import { getMailer } from "@/lib/adapters/mailer";
import type { StructuredRequisition } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const db = getDb();
  const audit = createAuditLogger(db, COMPANY_ID);
  const { requisition_id } = await req.json() as { requisition_id: string };
  if (!requisition_id) return NextResponse.json({ error: "requisition_id_required" }, { status: 400 });

  const { data: r, error } = await db.from("requisitions").select("*").eq("id", requisition_id).single();
  if (error || !r) return NextResponse.json({ error: "requisition not found" }, { status: 404 });
  if (r.status !== "sourcing") return NextResponse.json({ error: `invalid status: ${r.status}` }, { status: 409 });
  const structured = r.structured as StructuredRequisition;

  // [4] Vendor discovery — deterministic selection, rationale logged per vendor (F3)
  const { data: vendors } = await db.from("vendors")
    .select("*").eq("company_id", COMPANY_ID).contains("categories", [r.category]);
  const approved = (vendors ?? []).filter(v => v.status === "approved")
    .sort((a, b) => Number(b.rating) - Number(a.rating));
  const open = (vendors ?? []).filter(v => v.status === "open")
    .sort((a, b) => Number(b.rating) - Number(a.rating)).slice(0, 2);
  const blocked = (vendors ?? []).filter(v => v.status === "blocked");
  const selected = [...approved, ...open].slice(0, 5);

  if (selected.length < 3) {
    await audit.log({ requisition_id, actor: "agent", action: "sourcing.insufficient_vendors",
      payload: { found: selected.length } });
    return NextResponse.json({ error: "fewer than 3 vendors available" }, { status: 422 });
  }

  // rationale is locale-neutral (reason_key + params); audit payloads never carry rendered copy
  await audit.log({ requisition_id, actor: "agent", action: "vendors.selected", payload: {
    selected: selected.map(v => ({
      id: v.id, name: v.name, status: v.status, rating: v.rating,
      rationale: v.status === "approved"
        ? { reason_key: "vendor_selected_approved", params: { category: r.category, rating: v.rating } }
        : { reason_key: "vendor_selected_open_competition", params: { rating: v.rating } },
    })),
    excluded_blocked: blocked.map(v => ({
      id: v.id, name: v.name,
      rationale: { reason_key: "vendor_excluded_blocked", params: { notes: v.notes ?? "" } },
    })),
  }});

  // [5] RFQ generation — identical specs block for every vendor (F4)
  const specs = [
    ...structured.items.map(i => `- ${i.qty} x ${i.description} (${i.unit})`),
    structured.need_by ? `Fecha requerida de entrega: ${structured.need_by}` : "",
  ].filter(Boolean).join("\n");
  const replyDeadline = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  const mailer = getMailer();
  const tenant = await getTenant();
  const ctx = { locale: tenant.locale, currency: tenant.currency };

  const rfqIds: string[] = [];
  for (const vendor of selected) {
    let rfqDraft;
    try {
      rfqDraft = await draftRFQ({
        vendor_name: vendor.name, specs, reply_deadline: replyDeadline,
        company_name: tenant.name,
      }, ctx);
    } catch (e) {
      if (e instanceof AgentValidationError) {
        await audit.log({ requisition_id, actor: "agent", action: "agent.error",
          payload: { step: "draft_rfq", vendor: vendor.name, error: e.lastValidationError } });
        continue; // skip this vendor, keep the rest
      }
      throw e;
    }
    const sent = await mailer.send({ to: vendor.contact_email, subject: rfqDraft.subject, body: rfqDraft.body_text });
    const { data: rfqRow, error: rfqErr } = await db.from("rfqs").insert({
      requisition_id, vendor_id: vendor.id, body_text: rfqDraft.body_text,
      sent_at: sent.sent_at, status: "sent",
    }).select().single();
    if (rfqErr || !rfqRow) {
      await audit.log({ requisition_id, actor: "system", action: "rfq.insert_failed",
        payload: { vendor: vendor.name, error: rfqErr?.message ?? "no row" } });
      continue;
    }
    rfqIds.push(rfqRow.id);
    await audit.log({ requisition_id, actor: "agent", action: "rfq.sent",
      payload: { rfq_id: rfqRow.id, vendor: vendor.name, to: vendor.contact_email, subject: rfqDraft.subject } });
  }

  return NextResponse.json({ rfqs_sent: rfqIds.length });
}
