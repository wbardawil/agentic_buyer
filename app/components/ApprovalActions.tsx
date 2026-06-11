"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ApprovalActions({ requisitionId, labels }: {
  requisitionId: string; labels: Record<string, string>;
}) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected" | "info_requested") {
    if (decision === "rejected" && !comment.trim()) {
      setError(labels.reject_comment_required); return;
    }
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requisition_id: requisitionId, decision, comment: comment || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? `HTTP ${res.status}`); return; }
      if (data.status === "po_issued" && data.po_id) router.push(`/po/${data.po_id}`);
      else router.refresh();
    } catch {
      setError("network_error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <input className="mb-3 w-full rounded border p-2 text-sm"
        placeholder={labels.comment_placeholder} aria-label={labels.comment_placeholder}
        value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="flex gap-3">
        <button className="rounded bg-emerald-600 px-5 py-2 font-medium text-white disabled:opacity-50"
          disabled={busy} onClick={() => decide("approved")}>{labels.btn_approve}</button>
        <button className="rounded bg-red-600 px-5 py-2 font-medium text-white disabled:opacity-50"
          disabled={busy} onClick={() => decide("rejected")}>{labels.btn_reject}</button>
        <button className="rounded border px-5 py-2 font-medium disabled:opacity-50"
          disabled={busy} onClick={() => decide("info_requested")}>{labels.btn_request_info}</button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
