"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button onClick={() => window.print()}
      className="mt-8 rounded border px-4 py-2 text-sm print:hidden">
      {label}
    </button>
  );
}
