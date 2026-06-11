import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { resolveLocale } from "@/lib/personas";
import { t, fmtMoney, MsgKey } from "@/lib/i18n";
import { StatusBadge } from "@/app/components/StatusBadge";
import { ApprovalActions } from "@/app/components/ApprovalActions";
import type { CitedRule } from "@/lib/services/policy-engine";
import type { ScoredQuote } from "@/lib/services/quote-scorer";
import type { SavingsResult } from "@/lib/services/savings-calc";

export const dynamic = "force-dynamic";

export default async function ApprovalDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = resolveLocale((await cookies()).get("locale")?.value);
  const db = getDb();

  const { data: r } = await db.from("requisitions").select("*").eq("id", id).single();
  // latest recommendation wins (re-runs may have created several)
  const { data: rec } = await db.from("recommendations")
    .select("*").eq("requisition_id", id).order("created_at", { ascending: false }).limit(1).single();
  if (!r || !rec) notFound();

  const ranked = (rec.scoring.ranked ?? []) as ScoredQuote[];
  const savings = rec.scoring.savings as SavingsResult | undefined;
  const winner = ranked[0];

  return (
    <div className="space-y-6">
      {/* summary */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{(r.raw_text ?? "").slice(0, 100)}</h1>
        <StatusBadge status={r.status} locale={locale} />
      </div>

      {/* policy verdict */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-500">{t(locale, "policy_verdict_title")}</h2>
        <ul className="text-sm">
          {((r.policy_result?.rules_cited ?? []) as CitedRule[]).map((c) => (
            <li key={c.rule_code}>
              <span className="font-mono font-medium">{c.rule_code}</span>{": "}
              {t(locale, c.reason_key as MsgKey, c.params)}
            </li>
          ))}
        </ul>
      </section>

      {/* comparison table — the centerpiece */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-3 font-semibold">{t(locale, "comparison_title")}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="py-2">{t(locale, "th_rank")}</th>
              <th>{t(locale, "th_vendor")}</th>
              <th className="text-right">{t(locale, "th_unit_price")}</th>
              <th className="text-right">{t(locale, "th_total")}</th>
              <th className="text-right">{t(locale, "th_delivery")}</th>
              <th className="text-right">{t(locale, "th_warranty")}</th>
              <th>{t(locale, "th_terms")}</th>
              <th className="text-right">{t(locale, "th_rating")}</th>
              <th className="text-right">{t(locale, "th_score")}</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((q) => (
              <tr key={q.quote_id}
                  className={`border-b last:border-0 ${q.rank === 1 ? "bg-emerald-50 font-medium" : ""}`}>
                <td className="py-2">{q.rank}</td>
                <td>{q.vendor_name}</td>
                <td className="text-right tabular-nums">{fmtMoney(q.unit_price, q.currency, locale)}</td>
                <td className="text-right tabular-nums">{fmtMoney(q.total, q.currency, locale)}</td>
                <td className="text-right tabular-nums">{q.delivery_days}</td>
                <td className="text-right tabular-nums">{q.warranty_months}</td>
                <td>{q.payment_terms}</td>
                <td className="text-right tabular-nums">{q.vendor_rating.toFixed(1)}</td>
                <td className="text-right tabular-nums">{q.total_score.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* reasoning trace — rendered verbatim (spec rule #4) + savings */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 font-semibold">{t(locale, "reasoning_title")}</h2>
        <p className="whitespace-pre-wrap text-sm leading-6">{rec.reasoning_trace}</p>
        <div className="mt-4 rounded bg-slate-50 p-3 text-sm">
          <span className="font-semibold">{t(locale, "savings_label")}: </span>
          {savings?.counted ? (
            <>
              <span className="font-medium text-emerald-700">
                {fmtMoney(savings.savings, savings.currency, locale)}
              </span>{" "}
              {t(locale, "savings_baseline_source",
                 { count: savings.baseline_count, category: savings.category })}
            </>
          ) : (
            <span className="text-slate-500">
              {t(locale, "savings_not_counted", { category: savings?.category ?? r.category })}
            </span>
          )}
        </div>
      </section>

      {r.status === "recommended" && winner && (
        <ApprovalActions requisitionId={id} labels={{
          btn_approve: t(locale, "btn_approve"),
          btn_reject: t(locale, "btn_reject"),
          btn_request_info: t(locale, "btn_request_info"),
          reject_comment_required: t(locale, "reject_comment_required"),
        }} />
      )}
    </div>
  );
}
