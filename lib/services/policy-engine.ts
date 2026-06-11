export interface PolicyRule {
  rule_code: string;
  category: string | null;   // null = all categories
  action: "allow" | "block";
  max_amount: number | null; // null = no cap
  min_quotes: number;
  approval_route: "auto" | "single" | "committee";
  active: boolean;
}

export interface PolicyInput { category: string; estimated_amount: number | null }

/** Locale-neutral citation: the UI renders reason_key through t() with params. */
export interface CitedRule {
  rule_code: string;
  reason_key: "policy_blocked_category" | "policy_no_rule" | "policy_over_limit" | "policy_allowed";
  params: Record<string, string | number>;
}

export interface PolicyVerdict {
  verdict: "pass" | "flag" | "reject";
  rules_cited: CitedRule[];
  approval_route: "auto" | "single" | "committee";
  min_quotes: number;
}

/** Deterministic policy evaluation — NO LLM calls in this module, ever (spec rule #1). */
export function evaluatePolicy(rules: PolicyRule[], input: PolicyInput): PolicyVerdict {
  const matching = rules
    .filter((r) => r.active)
    .filter((r) => r.category === null || r.category === input.category)
    .sort((a, b) => a.rule_code.localeCompare(b.rule_code));

  const block = matching.find((r) => r.action === "block");
  if (block) {
    return {
      verdict: "reject",
      rules_cited: [{
        rule_code: block.rule_code,
        reason_key: "policy_blocked_category",
        params: { category: input.category, rule_code: block.rule_code },
      }],
      approval_route: "single",
      min_quotes: 0,
    };
  }

  const allow = matching.find((r) => r.action === "allow");
  if (!allow) {
    return {
      verdict: "flag",
      rules_cited: [{
        rule_code: "R-00",
        reason_key: "policy_no_rule",
        params: { category: input.category },
      }],
      approval_route: "committee",
      min_quotes: 3,
    };
  }

  const overLimit =
    allow.max_amount !== null &&
    input.estimated_amount !== null &&
    input.estimated_amount > allow.max_amount;

  if (overLimit) {
    return {
      verdict: "flag",
      rules_cited: [{
        rule_code: allow.rule_code,
        reason_key: "policy_over_limit",
        params: { amount: input.estimated_amount!, max_amount: allow.max_amount!, rule_code: allow.rule_code },
      }],
      approval_route: "committee",
      min_quotes: allow.min_quotes,
    };
  }

  return {
    verdict: "pass",
    rules_cited: [{
      rule_code: allow.rule_code,
      reason_key: "policy_allowed",
      params: { rule_code: allow.rule_code, max_amount: allow.max_amount ?? "—" },
    }],
    approval_route: allow.approval_route,
    min_quotes: allow.min_quotes,
  };
}
