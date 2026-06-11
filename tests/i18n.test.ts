import { describe, it, expect } from "vitest";
import { dict, t, fmtMoney } from "@/lib/i18n";
import { LOCALES } from "@/lib/types";

describe("i18n dictionaries", () => {
  it("every locale defines exactly the same keys (no missing translations)", () => {
    const esKeys = Object.keys(dict.es).sort();
    for (const loc of LOCALES) {
      expect(Object.keys(dict[loc]).sort()).toEqual(esKeys);
    }
  });

  it("interpolates params", () => {
    expect(t("en", "policy_blocked_category", { category: "viajes", rule_code: "R-06" }))
      .toBe("Category 'viajes' is blocked by rule R-06");
    expect(t("pt", "policy_blocked_category", { category: "viajes", rule_code: "R-06" }))
      .toContain("R-06");
  });

  it("formats money per currency and locale", () => {
    expect(fmtMoney(180000, "MXN", "es")).toMatch(/180,000/); // $180,000.00 (es-MX)
    expect(fmtMoney(180000, "USD", "en")).toContain("$180,000.00");
    expect(fmtMoney(180000, "BRL", "pt")).toMatch(/180\.000/); // R$ 180.000,00
  });
});
