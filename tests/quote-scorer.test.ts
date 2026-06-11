import { describe, it, expect } from "vitest";
import { scoreQuotes, paymentTermsScore, ScorableQuote } from "@/lib/services/quote-scorer";

const W = { price: 0.5, delivery: 0.2, terms: 0.15, rating: 0.15 };

const quotes: ScorableQuote[] = [
  { quote_id: "q1", vendor_id: "v1", vendor_name: "TecnoMex", vendor_rating: 4.5,
    unit_price: 22000, total: 176000, currency: "MXN", delivery_days: 7, warranty_months: 12, payment_terms: "30 días de crédito" },
  { quote_id: "q2", vendor_id: "v2", vendor_name: "CompuPlus", vendor_rating: 3.5,
    unit_price: 21000, total: 168000, currency: "MXN", delivery_days: 21, warranty_months: 12, payment_terms: "anticipo 100%" },
  { quote_id: "q3", vendor_id: "v3", vendor_name: "Lentos SA", vendor_rating: 2.0,
    unit_price: 26000, total: 208000, currency: "MXN", delivery_days: 30, warranty_months: 6, payment_terms: "15 días" },
];

describe("paymentTermsScore", () => {
  it("scores credit days proportionally capped at 1 — in all three languages", () => {
    expect(paymentTermsScore("30 días de crédito")).toBeCloseTo(0.5);   // es
    expect(paymentTermsScore("net 30 days")).toBeCloseTo(0.5);          // en
    expect(paymentTermsScore("30 dias para pagamento")).toBeCloseTo(0.5); // pt
    expect(paymentTermsScore("90 días")).toBe(1);
    expect(paymentTermsScore("net 45")).toBeCloseTo(0.75);              // bare "net N"
  });
  it("scores prepayment low and unknown neutral — in all three languages", () => {
    expect(paymentTermsScore("anticipo 100%")).toBe(0.2);      // es
    expect(paymentTermsScore("100% upfront payment")).toBe(0.2); // en
    expect(paymentTermsScore("pagamento à vista")).toBe(0.2);    // pt
    expect(paymentTermsScore("a convenir")).toBe(0.5);
  });
});

describe("scoreQuotes", () => {
  it("ranks all quotes with per-criterion scores", () => {
    const ranked = scoreQuotes(quotes, W);
    expect(ranked).toHaveLength(3);
    expect(ranked[0].rank).toBe(1);
    expect(ranked.map(r => r.quote_id)).not.toContain(undefined);
    // The weak vendor (q3: priciest, slowest, lowest rated) must be last
    expect(ranked[2].quote_id).toBe("q3");
  });

  it("changing weights changes the ranking deterministically (F5 AC)", () => {
    const priceHeavy = scoreQuotes(quotes, { price: 1, delivery: 0, terms: 0, rating: 0 });
    expect(priceHeavy[0].quote_id).toBe("q2"); // cheapest wins on price-only
    const deliveryHeavy = scoreQuotes(quotes, { price: 0, delivery: 1, terms: 0, rating: 0 });
    expect(deliveryHeavy[0].quote_id).toBe("q1"); // fastest wins on delivery-only
  });

  it("is deterministic across input order", () => {
    const a = scoreQuotes(quotes, W).map(r => r.quote_id);
    const b = scoreQuotes([...quotes].reverse(), W).map(r => r.quote_id);
    expect(a).toEqual(b);
  });
});
