import { NextResponse } from "next/server";
import { getDb, getTenant, COMPANY_ID } from "@/lib/db";
import { createAuditLogger } from "@/lib/services/audit-logger";
import { simulateVendorReply, REPLY_PROFILES } from "@/lib/agent/tasks";
import { AgentValidationError } from "@/lib/agent/client";
import type { StructuredRequisition } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const db = getDb();
  const audit = createAuditLogger(db, COMPANY_ID);
  const { requisition_id } = await req.json() as { requisition_id: string };
  if (!requisition_id) return NextResponse.json({ error: "requisition_id_required" }, { status: 400 });

  const { data: r } = await db.from("requisitions").select("*").eq("id", requisition_id).single();
  if (!r) return NextResponse.json({ error: "requisition not found" }, { status: 404 });
  const structured = r.structured as StructuredRequisition;

  const { data: rfqs } = await db.from("rfqs")
    .select("*, vendors(name)").eq("requisition_id", requisition_id).eq("status", "sent");
  if (!rfqs?.length) return NextResponse.json({ error: "no pending RFQs" }, { status: 409 });

  const tenant = await getTenant();
  const ctx = { locale: tenant.locale, currency: tenant.currency };

  let replies = 0;
  for (const [i, rfq] of rfqs.entries()) {
    // profile rotation guarantees varied quotes incl. one intentionally weak (F4 AC)
    const profile = REPLY_PROFILES[i % REPLY_PROFILES.length];
    let replyText: string;
    try {
      replyText = await simulateVendorReply({
        rfq_body: rfq.body_text,
        vendor_name: (rfq.vendors as { name: string }).name,
        profile,
        budget_reference: structured.estimated_amount,
      }, ctx);
    } catch (e) {
      if (e instanceof AgentValidationError) {
        await audit.log({ requisition_id, actor: "agent", action: "agent.error",
          payload: { step: "simulate_vendor_reply", rfq_id: rfq.id, error: e.lastValidationError } });
        continue;
      }
      throw e;
    }
    const { error: qErr } = await db.from("quotes").insert({ rfq_id: rfq.id, vendor_id: rfq.vendor_id, raw_reply: replyText });
    if (qErr) {
      await audit.log({ requisition_id, actor: "system", action: "quote.insert_failed",
        payload: { rfq_id: rfq.id, error: qErr.message } });
      continue;
    }
    await db.from("rfqs").update({ status: "replied" }).eq("id", rfq.id);
    await audit.log({ requisition_id, actor: "system", action: "quote.received",
      payload: { rfq_id: rfq.id, vendor: (rfq.vendors as { name: string }).name, simulated: true, profile } });
    replies++;
  }

  if (replies > 0) {
    const { error: stErr } = await db.from("requisitions").update({ status: "quoted" }).eq("id", requisition_id);
    if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 });
  }
  return NextResponse.json({ replies });
}
