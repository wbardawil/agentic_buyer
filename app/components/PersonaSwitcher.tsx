"use client";
import { useRouter } from "next/navigation";

export function PersonaSwitcher({ current, labels }: {
  current: string;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <select
      className="rounded border px-2 py-1 text-sm"
      value={current}
      onChange={(e) => {
        document.cookie = `persona=${e.target.value};path=/;max-age=86400`;
        router.refresh();
      }}
    >
      {Object.entries(labels).map(([k, label]) => (
        <option key={k} value={k}>{label}</option>
      ))}
    </select>
  );
}
