import { describe, it, expect } from "vitest";
import { evaluatePolicy, PolicyRule } from "@/lib/services/policy-engine";

const rules: PolicyRule[] = [
  { rule_code: "R-01", category: "computo", action: "allow", max_amount: 250000, min_quotes: 3, approval_route: "single", active: true },
  { rule_code: "R-03", category: "papeleria", action: "allow", max_amount: 30000, min_quotes: 2, approval_route: "auto", active: true },
  { rule_code: "R-06", category: "viajes", action: "block", max_amount: null, min_quotes: 0, approval_route: "single", active: true },
  { rule_code: "R-09", category: "computo", action: "block", max_amount: null, min_quotes: 0, approval_route: "single", active: false }, // inactive
];

describe("PolicyEngine", () => {
  it("passes an in-budget computo purchase via R-01, route single", () => {
    const v = evaluatePolicy(rules, { category: "computo", estimated_amount: 180000 });
    expect(v.verdict).toBe("pass");
    expect(v.approval_route).toBe("single");
    expect(v.min_quotes).toBe(3);
    expect(v.rules_cited[0].rule_code).toBe("R-01");
  });

  it("rejects a blocked category citing the exact rule code, locale-neutral", () => {
    const v = evaluatePolicy(rules, { category: "viajes", estimated_amount: 12000 });
    expect(v.verdict).toBe("reject");
    expect(v.rules_cited).toHaveLength(1);
    expect(v.rules_cited[0]).toEqual({
      rule_code: "R-06",
      reason_key: "policy_blocked_category",
      params: { category: "viajes", rule_code: "R-06" },
    });
  });

  it("flags over-threshold amounts and escalates to committee", () => {
    const v = evaluatePolicy(rules, { category: "computo", estimated_amount: 400000 });
    expect(v.verdict).toBe("flag");
    expect(v.approval_route).toBe("committee");
    expect(v.rules_cited[0].reason_key).toBe("policy_over_limit");
    expect(v.rules_cited[0].params).toMatchObject({ amount: 400000, max_amount: 250000 });
  });

  it("flags categories with no rule (R-00), committee route", () => {
    const v = evaluatePolicy(rules, { category: "servicios", estimated_amount: 5000 });
    expect(v.verdict).toBe("flag");
    expect(v.rules_cited[0].rule_code).toBe("R-00");
    expect(v.rules_cited[0].reason_key).toBe("policy_no_rule");
  });

  it("ignores inactive rules", () => {
    const v = evaluatePolicy(rules, { category: "computo", estimated_amount: 1000 });
    expect(v.verdict).toBe("pass"); // R-09 block is inactive
  });

  it("is deterministic: same input, same verdict", () => {
    const a = evaluatePolicy(rules, { category: "computo", estimated_amount: 180000 });
    const b = evaluatePolicy([...rules].reverse(), { category: "computo", estimated_amount: 180000 });
    expect(a).toEqual(b);
  });
});
