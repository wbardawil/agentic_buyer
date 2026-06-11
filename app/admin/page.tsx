import Link from "next/link";
import { cookies } from "next/headers";
import { getDb, getTenant, COMPANY_ID } from "@/lib/db";
import { resolveLocale } from "@/lib/personas";
import { t, fmtMoney, MsgKey } from "@/lib/i18n";
import { saveWeights } from "./actions";
import type { Locale } from "@/lib/types";
import type { SavingsResult } from "@/lib/services/savings-calc";

export const dynamic = "force-dynamic";

const TABS = ["kpis", "rules", "vendors", "audit", "weights"] as const;

export default async function AdminPage({ searchParams }: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab = (TABS as readonly string[]).includes(rawTab ?? "") ? rawTab! : "kpis";
  const locale = resolveLocale((await cookies()).get("locale")?.value);
  const tenant = await getTenant();

  const TAB_LABELS: Record<string, MsgKey> = {
    kpis: "tab_kpis", rules: "tab_rules", vendors: "tab_vendors",
    audit: "tab_audit", weights: "tab_weights",
  };

  return (
    <div className="space-y-4">
      <nav className="flex gap-2 border-b pb-2">
        {TABS.map((k) => (
          <Link key={k} href={`/admin?tab=${k}`}
            className={`rounded px-3 py-1.5 text-sm ${tab === k ? "bg-slate-900 text-white" : "hover:bg-slate-200"}`}>
            {t(locale, TAB_LABELS[k])}
          </Link>
        ))}
      </nav>

      {tab === "kpis" && <Kpis locale={locale} />}
      {tab === "rules" && <Rules locale={locale} currency={tenant.currency} />}
      {tab === "vendors" && <Vendors />}
      {tab === "audit" && <Audit locale={locale} />}
      {tab === "weights" && <Weights locale={locale} weights={tenant.scoring_weights} />}
    </div>
  );
}

async function Kpis({ locale }: { locale: Locale }) {
  const db = getDb();
  // F10: computed live from real tables — the exact instrumentation the pilot will use
  const { data: reqs } = await db.from("requisitions")
    .select("id, status, created_at, policy_result").eq("company_id", COMPANY_ID);
  const { data: pos } = await db.from("purchase_orders").select("requisition_id, issued_at");
  const { data: recs } = await db.from("recommendations").select("requisition_id, scoring");
  const { data: infoReqs } = await db.from("approvals").select("requisition_id").eq("decision", "info_requested");

  const reached = (reqs ?? []).filter((r: { status: string }) => ["recommended", "approved", "po_issued"].includes(r.status));
  const issued = (reqs ?? []).filter((r: { status: string }) => r.status === "po_issued");
  const touched = new Set((infoReqs ?? []).map((a: { requisition_id: string }) => a.requisition_id));
  const touchless = issued.filter((r: { id: string }) => !touched.has(r.id));
  const touchlessPct = reached.length ? Math.round((touchless.length / reached.length) * 100) : 0;

  const savingsPcts = (recs ?? []).flatMap((rec: { scoring: unknown }) => {
    const s = (rec.scoring as { savings?: SavingsResult } | null)?.savings as SavingsResult | undefined;
    if (!s?.counted) return [];
    return [(s.savings / (s.baseline_unit_price * s.qty)) * 100]; // qty carried in SavingsResult
  });
  const avgSavingsPct = savingsPcts.length
    ? (savingsPcts.reduce((a: number, b: number) => a + b, 0) / savingsPcts.length).toFixed(1) : "0.0";

  const byId = new Map((reqs ?? []).map((r: { id: string; created_at: string }) => [r.id, r]));
  const cycleDays = (pos ?? []).flatMap((po: { requisition_id: string; issued_at: string }) => {
    const r = byId.get(po.requisition_id);
    return r ? [(Date.parse(po.issued_at) - Date.parse(r.created_at)) / 86400000] : [];
  });
  const avgCycle = cycleDays.length
    ? (cycleDays.reduce((a: number, b: number) => a + b, 0) / cycleDays.length).toFixed(1) : "—";

  const violations = (reqs ?? []).filter((r: { policy_result?: { verdict?: string } | null }) =>
    r.policy_result && r.policy_result.verdict !== "pass").length;

  const tiles = [
    { label: t(locale, "kpi_touchless"), value: `${touchlessPct}%` },
    { label: t(locale, "kpi_avg_savings"), value: `${avgSavingsPct}%` },
    { label: t(locale, "kpi_cycle_time"), value: `${avgCycle} ${t(locale, "days_suffix")}` },
    { label: t(locale, "kpi_violations"), value: String(violations) },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((k) => (
        <div key={k.label} className="rounded-lg border bg-white p-4">
          <p className="text-3xl font-semibold tabular-nums">{k.value}</p>
          <p className="mt-1 text-sm text-slate-500">{k.label}</p>
        </div>
      ))}
    </div>
  );
}

async function Rules({ locale, currency }: { locale: Locale; currency: string }) {
  const { data } = await getDb().from("policies").select("*")
    .eq("company_id", COMPANY_ID).order("rule_code");
  return (
    <table className="w-full rounded-lg border bg-white text-sm">
      <tbody>
        {(data ?? []).map((p: {
          id: string; rule_code: string; category: string | null; action: string;
          max_amount: string | number | null; approval_route: string; active: boolean;
        }) => (
          <tr key={p.id} className="border-b last:border-0">
            <td className="px-4 py-2 font-mono font-medium">{p.rule_code}</td>
            <td className="px-4 py-2">{p.category ?? "*"}</td>
            <td className="px-4 py-2">{p.action}</td>
            <td className="px-4 py-2 text-right tabular-nums">
              {p.max_amount ? fmtMoney(Number(p.max_amount), currency, locale) : "—"}
            </td>
            <td className="px-4 py-2">{p.approval_route}</td>
            <td className="px-4 py-2">{p.active ? "✓" : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function Vendors() {
  const { data } = await getDb().from("vendors").select("*")
    .eq("company_id", COMPANY_ID).order("name");
  return (
    <table className="w-full rounded-lg border bg-white text-sm">
      <tbody>
        {(data ?? []).map((v: {
          id: string; name: string; categories: string[]; status: string;
          rating: string | number; notes: string | null;
        }) => (
          <tr key={v.id} className={`border-b last:border-0 ${v.status === "blocked" ? "bg-red-50" : ""}`}>
            <td className="px-4 py-2 font-medium">{v.name}</td>
            <td className="px-4 py-2">{v.categories.join(", ")}</td>
            <td className="px-4 py-2">{v.status}</td>
            <td className="px-4 py-2 text-right tabular-nums">{Number(v.rating).toFixed(1)}</td>
            <td className="px-4 py-2 text-slate-500">{v.notes}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function Audit({ locale }: { locale: Locale }) {
  const { data } = await getDb().from("audit_log").select("*")
    .eq("company_id", COMPANY_ID).order("created_at", { ascending: false }).limit(100);
  return (
    <div className="rounded-lg border bg-white">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="font-semibold">{t(locale, "audit_title")}</h2>
        <a className="text-sm text-blue-700 hover:underline" href="/api/audit/export">
          {t(locale, "btn_export_csv")}
        </a>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {(data ?? []).map((a: {
            id: string; created_at: string; actor: string;
            action: string; requisition_id: string | null;
          }) => (
            <tr key={a.id} className="border-b last:border-0">
              <td className="px-4 py-1.5 tabular-nums">{new Date(a.created_at).toLocaleString()}</td>
              <td className="px-4 py-1.5">{a.actor.length > 12 ? a.actor.slice(0, 8) : a.actor}</td>
              <td className="px-4 py-1.5 font-mono text-xs">{a.action}</td>
              <td className="px-4 py-1.5 font-mono text-xs text-slate-400">
                {a.requisition_id?.slice(0, 8) ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Weights({ locale, weights }: {
  locale: Locale;
  weights: Record<string, number>;
}) {
  return (
    <form action={saveWeights} className="max-w-md space-y-3 rounded-lg border bg-white p-4">
      {(["price", "delivery", "terms", "rating"] as const).map((k) => (
        <label key={k} className="flex items-center justify-between gap-3 text-sm">
          <span className="capitalize">{k}</span>
          <input name={k} type="number" step="0.05" min="0" max="1"
            defaultValue={weights[k]} className="w-24 rounded border p-1.5 text-right" />
        </label>
      ))}
      <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white">
        {t(locale, "btn_save_weights")}
      </button>
    </form>
  );
}
