"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewRequestForm({ labels }: { labels: Record<string, string> }) {
  const router = useRouter();
  const [rawText, setRawText] = useState("");
  const [budget, setBudget] = useState("");
  const [needBy, setNeedBy] = useState("");
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(clarified: boolean) {
    setBusy(true); setError(null);
    const res = await fetch("/api/requisitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        raw_text: clarified ? `${rawText}\n[Aclaración] ${answer}` : rawText,
        budget: budget ? Number(budget) : undefined,
        need_by: needBy || undefined,
        clarification_answered: clarified,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "error"); return; }
    if (data.needs_clarification) { setQuestion(data.question); return; }
    setQuestion(null); setRawText(""); setBudget(""); setNeedBy(""); setAnswer("");
    router.refresh();
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="mb-3 font-semibold">{labels.form_title}</h2>
      <textarea
        className="mb-2 w-full rounded border p-2" rows={3}
        placeholder={labels.form_raw_text}
        value={rawText} onChange={(e) => setRawText(e.target.value)}
      />
      <div className="mb-2 flex gap-2">
        <input className="w-40 rounded border p-2" type="number" placeholder={labels.form_budget}
          value={budget} onChange={(e) => setBudget(e.target.value)} />
        <input className="w-44 rounded border p-2" type="date" title={labels.form_need_by}
          value={needBy} onChange={(e) => setNeedBy(e.target.value)} />
        <button
          className="ml-auto rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
          disabled={busy || !rawText.trim()} onClick={() => submit(false)}>
          {labels.form_submit}
        </button>
      </div>
      {question && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-medium">{labels.form_clarification} {question}</p>
          <div className="flex gap-2">
            <input className="flex-1 rounded border p-2" value={answer}
              onChange={(e) => setAnswer(e.target.value)} />
            <button className="rounded bg-amber-600 px-3 py-2 text-white disabled:opacity-50"
              disabled={busy || !answer.trim()} onClick={() => submit(true)}>
              {labels.form_answer_send}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
