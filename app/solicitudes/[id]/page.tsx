import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { resolveLocale, resolvePersona } from "@/lib/personas";
import { t, MsgKey } from "@/lib/i18n";
import { StatusBadge } from "@/app/components/StatusBadge";
import { PipelineControls } from "@/app/components/PipelineControls";
import type { CitedRule } from "@/lib/services/policy-engine";

export const dynamic = "force-dynamic";

export default async function RequisitionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jar = await cookies();
  const locale = resolveLocale(jar.get("locale")?.value);
  const persona = resolvePersona(jar.get("persona")?.value);
  const db = getDb();

  const { data: r } = await db.from("requisitions").select("*").eq("id", id).single();
  if (!r) return <p>404</p>;
  const { data: audit } = await db.from("audit_log").select("*")
    .eq("requisition_id", id).order("created_at", { ascending: true });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{r.raw_text.slice(0, 100)}</h1>
        <StatusBadge status={r.status} locale={locale} />
      </div>

      {persona === "admin" && (
        <PipelineControls requisitionId={id} status={r.status} labels={{
          btn_source: t(locale, "btn_source"),
          btn_simulate_replies: t(locale, "btn_simulate_replies"),
          btn_recommend: t(locale, "btn_recommend"),
        }} />
      )}

      {r.policy_result && (
        <section className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 font-semibold">{t(locale, "policy_verdict_title")}:{" "}
            {t(locale, `policy_${r.policy_result.verdict === "pass" ? "pass" : r.policy_result.verdict}` as MsgKey)}
          </h2>
          <ul className="list-disc pl-5 text-sm">
            {(r.policy_result.rules_cited as CitedRule[]).map((c, i) => (
              <li key={i}>
                <span className="font-mono font-medium">{c.rule_code}</span>{": "}
                {t(locale, c.reason_key as MsgKey, c.params)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 font-semibold">{t(locale, "audit_title")}</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500">
            <th className="py-1">{t(locale, "audit_when")}</th>
            <th>{t(locale, "audit_actor")}</th>
            <th>{t(locale, "audit_action")}</th>
          </tr></thead>
          <tbody>
            {(audit ?? []).map((a) => (
              <tr key={a.id} className="border-t">
                <td className="py-1 tabular-nums">{new Date(a.created_at).toLocaleString()}</td>
                <td>{a.actor}</td>
                <td className="font-mono text-xs">{a.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <a className="mt-2 inline-block text-sm text-blue-700 hover:underline"
           href={`/api/audit/export?requisition_id=${id}`}>
          {t(locale, "btn_export_csv")}
        </a>
      </section>
    </div>
  );
}
