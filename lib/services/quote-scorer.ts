import type { ScoringWeights } from "@/lib/types";

export interface ScorableQuote {
  quote_id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_rating: number; // 0..5
  unit_price: number;
  total: number;
  currency: string;      // ISO 4217 — carried through to the UI and reasoning trace
  delivery_days: number;
  warranty_months: number;
  payment_terms: string;
}

export interface ScoredQuote extends ScorableQuote {
  scores: { price: number; delivery: number; terms: number; rating: number };
  total_score: number;
  rank: number;
}

/** Parses payment terms in es/en/pt. More credit days = better score. */
export function paymentTermsScore(terms: string): number {
  // prepayment markers: es (anticipo, prepago, contado), en (upfront, prepay, advance), pt (à vista, adiantamento)
  // prepayment wins over a day count: "30 días contado" means cash, not credit
  if (/\b(anticipo|prepago|contado|upfront|prepayment|prepay|advance|vista|adiantamento)\b/i.test(terms)) return 0.2;
  // "30 días" / "30 days" / "30 dias" / "net 30"
  const m = terms.match(/(\d+)\s*d[ií]as?|(\d+)\s*days?|net\s*(\d+)/i);
  if (m) {
    const days = parseInt(m[1] ?? m[2] ?? m[3], 10);
    return Math.min(days / 60, 1);
  }
  return 0.5;
}

/** Deterministic weighted scoring — NO LLM (spec rule #1). Ties broken by vendor_id. */
export function scoreQuotes(quotes: ScorableQuote[], w: ScoringWeights): ScoredQuote[] {
  if (quotes.length === 0) return [];
  const bestPrice = Math.min(...quotes.map((q) => q.unit_price));
  const bestDays = Math.min(...quotes.map((q) => q.delivery_days));

  return quotes
    .map((q) => {
      const scores = {
        price: bestPrice / q.unit_price,
        delivery: bestDays / Math.max(q.delivery_days, 1),
        terms: paymentTermsScore(q.payment_terms),
        rating: q.vendor_rating / 5,
      };
      const total_score =
        scores.price * w.price + scores.delivery * w.delivery +
        scores.terms * w.terms + scores.rating * w.rating;
      return { ...q, scores, total_score, rank: 0 };
    })
    .sort((a, b) => b.total_score - a.total_score || a.vendor_id.localeCompare(b.vendor_id))
    .map((q, i) => ({ ...q, rank: i + 1 }));
}
