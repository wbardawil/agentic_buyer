"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const STEPS = [
  { key: "source", url: "/api/agent/source", forStatus: "sourcing" },
  { key: "simulate", url: "/api/agent/simulate-replies", forStatus: "sourcing" },
  { key: "recommend", url: "/api/agent/recommend", forStatus: "quoted" },
] as const;

export function PipelineControls({ requisitionId, status, labels }: {
  requisitionId: string; status: string; labels: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(step: (typeof STEPS)[number]) {
    setBusy(step.key); setError(null);
    const res = await fetch(step.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requisition_id: requisitionId }),
    });
    setBusy(null);
    if (!res.ok) { setError((await res.json()).error ?? "error"); return; }
    router.refresh();
  }

  const buttons = [
    { step: STEPS[0], label: labels.btn_source, show: status === "sourcing" },
    { step: STEPS[1], label: labels.btn_simulate_replies, show: status === "sourcing" },
    { step: STEPS[2], label: labels.btn_recommend, show: status === "quoted" },
  ].filter(b => b.show);

  if (!buttons.length) return null;
  return (
    <div className="flex gap-2">
      {buttons.map(({ step, label }) => (
        <button key={step.key}
          className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          disabled={busy !== null} onClick={() => run(step)}>
          {busy === step.key ? "…" : label}
        </button>
      ))}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
