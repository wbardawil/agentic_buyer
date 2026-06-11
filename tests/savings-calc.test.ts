import { describe, it, expect } from "vitest";
import { computeSavings, median } from "@/lib/services/savings-calc";

describe("median", () => {
  it("handles odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("computeSavings", () => {
  it("computes savings vs median baseline unit price with a structured source", () => {
    const r = computeSavings({
      category: "computo", qty: 8, winning_unit_price: 22000, currency: "MXN",
      baseline_unit_prices: [23800, 24500, 25200, 24400, 26500, 24600],
    });
    expect(r.counted).toBe(true);
    if (r.counted) {
      expect(r.baseline_unit_price).toBe(24550); // median of the six
      expect(r.savings).toBe((24550 - 22000) * 8);
      expect(r.currency).toBe("MXN");
      // locale-neutral source: UI renders via t("savings_baseline_source", params)
      expect(r.baseline_count).toBe(6);
      expect(r.qty).toBe(8); // carried through so KPI tiles can compute savings %
      expect(r.category).toBe("computo");
    }
  });

  it("never guesses: no baseline → not counted (F8 AC)", () => {
    const r = computeSavings({
      category: "servicios", qty: 1, winning_unit_price: 5000, currency: "MXN",
      baseline_unit_prices: [],
    });
    expect(r.counted).toBe(false);
    if (!r.counted) expect(r.category).toBe("servicios"); // UI renders t("savings_not_counted", {category})
  });
});
