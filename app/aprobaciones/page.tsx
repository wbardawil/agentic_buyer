import Link from "next/link";
import { cookies } from "next/headers";
import { getDb, COMPANY_ID } from "@/lib/db";
import { resolveLocale } from "@/lib/personas";
import { t, fmtMoney } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function AprobacionesPage() {
  const locale = resolveLocale((await cookies()).get("locale")?.value);
  const { data: reqs } = await getDb().from("requisitions")
    .select("*").eq("company_id", COMPANY_ID).eq("status", "recommended")
    .order("created_at", { ascending: true });

  return (
    <div className="rounded-lg border bg-white">
      <h1 className="border-b px-4 py-3 font-semibold">{t(locale, "approvals_title")}</h1>
      {!reqs?.length && <p className="px-4 py-6 text-sm text-slate-500">{t(locale, "empty_queue")}</p>}
      {(reqs ?? []).map((r) => (
        <Link key={r.id} href={`/aprobaciones/${r.id}`}
          className="flex items-center justify-between border-b px-4 py-3 last:border-0 hover:bg-slate-50">
          <span>{(r.raw_text ?? "").slice(0, 90)}</span>
          <span className="tabular-nums font-medium">
            {r.estimated_amount ? fmtMoney(Number(r.estimated_amount), r.currency, locale) : "—"}
          </span>
        </Link>
      ))}
    </div>
  );
}
