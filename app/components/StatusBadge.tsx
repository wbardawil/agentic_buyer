import { t, MsgKey } from "@/lib/i18n";
import type { Locale, RequisitionStatus } from "@/lib/types";

const COLORS: Record<RequisitionStatus, string> = {
  intake: "bg-slate-200 text-slate-700",
  policy_check: "bg-slate-200 text-slate-700",
  sourcing: "bg-blue-100 text-blue-800",
  quoted: "bg-indigo-100 text-indigo-800",
  recommended: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  po_issued: "bg-emerald-200 text-emerald-900",
  flagged: "bg-orange-100 text-orange-800",
};

export function StatusBadge({ status, locale }: { status: RequisitionStatus; locale: Locale }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[status]}`}>
      {t(locale, `status_${status}` as MsgKey)}
    </span>
  );
}
