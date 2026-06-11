import Link from "next/link";
import { cookies } from "next/headers";
import { getDb, COMPANY_ID } from "@/lib/db";
import { resolveLocale } from "@/lib/personas";
import { t, fmtMoney } from "@/lib/i18n";
import { StatusBadge } from "@/app/components/StatusBadge";
import { NewRequestForm } from "@/app/components/NewRequestForm";

export const dynamic = "force-dynamic";

export default async function SolicitudesPage() {
  const locale = resolveLocale((await cookies()).get("locale")?.value);
  const { data: reqs } = await getDb().from("requisitions")
    .select("*").eq("company_id", COMPANY_ID).order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <NewRequestForm labels={{
        form_title: t(locale, "form_title"), form_raw_text: t(locale, "form_raw_text"),
        form_budget: t(locale, "form_budget"), form_need_by: t(locale, "form_need_by"),
        form_submit: t(locale, "form_submit"), form_clarification: t(locale, "form_clarification"),
        form_answer_send: t(locale, "form_answer_send"),
      }} />
      <div className="rounded-lg border bg-white">
        <h2 className="border-b px-4 py-3 font-semibold">{t(locale, "requests_title")}</h2>
        <table className="w-full text-sm">
          <tbody>
            {(reqs ?? []).map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link className="text-blue-700 hover:underline" href={`/solicitudes/${r.id}`}>
                    {r.raw_text.slice(0, 80)}
                  </Link>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.estimated_amount ? fmtMoney(Number(r.estimated_amount), r.currency, locale) : "—"}
                </td>
                <td className="px-4 py-2"><StatusBadge status={r.status} locale={locale} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
