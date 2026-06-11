import { getDb, COMPANY_ID } from "@/lib/db";

export const runtime = "nodejs";

function csvCell(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  // neutralize spreadsheet formula injection — audit CSVs get opened in Excel
  const safe = /^[=+@\-\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const reqId = url.searchParams.get("requisition_id");
  const db = getDb();

  let q = db.from("audit_log").select("*").eq("company_id", COMPANY_ID)
    .order("created_at", { ascending: true });
  if (reqId) q = q.eq("requisition_id", reqId);
  const { data, error } = await q;
  if (error) return new Response(error.message, { status: 500 });

  const header = "created_at,requisition_id,actor,action,payload";
  const rows = (data ?? []).map(r =>
    [r.created_at, r.requisition_id ?? "", r.actor, r.action, r.payload]
      .map(csvCell).join(","));
  return new Response([header, ...rows].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="auditoria${reqId ? `-${reqId}` : ""}.csv"`,
    },
  });
}
