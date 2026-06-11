"use client";
import { useRouter } from "next/navigation";
import { LOCALES } from "@/lib/types";

export function LocaleSwitcher({ current }: { current: string }) {
  const router = useRouter();
  return (
    <select
      className="rounded border px-2 py-1 text-sm uppercase"
      value={current}
      onChange={(e) => {
        document.cookie = `locale=${e.target.value};path=/;max-age=86400`;
        router.refresh();
      }}
    >
      {LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
    </select>
  );
}
