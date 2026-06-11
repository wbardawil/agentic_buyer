import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb, getTenant } from "@/lib/db";
import { resolveLocale } from "@/lib/personas";
import { t, fmtMoney } from "@/lib/i18n";
import { PrintButton } from "@/app/components/PrintButton";
import type { StructuredRequisition } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Shape of the vendors many-to-one join row. */
interface VendorRow {
  name: string;
  contact_email: string;
  tax_id: string | null;
}

/** Shape of the requisitions many-to-one join row. */
interface RequisitionRow {
  raw_text: string;
  structured: StructuredRequisition;
  need_by: string | null;
}

export default async function POView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = resolveLocale((await cookies()).get("locale")?.value);
  const db = getDb();
  const tenant = await getTenant();

  const { data: poRaw } = await db.from("purchase_orders")
    .select("*, vendors(name, contact_email, tax_id), requisitions(raw_text, structured, need_by)")
    .eq("id", id).single();
  if (!poRaw) notFound();

  // Supabase's generic SupabaseClient doesn't know the join shape — cast locally.
  const po = poRaw as typeof poRaw & {
    vendors: VendorRow;
    requisitions: RequisitionRow;
  };

  const structured = po.requisitions.structured as StructuredRequisition;

  return (
    <div className="mx-auto max-w-2xl bg-white p-10 shadow print:shadow-none">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t(locale, "po_title")}</h1>
          <p className="font-mono text-lg">{po.po_number}</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold">{tenant.name}</p>
          <p>{t(locale, "po_issued_at")}: {new Date(po.issued_at).toLocaleDateString()}</p>
          <p>{t(locale, "po_erp_ref")}: <span className="font-mono">{po.erp_ref}</span></p>
        </div>
      </div>

      <div className="mb-6 text-sm">
        <p className="font-semibold">{t(locale, "po_vendor")}: {po.vendors.name}</p>
        <p className="text-slate-500">{po.vendors.contact_email}</p>
        {po.vendors.tax_id && <p className="text-slate-500">RFC/Tax ID: {po.vendors.tax_id}</p>}
      </div>

      <table className="mb-6 w-full text-sm">
        <thead><tr className="border-b text-left">
          <th className="py-2">Item</th><th className="text-right">Qty</th>
        </tr></thead>
        <tbody>
          {structured.items.map((it, i) => (
            <tr key={i} className="border-b">
              <td className="py-2">{it.description}</td>
              <td className="py-2 text-right tabular-nums">{it.qty} {it.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-right text-xl font-semibold tabular-nums">
        {t(locale, "po_total")}: {fmtMoney(Number(po.total), po.currency, locale)}
      </p>

      <PrintButton label={t(locale, "po_print")} />
    </div>
  );
}
