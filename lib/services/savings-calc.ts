/** Locale-neutral result — UI renders via t("savings_baseline_source" | "savings_not_counted"). */
export type SavingsResult =
  | { counted: true; savings: number; currency: string; baseline_unit_price: number;
      baseline_count: number; qty: number; category: string }
  | { counted: false; category: string };

/** @param values must be non-empty — an empty array yields NaN */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Savings vs trailing-history median of SAME-CURRENCY baselines. Never invents a number (spec F8). */
export function computeSavings(opts: {
  category: string;
  qty: number;
  winning_unit_price: number;
  currency: string;
  baseline_unit_prices: number[]; // caller pre-filters to the same currency (no FX in v0)
}): SavingsResult {
  if (opts.baseline_unit_prices.length === 0) {
    return { counted: false, category: opts.category };
  }
  const baseline = median(opts.baseline_unit_prices);
  return {
    counted: true,
    savings: (baseline - opts.winning_unit_price) * opts.qty,
    currency: opts.currency,
    baseline_unit_price: baseline,
    baseline_count: opts.baseline_unit_prices.length,
    qty: opts.qty,
    category: opts.category,
  };
}
