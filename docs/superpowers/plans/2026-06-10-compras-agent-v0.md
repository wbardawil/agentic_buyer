# compras-agent v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the demo-grade tail-spend buying agent from `spec.md` — intake → policy → sourcing → quotes → recommendation → approval → PO, with an immutable audit trail, on a deployable URL.

**Architecture:** Next.js 15 App Router serves both UI and API routes. All policy/scoring/savings decisions are deterministic TypeScript services (unit-tested, zero LLM). The Claude API (`claude-sonnet-4-6`, per the spec's "claude-sonnet-4 family" choice) is used only for parsing/writing text via 5 focused endpoints, each forced to JSON with structured outputs (`output_config.format`) and validated with zod (retry once, then fail visibly into the audit log). External side-effects go through `ERPAdapter`/`Mailer` interfaces with stub implementations. Supabase Postgres holds a single demo tenant.

**Tech Stack:** Next.js 15 (App Router, TypeScript, Tailwind), Supabase (`@supabase/supabase-js`, service-role key server-side only — no auth in v0), `@anthropic-ai/sdk`, `zod`, Vitest (unit tests for deterministic services + agent JSON helper), `tsx` (seed script), Vercel (deploy).

**i18n & multi-currency (spec amendment 2026-06-10):** The product targets worldwide tenants — UI in **es / en / pt** behind a `t()` dictionary helper with a top-bar locale switcher (Spanish default for the demo), and **multi-currency with MXN first**. Consequences enforced throughout this plan: (1) deterministic services return locale-neutral structured results (`reason_key` + params), never pre-rendered copy — the UI localizes at render time and the audit log stays language-neutral; (2) every money value carries a `currency` column/field and renders via `Intl.NumberFormat`; (3) agent prompts are written in English and receive `language` and `currency` parameters — output language is never hardcoded in a prompt; (4) the term parser in QuoteScorer understands payment-terms phrasing in all three languages.

**Testing strategy note:** The deterministic spine (PolicyEngine, QuoteScorer, SavingsCalc, AuditLogger, adapters, agent JSON validation/retry) is built TDD with Vitest — these are the modules whose correctness is the product ("policy verdicts must be reproducible"). API routes and UI are demo-grade per the spec; they get complete code plus manual verification commands (curl / browser) rather than route tests. This matches the spec's "weekend MVP, not production" framing.

**Environment prerequisites (gather before starting):**
- A Supabase project (free tier fine). You need: project URL, service-role key, and access to the SQL editor.
- An Anthropic API key.
- Node 20+, npm, git installed.

---

## File Structure

```
. (repo root = current "Agentic Buyer" directory)
├─ spec.md
├─ .env.local                         # ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
├─ supabase/migrations/0001_init.sql  # full schema, run in Supabase SQL editor
├─ scripts/seed.ts                    # seed data (vendors, policies, baseline, users, in-flight reqs)
├─ prompts/                           # versioned system prompts (product surface area)
│  ├─ parse_requisition.md  ├─ draft_rfq.md  ├─ parse_quote.md
│  ├─ write_reasoning.md    └─ simulate_vendor_reply.md
├─ lib/
│  ├─ db.ts                  # Supabase server client (service role)
│  ├─ types.ts               # zod schemas + hand-written JSON schemas + shared types
│  ├─ personas.ts            # fixed demo user IDs + cookie helper
│  ├─ i18n.ts                # es/en/pt dictionaries, t(), fmtMoney() via Intl.NumberFormat
│  ├─ services/
│  │  ├─ policy-engine.ts    # deterministic, zero LLM
│  │  ├─ quote-scorer.ts     # deterministic weighted scoring
│  │  ├─ savings-calc.ts     # median-baseline savings
│  │  └─ audit-logger.ts     # append-only writer
│  ├─ adapters/
│  │  ├─ erp.ts              # ERPAdapter + StubERPAdapter
│  │  └─ mailer.ts           # Mailer + SimulatedMailer
│  └─ agent/
│     ├─ client.ts           # callAgentJSON: structured output + zod + 1 retry
│     └─ tasks.ts            # parseRequisition / draftRFQ / parseQuote / writeReasoning / simulateVendorReply
├─ app/
│  ├─ layout.tsx  ├─ page.tsx (redirect → /solicitudes)
│  ├─ components/ (PersonaSwitcher, StatusBadge, NewRequestForm, ApprovalActions, PipelineControls)
│  ├─ solicitudes/page.tsx  ├─ solicitudes/[id]/page.tsx
│  ├─ aprobaciones/page.tsx ├─ aprobaciones/[id]/page.tsx   # HERO screen
│  ├─ admin/page.tsx        ├─ po/[id]/page.tsx              # printable PO
│  └─ api/
│     ├─ requisitions/route.ts            # POST intake (F1+F2), GET list
│     ├─ agent/source/route.ts            # F3 discovery + F4 RFQ gen/send
│     ├─ agent/simulate-replies/route.ts  # F4 demo control
│     ├─ agent/recommend/route.ts         # F5 normalize/score/reason + F8 savings
│     ├─ approvals/route.ts               # F6 decision + F7 PO
│     └─ audit/export/route.ts            # F9 CSV export
├─ tests/
│  ├─ policy-engine.test.ts  ├─ quote-scorer.test.ts  ├─ savings-calc.test.ts
│  ├─ audit-logger.test.ts   ├─ adapters.test.ts      └─ agent-client.test.ts
└─ vitest.config.ts
```

**Demo fixed IDs (used by seed, personas, and tests):**

```ts
COMPANY_ID  = "00000000-0000-0000-0000-000000000001"
REQUESTER_ID = "00000000-0000-0000-0000-000000000011"  // Laura Méndez
APPROVER_ID  = "00000000-0000-0000-0000-000000000012"  // Carlos Rivas (CFO)
ADMIN_ID     = "00000000-0000-0000-0000-000000000013"  // Sofía Ortega
```

---

### Task 0: Repo scaffold + tooling

**Files:**
- Create: Next.js app scaffold (via create-next-app), `vitest.config.ts`, `.env.local`, `.gitignore` additions

- [ ] **Step 0.1: Init git and scaffold Next.js**

`create-next-app` refuses non-empty dirs, so park `spec.md` first:

```powershell
git init
Move-Item spec.md $env:TEMP\spec.md
npx create-next-app@latest . --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --no-turbopack
Move-Item $env:TEMP\spec.md spec.md
```

Expected: scaffold completes; `package.json`, `app/`, `tsconfig.json` exist; `spec.md` is back.

- [ ] **Step 0.2: Install dependencies**

```powershell
npm install @supabase/supabase-js @anthropic-ai/sdk zod
npm install -D vitest tsx
```

- [ ] **Step 0.3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

Add to `package.json` scripts: `"test": "vitest run"`, `"seed": "tsx scripts/seed.ts"`.

- [ ] **Step 0.4: Create `.env.local`** (values from your Supabase project + Anthropic console)

```
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Confirm `.gitignore` already contains `.env*` (create-next-app default). **Never commit this file.**

- [ ] **Step 0.5: Verify and commit**

```powershell
npm run test    # Expected: "No test files found" exit 0 or passWithNoTests note — fine for now
npm run dev     # Expected: starts on http://localhost:3000; Ctrl+C after confirming
git add -A
git commit -m "chore: scaffold Next.js 15 app with vitest, supabase, anthropic sdk"
```

---

### Task 1: Database schema (migration SQL) + DB client

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `lib/db.ts`

- [ ] **Step 1.1: Write `supabase/migrations/0001_init.sql`**

Schema follows spec §5 exactly, plus two deliberate extensions: `policies.action` (`allow`/`block` — needed so the deterministic engine can model the spec's "blocked category → REJECT with cited rule" without an LLM) and `companies.scoring_weights` (F5 requires admin-editable weights). Audit log is append-only via revoked UPDATE/DELETE.

```sql
create extension if not exists "pgcrypto";

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'MXN',
  locale text not null default 'es',          -- es | en | pt (UI/agent output language)
  country text not null default 'MX',         -- drives country compliance variants (MX → CFDI)
  tax_id text,                                -- RFC in MX, EIN in US — needed for CFDI matching in v1
  scoring_weights jsonb not null default '{"price":0.5,"delivery":0.2,"terms":0.15,"rating":0.15}',
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null,
  email text not null,
  role text not null check (role in ('requester','approver','admin'))
);

create table vendors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null,
  categories text[] not null default '{}',
  contact_email text not null,
  status text not null default 'approved' check (status in ('approved','open','blocked')),
  rating numeric not null default 3.5,
  tax_id text,                                -- RFC (MX) — CFDI issuer matching + compliance pack in v1
  notes text,
  created_at timestamptz not null default now()
);

create table policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  rule_code text not null,
  category text,                -- null = applies to all categories
  action text not null default 'allow' check (action in ('allow','block')),
  max_amount numeric,
  min_quotes int not null default 3,
  approval_route text not null default 'single' check (approval_route in ('auto','single','committee')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table requisitions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  requester_id uuid not null references users(id),
  raw_text text not null,
  structured jsonb,
  category text,
  estimated_amount numeric,
  currency text not null default 'MXN',
  need_by date,
  status text not null default 'intake' check (status in
    ('intake','policy_check','sourcing','quoted','recommended',
     'approved','rejected','po_issued','flagged')),
  policy_result jsonb,
  created_at timestamptz not null default now()
);

create table rfqs (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references requisitions(id),
  vendor_id uuid not null references vendors(id),
  body_text text not null,
  sent_at timestamptz,
  status text not null default 'sent' check (status in ('sent','replied','no_response'))
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references rfqs(id),
  vendor_id uuid not null references vendors(id),
  raw_reply text not null,
  normalized jsonb,
  received_at timestamptz not null default now()
);

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references requisitions(id),
  winning_quote_id uuid not null references quotes(id),
  scoring jsonb not null,
  reasoning_trace text not null,
  savings_vs_baseline numeric,
  baseline_source text,
  created_at timestamptz not null default now()
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references requisitions(id),
  approver_id uuid not null references users(id),
  decision text not null check (decision in ('approved','rejected','info_requested')),
  comment text,
  decided_at timestamptz not null default now()
);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references requisitions(id),
  vendor_id uuid not null references vendors(id),
  po_number text not null unique,
  total numeric not null,
  currency text not null default 'MXN',
  erp_ref text,
  issued_at timestamptz not null default now()
);

create table baseline_purchases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  category text not null,
  description text not null,
  unit_price numeric not null,
  qty int not null,
  total numeric not null,
  currency text not null default 'MXN',
  vendor_name text not null,
  purchased_at date not null
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  requisition_id uuid references requisitions(id),
  actor text not null,          -- 'agent' | <user uuid> | 'system'
  action text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Append-only: the service role bypasses RLS, so enforce immutability with a trigger
-- (works regardless of which key connects).
create or replace function forbid_audit_mutation() returns trigger as $$
begin
  raise exception 'audit_log is append-only';
end;
$$ language plpgsql;

create trigger audit_log_no_update before update on audit_log
  for each row execute function forbid_audit_mutation();
create trigger audit_log_no_delete before delete on audit_log
  for each row execute function forbid_audit_mutation();

create index idx_audit_req on audit_log(requisition_id, created_at);
create index idx_req_status on requisitions(company_id, status);
```

- [ ] **Step 1.2: Apply the migration**

Open the Supabase dashboard → SQL editor → paste the entire file → Run.
Expected: "Success. No rows returned". Verify in Table Editor that `companies` … `audit_log` exist.

- [ ] **Step 1.3: Write `lib/db.ts`**

```ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "@/lib/types";

let _db: SupabaseClient | null = null;

/** Server-only Supabase client using the service-role key (single demo tenant, no auth in v0). */
export function getDb(): SupabaseClient {
  if (!_db) {
    _db = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
  }
  return _db;
}

export const COMPANY_ID = "00000000-0000-0000-0000-000000000001";

export interface TenantInfo {
  name: string;
  locale: Locale;
  currency: string;
  country: string; // 'MX' → CFDI compliance variant in v1
  scoring_weights: { price: number; delivery: number; terms: number; rating: number };
}

/** Tenant context: drives agent output language, currency labeling, and country variants. */
export async function getTenant(): Promise<TenantInfo> {
  const { data, error } = await getDb()
    .from("companies")
    .select("name, locale, currency, country, scoring_weights")
    .eq("id", COMPANY_ID)
    .single();
  if (error || !data) throw new Error(`tenant not found: ${error?.message}`);
  return data as TenantInfo;
}
```

- [ ] **Step 1.4: Commit**

```powershell
git add supabase lib/db.ts
git commit -m "feat: postgres schema (append-only audit) and supabase server client"
```

---

### Task 2: Domain types — zod schemas + JSON schemas

**Files:**
- Create: `lib/types.ts`

The JSON schemas are hand-written (not generated) because the structured-outputs API requires `additionalProperties: false` everywhere and rejects min/max constraints; keeping them small and explicit avoids generator surprises. The zod schema remains the runtime source of truth.

- [ ] **Step 2.1: Write `lib/types.ts`**

```ts
import { z } from "zod";

export const CATEGORIES = [
  "computo", "mobiliario", "papeleria", "servicios", "viajes", "mantenimiento",
] as const;
export type Category = (typeof CATEGORIES)[number];

// ---------- F1: structured requisition (agent output) ----------
export const StructuredRequisitionSchema = z.object({
  category: z.enum(CATEGORIES),
  items: z.array(z.object({
    description: z.string(),
    qty: z.number().int().positive(),
    unit: z.string(),
  })).min(1),
  estimated_amount: z.number().nullable(),
  need_by: z.string().nullable(), // ISO date YYYY-MM-DD
  urgency: z.enum(["baja", "normal", "alta"]),
  clarifying_question: z.string().nullable(), // ONE max; null when clear enough
  assumptions: z.array(z.string()),
});
export type StructuredRequisition = z.infer<typeof StructuredRequisitionSchema>;

export const structuredRequisitionJsonSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          qty: { type: "integer" },
          unit: { type: "string" },
        },
        required: ["description", "qty", "unit"],
        additionalProperties: false,
      },
    },
    estimated_amount: { type: ["number", "null"] },
    need_by: { type: ["string", "null"] },
    urgency: { type: "string", enum: ["baja", "normal", "alta"] },
    clarifying_question: { type: ["string", "null"] },
    assumptions: { type: "array", items: { type: "string" } },
  },
  required: ["category", "items", "estimated_amount", "need_by", "urgency",
             "clarifying_question", "assumptions"],
  additionalProperties: false,
} as const;

// ---------- F4: RFQ draft (agent output) ----------
export const RfqDraftSchema = z.object({
  subject: z.string(),
  body_text: z.string(), // Spanish, identical specs across vendors
});
export type RfqDraft = z.infer<typeof RfqDraftSchema>;

export const rfqDraftJsonSchema = {
  type: "object",
  properties: { subject: { type: "string" }, body_text: { type: "string" } },
  required: ["subject", "body_text"],
  additionalProperties: false,
} as const;

// ---------- F4 demo: simulated vendor reply (agent output) ----------
export const SimulatedReplySchema = z.object({ reply_text: z.string() });
export type SimulatedReply = z.infer<typeof SimulatedReplySchema>;

export const simulatedReplyJsonSchema = {
  type: "object",
  properties: { reply_text: { type: "string" } },
  required: ["reply_text"],
  additionalProperties: false,
} as const;

// ---------- F5: normalized quote (agent output) ----------
export const NormalizedQuoteSchema = z.object({
  unit_price: z.number().positive(),
  total: z.number().positive(),
  currency: z.string().length(3), // ISO 4217 — extracted from the reply, defaulting to the RFQ currency
  delivery_days: z.number().int().positive(),
  warranty_months: z.number().int().nonnegative(),
  payment_terms: z.string(),
});
export type NormalizedQuote = z.infer<typeof NormalizedQuoteSchema>;

export const normalizedQuoteJsonSchema = {
  type: "object",
  properties: {
    unit_price: { type: "number" },
    total: { type: "number" },
    currency: { type: "string" },
    delivery_days: { type: "integer" },
    warranty_months: { type: "integer" },
    payment_terms: { type: "string" },
  },
  required: ["unit_price", "total", "currency", "delivery_days", "warranty_months", "payment_terms"],
  additionalProperties: false,
} as const;

// ---------- F5: reasoning trace (agent output) ----------
export const ReasoningSchema = z.object({ reasoning_trace: z.string() });
export const reasoningJsonSchema = {
  type: "object",
  properties: { reasoning_trace: { type: "string" } },
  required: ["reasoning_trace"],
  additionalProperties: false,
} as const;

// ---------- Shared deterministic types ----------
export interface ScoringWeights { price: number; delivery: number; terms: number; rating: number }

export type RequisitionStatus =
  | "intake" | "policy_check" | "sourcing" | "quoted" | "recommended"
  | "approved" | "rejected" | "po_issued" | "flagged";

// ---------- i18n / currency ----------
export const LOCALES = ["es", "en", "pt"] as const;
export type Locale = (typeof LOCALES)[number];
export const LANGUAGE_NAMES: Record<Locale, string> = {
  es: "Spanish", en: "English", pt: "Portuguese", // used in agent prompts
};
```

- [ ] **Step 2.2: Typecheck and commit**

```powershell
npx tsc --noEmit
git add lib/types.ts
git commit -m "feat: domain zod schemas and structured-output JSON schemas"
```

Expected: tsc exits 0.

---

### Task 3: AuditLogger (TDD)

**Files:**
- Test: `tests/audit-logger.test.ts`
- Create: `lib/services/audit-logger.ts`

- [ ] **Step 3.1: Write the failing test**

```ts
// tests/audit-logger.test.ts
import { describe, it, expect } from "vitest";
import { createAuditLogger, AuditEntry } from "@/lib/services/audit-logger";

function fakeDb() {
  const rows: AuditEntry[] = [];
  return {
    rows,
    from(table: string) {
      expect(table).toBe("audit_log");
      return {
        insert: async (row: AuditEntry) => {
          rows.push(row);
          return { error: null };
        },
      };
    },
  };
}

describe("AuditLogger", () => {
  it("writes an entry with actor, action and payload", async () => {
    const db = fakeDb();
    const audit = createAuditLogger(db as never, "company-1");
    await audit.log({
      requisition_id: "req-1",
      actor: "agent",
      action: "requisition.parsed",
      payload: { category: "computo" },
    });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({
      company_id: "company-1",
      requisition_id: "req-1",
      actor: "agent",
      action: "requisition.parsed",
    });
  });

  it("throws when the insert fails (no silent audit loss)", async () => {
    const db = {
      from: () => ({ insert: async () => ({ error: { message: "boom" } }) }),
    };
    const audit = createAuditLogger(db as never, "company-1");
    await expect(
      audit.log({ requisition_id: null, actor: "system", action: "x", payload: {} })
    ).rejects.toThrow(/audit/i);
  });
});
```

- [ ] **Step 3.2: Run it — must fail**

```powershell
npm test
```
Expected: FAIL — cannot resolve `@/lib/services/audit-logger`.

- [ ] **Step 3.3: Implement `lib/services/audit-logger.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditEntry {
  company_id?: string;
  requisition_id: string | null;
  actor: string; // 'agent' | user uuid | 'system'
  action: string;
  payload: unknown;
}

export interface AuditLogger {
  log(entry: Omit<AuditEntry, "company_id">): Promise<void>;
}

/** Every agent/system step MUST call audit.log before returning (spec rule #2). */
export function createAuditLogger(db: SupabaseClient, companyId: string): AuditLogger {
  return {
    async log(entry) {
      const { error } = await db.from("audit_log").insert({
        company_id: companyId,
        requisition_id: entry.requisition_id,
        actor: entry.actor,
        action: entry.action,
        payload: entry.payload ?? {},
      });
      if (error) throw new Error(`audit write failed: ${error.message}`);
    },
  };
}
```

- [ ] **Step 3.4: Run tests — pass — and commit**

```powershell
npm test
git add tests/audit-logger.test.ts lib/services/audit-logger.ts
git commit -m "feat: append-only audit logger (TDD)"
```

---

### Task 4: PolicyEngine (TDD — F2)

**Files:**
- Test: `tests/policy-engine.test.ts`
- Create: `lib/services/policy-engine.ts`

Semantics (deterministic, zero LLM): active rules sorted by `rule_code`; first matching `block` rule wins → REJECT. Otherwise the first matching `allow` rule governs: amount over `max_amount` → FLAG (escalate to committee); within limit → PASS with the rule's route. No matching rule at all → FLAG with synthetic `R-00`.

Cited rules are **locale-neutral**: `{ rule_code, reason_key, params }`. The UI renders them through `t()` in the viewer's locale (es/en/pt); the audit log stores the structured verdict, never rendered copy.

- [ ] **Step 4.1: Write the failing tests**

```ts
// tests/policy-engine.test.ts
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
```

- [ ] **Step 4.2: Run — must fail** (`npm test` → cannot resolve module)

- [ ] **Step 4.3: Implement `lib/services/policy-engine.ts`**

```ts
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
```

- [ ] **Step 4.4: Run tests — all pass — commit**

```powershell
npm test
git add tests/policy-engine.test.ts lib/services/policy-engine.ts
git commit -m "feat: deterministic policy engine (TDD, F2)"
```

---

### Task 5: QuoteScorer (TDD — F5)

**Files:**
- Test: `tests/quote-scorer.test.ts`
- Create: `lib/services/quote-scorer.ts`

Scoring: per-criterion scores normalized to [0,1] — price = bestPrice/price, delivery = bestDays/days, terms = parsed credit days / 60 capped at 1 (prepayment scores 0.2, unparseable 0.5), rating = rating/5. Weighted sum, descending; ties broken by vendor_id for determinism.

- [ ] **Step 5.1: Write the failing tests**

```ts
// tests/quote-scorer.test.ts
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
```

- [ ] **Step 5.2: Run — must fail** (`npm test`)

- [ ] **Step 5.3: Implement `lib/services/quote-scorer.ts`**

```ts
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
  if (/anticipo|prepago|contado|upfront|prepay|advance|vista|adiantamento/i.test(terms)) return 0.2;
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
```

- [ ] **Step 5.4: Run tests — pass — commit**

```powershell
npm test
git add tests/quote-scorer.test.ts lib/services/quote-scorer.ts
git commit -m "feat: deterministic weighted quote scorer (TDD, F5)"
```

---

### Task 6: SavingsCalc (TDD — F8)

**Files:**
- Test: `tests/savings-calc.test.ts`
- Create: `lib/services/savings-calc.ts`

- [ ] **Step 6.1: Write the failing tests**

```ts
// tests/savings-calc.test.ts
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
```

- [ ] **Step 6.2: Run — must fail** (`npm test`)

- [ ] **Step 6.3: Implement `lib/services/savings-calc.ts`**

```ts
/** Locale-neutral result — UI renders via t("savings_baseline_source" | "savings_not_counted"). */
export type SavingsResult =
  | { counted: true; savings: number; currency: string; baseline_unit_price: number;
      baseline_count: number; qty: number; category: string }
  | { counted: false; category: string };

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
```

- [ ] **Step 6.4: Run tests — pass — commit**

```powershell
npm test
git add tests/savings-calc.test.ts lib/services/savings-calc.ts
git commit -m "feat: median-baseline savings calculator (TDD, F8)"
```

---

### Task 7: Adapters — StubERPAdapter + SimulatedMailer (TDD — F4/F7)

**Files:**
- Test: `tests/adapters.test.ts`
- Create: `lib/adapters/erp.ts`, `lib/adapters/mailer.ts`

The interfaces are the v1 swap points (spec rule #3) — signatures must not assume anything stub-specific.

- [ ] **Step 7.1: Write the failing tests**

```ts
// tests/adapters.test.ts
import { describe, it, expect } from "vitest";
import { StubERPAdapter } from "@/lib/adapters/erp";
import { SimulatedMailer } from "@/lib/adapters/mailer";

describe("StubERPAdapter", () => {
  it("returns a STUB-#### ref, deterministic per PO number", async () => {
    const erp = new StubERPAdapter();
    const a = await erp.createPO({ po_number: "PO-2026-0001", vendor_name: "X", total: 1, currency: "MXN" });
    const b = await erp.createPO({ po_number: "PO-2026-0001", vendor_name: "X", total: 1, currency: "MXN" });
    expect(a.erp_ref).toMatch(/^STUB-\d{4}$/);
    expect(a.erp_ref).toBe(b.erp_ref);
  });
});

describe("SimulatedMailer", () => {
  it("reports delivery with a timestamp without touching the network", async () => {
    const mailer = new SimulatedMailer();
    const r = await mailer.send({ to: "v@x.mx", subject: "RFQ", body: "..." });
    expect(r.delivered).toBe(true);
    expect(Date.parse(r.sent_at)).not.toBeNaN();
  });
});
```

- [ ] **Step 7.2: Run — must fail** (`npm test`)

- [ ] **Step 7.3: Implement both adapters**

```ts
// lib/adapters/erp.ts
export interface POPayload {
  po_number: string;
  vendor_name: string;
  total: number;
  currency: string;
}

/** v1 swaps in OdooAdapter implementing this same interface (spec rule #3). */
export interface ERPAdapter {
  createPO(po: POPayload): Promise<{ erp_ref: string }>;
}

export class StubERPAdapter implements ERPAdapter {
  async createPO(po: POPayload): Promise<{ erp_ref: string }> {
    let h = 0;
    for (const c of po.po_number) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return { erp_ref: `STUB-${String(h % 10000).padStart(4, "0")}` };
  }
}

export function getERPAdapter(): ERPAdapter {
  return new StubERPAdapter();
}
```

```ts
// lib/adapters/mailer.ts
export interface OutboxMessage { to: string; subject: string; body: string }

/** v1 swaps in SMTPMailer implementing this same interface (spec rule #3). */
export interface Mailer {
  send(msg: OutboxMessage): Promise<{ delivered: boolean; sent_at: string }>;
}

export class SimulatedMailer implements Mailer {
  async send(_msg: OutboxMessage): Promise<{ delivered: boolean; sent_at: string }> {
    return { delivered: true, sent_at: new Date().toISOString() };
  }
}

export function getMailer(): Mailer {
  return new SimulatedMailer();
}
```

- [ ] **Step 7.4: Run tests — pass — commit**

```powershell
npm test
git add tests/adapters.test.ts lib/adapters
git commit -m "feat: ERP and mailer adapter interfaces with v0 stubs (TDD)"
```

---

### Task 8: Agent layer — JSON call helper (TDD), prompts, task functions (F1/F4/F5 plumbing)

**Files:**
- Test: `tests/agent-client.test.ts`
- Create: `lib/agent/client.ts`, `lib/agent/tasks.ts`
- Create: `prompts/parse_requisition.md`, `prompts/draft_rfq.md`, `prompts/parse_quote.md`, `prompts/write_reasoning.md`, `prompts/simulate_vendor_reply.md`

Design (spec §7): one focused prompt per capability; structured outputs (`output_config.format` with a JSON schema) force valid JSON at the API layer; zod re-validates at runtime; on validation failure retry once with the error appended; second failure throws `AgentValidationError`, which every API route catches and writes to the audit log (fail visibly). The raw API call is injectable so the retry logic is unit-testable without network.

- [ ] **Step 8.1: Write the failing tests for the helper**

```ts
// tests/agent-client.test.ts
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { callAgentJSON, AgentValidationError, RawCall } from "@/lib/agent/client";

const schema = z.object({ qty: z.number() });
const jsonSchema = {
  type: "object", properties: { qty: { type: "number" } },
  required: ["qty"], additionalProperties: false,
};
const opts = { system: "test system", user: "8 laptops", schema, jsonSchema };

describe("callAgentJSON", () => {
  it("returns validated data on first valid response", async () => {
    const raw: RawCall = vi.fn(async () => `{"qty": 8}`);
    const out = await callAgentJSON({ ...opts, rawCall: raw });
    expect(out).toEqual({ qty: 8 });
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it("strips markdown fences before parsing", async () => {
    const raw: RawCall = vi.fn(async () => "```json\n{\"qty\": 8}\n```");
    expect(await callAgentJSON({ ...opts, rawCall: raw })).toEqual({ qty: 8 });
  });

  it("retries once with the validation error appended, then succeeds", async () => {
    const raw = vi.fn()
      .mockResolvedValueOnce(`{"qty": "ocho"}`)   // fails zod
      .mockResolvedValueOnce(`{"qty": 8}`);
    const out = await callAgentJSON({ ...opts, rawCall: raw as RawCall });
    expect(out).toEqual({ qty: 8 });
    expect(raw).toHaveBeenCalledTimes(2);
    const secondUserMsg = (raw.mock.calls[1] as string[])[1];
    expect(secondUserMsg).toContain("no validó");
  });

  it("throws AgentValidationError after two failures (fail visibly)", async () => {
    const raw: RawCall = vi.fn(async () => "not json at all");
    await expect(callAgentJSON({ ...opts, rawCall: raw })).rejects.toBeInstanceOf(AgentValidationError);
  });
});
```

- [ ] **Step 8.2: Run — must fail** (`npm test`)

- [ ] **Step 8.3: Implement `lib/agent/client.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import fs from "node:fs";
import path from "node:path";

export const MODEL = "claude-sonnet-4-6"; // spec §7: claude-sonnet-4 family

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
  return _anthropic;
}

export class AgentValidationError extends Error {
  constructor(public lastValidationError: string) {
    super(`agent output failed validation after retry: ${lastValidationError}`);
  }
}

/** System prompts are product surface area — versioned files in /prompts (spec §7). */
export function loadPrompt(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), "prompts", `${name}.md`), "utf8");
}

export type RawCall = (system: string, user: string, jsonSchema: object) => Promise<string>;

const defaultRawCall: RawCall = async (system, user, jsonSchema) => {
  const res = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    output_config: { format: { type: "json_schema", schema: jsonSchema } },
    messages: [{ role: "user", content: user }],
  });
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("empty model response");
  return text.text;
};

export async function callAgentJSON<T>(opts: {
  system: string;
  user: string;
  schema: ZodType<T>;
  jsonSchema: object;
  rawCall?: RawCall;
}): Promise<T> {
  const raw = opts.rawCall ?? defaultRawCall;
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      attempt === 0
        ? opts.user
        : `${opts.user}\n\nTu respuesta anterior no validó contra el esquema: ${lastError}\nResponde únicamente con JSON válido que cumpla el esquema.`;
    const text = (await raw(opts.system, user, opts.jsonSchema))
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    try {
      const result = opts.schema.safeParse(JSON.parse(text));
      if (result.success) return result.data;
      lastError = result.error.message;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new AgentValidationError(lastError);
}
```

- [ ] **Step 8.4: Run tests — pass** (`npm test`)

- [ ] **Step 8.5: Write the five prompt files**

Per the amended spec §7: prompts are written in **English** and never hardcode an output language or currency — the user message carries `Output language:` and `Currency:` lines that every prompt must obey.

`prompts/parse_requisition.md`:

```markdown
You are the intake module of a procurement buying agent.
Convert the employee's free-text purchase request into a structured JSON object.
The request may be written in Spanish, English, or Portuguese — handle all three.

Rules:
- `category` must be one of: computo, mobiliario, papeleria, servicios, viajes, mantenimiento.
- Extract quantities, budget (in the tenant currency given in the message), and deadline if
  mentioned. Dates in YYYY-MM-DD; the current date is given in the message.
- If the request is ambiguous about something essential (what is being bought, or how many),
  ask exactly ONE clarifying question in `clarifying_question`, written in the output language
  given in the message. If reasonably clear, set `clarifying_question` to null and record any
  assumptions (in the output language) in `assumptions`.
- If the message says the user already answered a clarification, do NOT ask again: proceed
  with explicit assumptions.
- NEVER invent prices or vendors. No budget mentioned → `estimated_amount` is null.
- Keep item descriptions in the language the user wrote them.
- Respond only with the JSON.
```

`prompts/draft_rfq.md`:

```markdown
You are the RFQ-drafting module of a procurement buying agent.
Write a request for quotation to the indicated vendor, professional and direct in tone,
ENTIRELY in the output language specified in the message (es = Spanish, en = English,
pt = Portuguese).

Rules:
- Specifications, quantities and the reply deadline must be copied EXACTLY from the
  "SPECIFICATIONS" block in the message; add or remove nothing. Every vendor receives
  identical specs.
- Explicitly request: unit price and total in the currency specified in the message,
  delivery time in days, warranty in months, and payment terms.
- Do not mention other vendors or internal budgets.
- Respond only with the JSON {subject, body_text}.
```

`prompts/parse_quote.md`:

```markdown
You are the quote-normalization module of a procurement buying agent.
Extract normalized fields from the vendor's reply email. The reply may be written in
Spanish, English, or Portuguese.

Rules:
- `unit_price` and `total` as plain numbers (no symbols, no thousands separators).
  If the vendor gives only a total, compute unit_price = total / quantity from the context.
- `currency` as the ISO 4217 code the vendor quoted in (e.g. MXN, USD, BRL). If the reply
  does not state a currency, use the RFQ currency given in the message.
- `delivery_days` as an integer (convert weeks to days).
- `warranty_months` as an integer (convert years to months; 0 if not mentioned).
- `payment_terms` as short text faithful to the original (e.g. "30 días de crédito",
  "net 30", "à vista").
- NEVER invent values: if a figure cannot be inferred, use the most conservative value
  explicitly present in the text.
- Respond only with the JSON.
```

`prompts/write_reasoning.md`:

```markdown
You are the explanation module of a procurement buying agent. You receive a quote table
already scored by a deterministic engine (you do NOT compute the scores) plus the
estimated savings.

Write `reasoning_trace`: 3 to 6 sentences in plain language a CFO would read, ENTIRELY in
the output language specified in the message, explaining why the winning quote ranked first.

Rules:
- Cite at least two concrete quantitative factors (unit price, delivery days, warranty,
  payment terms, vendor rating) with their actual numbers and the correct currency code.
- Mention the winner's main drawback if one exists (honesty toward the approver).
- Do not change the ranking or question the weights: your job is to explain, not decide.
- Respond only with the JSON {reasoning_trace}.
```

`prompts/simulate_vendor_reply.md`:

```markdown
[DEMO ONLY] You simulate a vendor replying by email to a request for quotation.
You receive the RFQ and a vendor profile. Write a realistic reply in the SAME language
as the RFQ body, quoting in the currency specified in the message.

Profiles:
- "competitivo": low price, fast delivery (5-10 days), 30-day credit, standard warranty.
- "equilibrado": mid price, 10-15 day delivery, 15-30 day credit.
- "premium": high price (~15% above reference), fast delivery, extended warranty, 45-day credit.
- "debil": high price, slow delivery (25-35 days), 100% upfront payment, short or no warranty.

Rules:
- The reply must contain, in natural email language, ALL quotable data: unit price and
  total in the specified currency, delivery days, warranty, and payment terms.
- Vary wording and format between vendors (sometimes a list, sometimes a paragraph).
- Keep amounts coherent with the budget reference given in the message.
- Respond only with the JSON {reply_text}.
```

- [ ] **Step 8.6: Implement `lib/agent/tasks.ts`**

```ts
import {
  StructuredRequisitionSchema, structuredRequisitionJsonSchema, StructuredRequisition,
  RfqDraftSchema, rfqDraftJsonSchema, RfqDraft,
  NormalizedQuoteSchema, normalizedQuoteJsonSchema, NormalizedQuote,
  ReasoningSchema, reasoningJsonSchema,
  SimulatedReplySchema, simulatedReplyJsonSchema,
  Locale, LANGUAGE_NAMES,
} from "@/lib/types";
import { callAgentJSON, loadPrompt } from "@/lib/agent/client";
import type { ScoredQuote } from "@/lib/services/quote-scorer";
import type { SavingsResult } from "@/lib/services/savings-calc";

/** Tenant context threaded into every agent call — output language + currency are data, not prompt text. */
export interface TenantCtx { locale: Locale; currency: string }

function ctxLines(ctx: TenantCtx): string[] {
  return [
    `Output language: ${LANGUAGE_NAMES[ctx.locale]} (${ctx.locale})`,
    `Currency: ${ctx.currency}`,
  ];
}

export async function parseRequisition(input: {
  raw_text: string;
  category_hint?: string;
  budget?: number;
  need_by?: string;
  clarification_answered?: boolean;
}, ctx: TenantCtx): Promise<StructuredRequisition> {
  const today = new Date().toISOString().slice(0, 10);
  const user = [
    ...ctxLines(ctx),
    `Current date: ${today}`,
    input.category_hint ? `User's category hint: ${input.category_hint}` : "",
    input.budget ? `Budget entered in the form: ${ctx.currency} ${input.budget}` : "",
    input.need_by ? `Deadline entered in the form: ${input.need_by}` : "",
    input.clarification_answered ? "The user already answered a previous clarification." : "",
    `Request:\n${input.raw_text}`,
  ].filter(Boolean).join("\n");

  return callAgentJSON({
    system: loadPrompt("parse_requisition"),
    user,
    schema: StructuredRequisitionSchema,
    jsonSchema: structuredRequisitionJsonSchema,
  });
}

export async function draftRFQ(input: {
  vendor_name: string;
  specs: string;        // serialized items + qty + need_by — identical across vendors
  reply_deadline: string;
  company_name: string;
}, ctx: TenantCtx): Promise<RfqDraft> {
  const user = [
    ...ctxLines(ctx),
    `Recipient vendor: ${input.vendor_name}`,
    `Requesting company: ${input.company_name}`,
    `Reply deadline: ${input.reply_deadline}`,
    `SPECIFICATIONS:\n${input.specs}`,
  ].join("\n");
  return callAgentJSON({
    system: loadPrompt("draft_rfq"),
    user,
    schema: RfqDraftSchema,
    jsonSchema: rfqDraftJsonSchema,
  });
}

export async function parseQuote(input: {
  raw_reply: string;
  qty: number;
}, ctx: TenantCtx): Promise<NormalizedQuote> {
  const user = [
    ...ctxLines(ctx),
    `RFQ currency (use if the reply states none): ${ctx.currency}`,
    `Quantity requested in the RFQ: ${input.qty}`,
    `Vendor reply:\n${input.raw_reply}`,
  ].join("\n");
  return callAgentJSON({
    system: loadPrompt("parse_quote"),
    user,
    schema: NormalizedQuoteSchema,
    jsonSchema: normalizedQuoteJsonSchema,
  });
}

export async function writeReasoning(input: {
  ranked: ScoredQuote[];
  weights: object;
  savings: SavingsResult;
}, ctx: TenantCtx): Promise<string> {
  const user = [
    ...ctxLines(ctx),
    `Weights used by the deterministic engine: ${JSON.stringify(input.weights)}`,
    `Scored table (order = final ranking):\n${JSON.stringify(input.ranked, null, 2)}`,
    `Estimated savings: ${JSON.stringify(input.savings)}`,
  ].join("\n\n");
  const out = await callAgentJSON({
    system: loadPrompt("write_reasoning"),
    user,
    schema: ReasoningSchema,
    jsonSchema: reasoningJsonSchema,
  });
  return out.reasoning_trace;
}

export type VendorProfile = "competitivo" | "equilibrado" | "premium" | "debil";
export const REPLY_PROFILES: VendorProfile[] = ["competitivo", "equilibrado", "premium", "debil"];

export async function simulateVendorReply(input: {
  rfq_body: string;
  vendor_name: string;
  profile: VendorProfile;
  budget_reference: number | null;
}, ctx: TenantCtx): Promise<string> {
  const user = [
    ...ctxLines(ctx),
    `Vendor: ${input.vendor_name}`,
    `Profile: ${input.profile}`,
    `Budget reference (total, ${ctx.currency}): ${input.budget_reference ?? "unknown"}`,
    `RFQ received:\n${input.rfq_body}`,
  ].join("\n");
  const out = await callAgentJSON({
    system: loadPrompt("simulate_vendor_reply"),
    user,
    schema: SimulatedReplySchema,
    jsonSchema: simulatedReplyJsonSchema,
  });
  return out.reply_text;
}
```

- [ ] **Step 8.7: Typecheck, test, commit**

```powershell
npx tsc --noEmit && npm test
git add tests/agent-client.test.ts lib/agent prompts
git commit -m "feat: agent layer with structured outputs, zod validation, retry-once (TDD)"
```

---

### Task 9: Seed script

**Files:**
- Create: `lib/personas.ts`
- Create: `scripts/seed.ts`

- [ ] **Step 9.1: Write `lib/personas.ts`**

```ts
export const COMPANY_ID = "00000000-0000-0000-0000-000000000001";

export const PERSONAS = {
  requester: { id: "00000000-0000-0000-0000-000000000011", name: "Laura Méndez", label: "Solicitante" },
  approver:  { id: "00000000-0000-0000-0000-000000000012", name: "Carlos Rivas", label: "Aprobador (CFO)" },
  admin:     { id: "00000000-0000-0000-0000-000000000013", name: "Sofía Ortega", label: "Admin Compras" },
} as const;
export type PersonaKey = keyof typeof PERSONAS;

export function resolvePersona(cookieValue: string | undefined): PersonaKey {
  return cookieValue === "approver" || cookieValue === "admin" ? cookieValue : "requester";
}
```

- [ ] **Step 9.2: Write `scripts/seed.ts`**

Seed contents per spec §3: ~25 vendors / 6 categories (one **blocked** vendor in cómputo to prove F3 exclusion), 8 policy rules (incl. `R-06` blocking `viajes` — the guardrail demo), ~30 baseline purchases (laptop median ≈ MXN 24,550 so the demo's 8×22,500 purchase shows real savings; **no baseline for `servicios`** to demo "no contabilizado"), 3 users, 3 in-flight requisitions + 1 policy-rejected one. The script is idempotent: it deletes and re-inserts the demo company's data.

```ts
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const C = "00000000-0000-0000-0000-000000000001";

async function must<T>(p: PromiseLike<{ error: { message: string } | null; data?: T }>): Promise<T | undefined> {
  const { error, data } = await p;
  if (error) throw new Error(error.message);
  return data;
}

async function main() {
  // wipe demo tenant (audit_log is append-only by trigger; for re-seeding drop/re-run
  // the migration instead, or accept accumulated audit rows — they are harmless dressing)
  for (const t of ["purchase_orders", "approvals", "recommendations", "quotes", "rfqs",
                   "requisitions", "baseline_purchases", "policies", "vendors", "users", "companies"]) {
    const { error } = await db.from(t).delete().eq(t === "companies" ? "id" : "company_id", C);
    if (error && !/audit/.test(error.message)) console.warn(`${t}: ${error.message}`);
  }

  await must(db.from("companies").insert({
    id: C, name: "Grupo Demo SA de CV", currency: "MXN", locale: "es",
    country: "MX", tax_id: "GDE010101AB1", // demo RFC — CFDI readiness, fictional
  }));

  await must(db.from("users").insert([
    { id: "00000000-0000-0000-0000-000000000011", company_id: C, name: "Laura Méndez", email: "laura@demo.mx", role: "requester" },
    { id: "00000000-0000-0000-0000-000000000012", company_id: C, name: "Carlos Rivas", email: "carlos@demo.mx", role: "approver" },
    { id: "00000000-0000-0000-0000-000000000013", company_id: C, name: "Sofía Ortega", email: "sofia@demo.mx", role: "admin" },
  ]));

  // --- vendors: 25 across 6 categories; TecnoBarato is BLOCKED (F3 exclusion proof) ---
  const v = (name: string, cats: string[], status: string, rating: number, notes = "") =>
    ({ company_id: C, name, categories: cats, contact_email: `ventas@${name.toLowerCase().replace(/[^a-z]/g, "")}.mx`, status, rating, notes });
  await must(db.from("vendors").insert([
    v("TecnoMex", ["computo"], "approved", 4.5), v("CompuPlus", ["computo"], "approved", 3.8),
    v("Lapsa Digital", ["computo"], "open", 3.5), v("ByteCorp", ["computo"], "open", 3.2),
    v("TecnoBarato", ["computo"], "blocked", 1.5, "Incumplimiento de garantías 2025"),
    v("Muebles Norte", ["mobiliario"], "approved", 4.2), v("OficinaPro", ["mobiliario"], "approved", 4.0),
    v("ErgoMex", ["mobiliario"], "open", 3.6), v("Distribuidora MB", ["mobiliario"], "open", 3.0),
    v("Papelera Central", ["papeleria"], "approved", 4.4), v("OfiStock", ["papeleria"], "approved", 4.1),
    v("Papyrus MX", ["papeleria"], "open", 3.4), v("Suministros Sur", ["papeleria"], "open", 3.1),
    v("Servicios Integrales GM", ["servicios"], "approved", 4.0), v("CleanCo", ["servicios"], "approved", 3.9),
    v("Logística Express", ["servicios"], "open", 3.3), v("ProServ Norte", ["servicios"], "open", 3.0),
    v("Viajes Corporativos Az", ["viajes"], "approved", 4.3), v("TravelMex", ["viajes"], "approved", 3.7),
    v("Aero Agencia", ["viajes"], "open", 3.2), v("GoBiz Travel", ["viajes"], "open", 3.0),
    v("ManttoTotal", ["mantenimiento"], "approved", 4.1), v("FixIt Industrial", ["mantenimiento"], "approved", 3.8),
    v("ElectroMantto", ["mantenimiento"], "open", 3.4), v("Reparaciones Lara", ["mantenimiento"], "open", 3.1),
  ]));

  // --- policies (R-06 blocks viajes → the guardrail demo) ---
  const p = (rule_code: string, category: string | null, action: string, max_amount: number | null,
             min_quotes: number, approval_route: string) =>
    ({ company_id: C, rule_code, category, action, max_amount, min_quotes, approval_route, active: true });
  await must(db.from("policies").insert([
    p("R-01", "computo", "allow", 250000, 3, "single"),
    p("R-02", "mobiliario", "allow", 150000, 3, "single"),
    p("R-03", "papeleria", "allow", 30000, 2, "auto"),
    p("R-04", "servicios", "allow", 200000, 3, "single"),
    p("R-05", "mantenimiento", "allow", 100000, 3, "single"),
    p("R-06", "viajes", "block", null, 0, "single"),
    p("R-07", null, "allow", 500000, 3, "committee"),
    p("R-08", "computo", "allow", 50000, 2, "auto"),
  ]));

  // --- baseline purchases: ~30 rows, trailing 6 months; NONE for 'servicios' (F8 AC) ---
  const b = (category: string, description: string, unit_price: number, qty: number,
             vendor_name: string, purchased_at: string) =>
    ({ company_id: C, category, description, unit_price, qty, total: unit_price * qty,
       currency: "MXN", vendor_name, purchased_at });
  await must(db.from("baseline_purchases").insert([
    b("computo", "Laptop 14'' i5 16GB", 24500, 5, "CompuPlus", "2026-01-15"),
    b("computo", "Laptop 14'' i5 16GB", 25200, 3, "TecnoMex", "2026-02-02"),
    b("computo", "Laptop 15'' i7 16GB", 26500, 2, "TecnoMex", "2026-02-20"),
    b("computo", "Laptop 14'' i5 16GB", 23800, 4, "CompuPlus", "2026-03-11"),
    b("computo", "Laptop 14'' Ryzen5 16GB", 24400, 6, "Lapsa Digital", "2026-04-05"),
    b("computo", "Laptop 14'' i5 16GB", 24600, 2, "TecnoMex", "2026-05-19"),
    b("computo", "Monitor 27''", 4200, 10, "CompuPlus", "2026-03-02"),
    b("computo", "Dock USB-C", 1850, 12, "TecnoMex", "2026-04-22"),
    b("mobiliario", "Silla ergonómica", 3900, 10, "Muebles Norte", "2026-01-20"),
    b("mobiliario", "Silla ergonómica", 4150, 6, "OficinaPro", "2026-02-14"),
    b("mobiliario", "Escritorio 1.4m", 5200, 8, "Muebles Norte", "2026-03-08"),
    b("mobiliario", "Escritorio 1.4m", 5450, 4, "ErgoMex", "2026-04-12"),
    b("mobiliario", "Archivero metálico", 2600, 5, "OficinaPro", "2026-05-06"),
    b("papeleria", "Caja papel carta (10 paq)", 980, 20, "Papelera Central", "2026-01-09"),
    b("papeleria", "Tóner HP 26A", 2350, 8, "OfiStock", "2026-02-03"),
    b("papeleria", "Caja papel carta (10 paq)", 1010, 15, "OfiStock", "2026-03-15"),
    b("papeleria", "Tóner HP 26A", 2290, 6, "Papelera Central", "2026-04-18"),
    b("papeleria", "Plumas caja 50", 310, 12, "Papyrus MX", "2026-05-22"),
    b("viajes", "Vuelo MEX-MTY redondo", 3800, 4, "TravelMex", "2026-01-28"),
    b("viajes", "Hotel 3 noches MTY", 4500, 4, "Viajes Corporativos Az", "2026-01-28"),
    b("viajes", "Vuelo MEX-GDL redondo", 3200, 2, "TravelMex", "2026-03-04"),
    b("mantenimiento", "Servicio HVAC trimestral", 18500, 1, "ManttoTotal", "2026-02-10"),
    b("mantenimiento", "Reparación montacargas", 32000, 1, "FixIt Industrial", "2026-03-25"),
    b("mantenimiento", "Pintura oficinas 200m2", 41000, 1, "ManttoTotal", "2026-04-30"),
    b("mantenimiento", "Servicio HVAC trimestral", 19200, 1, "ElectroMantto", "2026-05-12"),
    b("computo", "Teclado+mouse inalámbrico", 720, 25, "CompuPlus", "2026-05-28"),
    b("mobiliario", "Lámpara escritorio LED", 540, 14, "ErgoMex", "2026-05-30"),
    b("papeleria", "Carpetas caja 100", 450, 9, "Suministros Sur", "2026-06-01"),
    b("computo", "Disco SSD 1TB", 1450, 10, "TecnoMex", "2026-06-03"),
    b("mantenimiento", "Cambio de luminarias", 12800, 1, "Reparaciones Lara", "2026-06-05"),
  ]));

  // --- 3 in-flight requisitions + 1 policy-rejected (list dressing; live demo runs the full pipe) ---
  const REQUESTER = "00000000-0000-0000-0000-000000000011";
  await must(db.from("requisitions").insert([
    {
      company_id: C, requester_id: REQUESTER, status: "sourcing", category: "mobiliario",
      raw_text: "10 sillas ergonómicas para el área de soporte, presupuesto 45,000",
      estimated_amount: 45000, currency: "MXN", need_by: "2026-07-01",
      structured: { category: "mobiliario", items: [{ description: "Silla ergonómica", qty: 10, unit: "pieza" }], estimated_amount: 45000, need_by: "2026-07-01", urgency: "normal", clarifying_question: null, assumptions: [] },
      policy_result: { verdict: "pass", rules_cited: [{ rule_code: "R-02", reason: "Permitido por la regla R-02 (límite MXN 150000)" }], approval_route: "single", min_quotes: 3 },
    },
    {
      company_id: C, requester_id: REQUESTER, status: "quoted", category: "papeleria",
      raw_text: "Tóner para las 4 impresoras del piso 2",
      estimated_amount: 9500, currency: "MXN", need_by: null,
      structured: { category: "papeleria", items: [{ description: "Tóner HP 26A", qty: 4, unit: "pieza" }], estimated_amount: 9500, need_by: null, urgency: "baja", clarifying_question: null, assumptions: ["Modelo HP 26A según historial"] },
      policy_result: { verdict: "pass", rules_cited: [{ rule_code: "R-03", reason: "Permitido por la regla R-03 (límite MXN 30000)" }], approval_route: "auto", min_quotes: 2 },
    },
    {
      company_id: C, requester_id: REQUESTER, status: "flagged", category: "mantenimiento",
      raw_text: "Renovación completa del sistema HVAC del edificio, estimado 350,000",
      estimated_amount: 350000, currency: "MXN", need_by: "2026-08-15",
      structured: { category: "mantenimiento", items: [{ description: "Renovación sistema HVAC", qty: 1, unit: "servicio" }], estimated_amount: 350000, need_by: "2026-08-15", urgency: "alta", clarifying_question: null, assumptions: [] },
      policy_result: { verdict: "flag", rules_cited: [{ rule_code: "R-05", reason: "Monto estimado MXN 350000 excede el límite MXN 100000 de la regla R-05" }], approval_route: "committee", min_quotes: 3 },
    },
    {
      company_id: C, requester_id: REQUESTER, status: "rejected", category: "viajes",
      raw_text: "Viaje a Cancún para el offsite del equipo, 6 personas",
      estimated_amount: 85000, currency: "MXN", need_by: "2026-07-20",
      structured: { category: "viajes", items: [{ description: "Viaje offsite Cancún 6 personas", qty: 6, unit: "persona" }], estimated_amount: 85000, need_by: "2026-07-20", urgency: "normal", clarifying_question: null, assumptions: [] },
      policy_result: { verdict: "reject", rules_cited: [{ rule_code: "R-06", reason: "Categoría 'viajes' bloqueada por la regla R-06" }], approval_route: "single", min_quotes: 0 },
    },
  ]));

  console.log("Seed OK: 1 company, 3 users, 25 vendors, 8 policies, 30 baselines, 4 requisitions");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Note: `dotenv` ships as a transitive dep of many packages but install it explicitly: `npm install -D dotenv`.

- [ ] **Step 9.3: Run the seed and verify**

```powershell
npm install -D dotenv
npm run seed
```
Expected output: `Seed OK: 1 company, 3 users, 25 vendors, 8 policies, 30 baselines, 4 requisitions`.
Verify in Supabase Table Editor: `vendors` has 25 rows, one with `status='blocked'`.

- [ ] **Step 9.4: Commit**

```powershell
git add lib/personas.ts scripts/seed.ts package.json package-lock.json
git commit -m "feat: demo seed data (vendors, policies, baselines, in-flight requisitions)"
```

---

### Task 10: API — intake + policy check (F1 + F2 + F9)

**Files:**
- Create: `app/api/requisitions/route.ts`

Every step writes to `audit_log` before returning (spec rule #2). Agent failures are caught and audited (`agent.error`), never swallowed.

- [ ] **Step 10.1: Write `app/api/requisitions/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getDb, getTenant, COMPANY_ID } from "@/lib/db";
import { createAuditLogger } from "@/lib/services/audit-logger";
import { evaluatePolicy, PolicyRule } from "@/lib/services/policy-engine";
import { parseRequisition } from "@/lib/agent/tasks";
import { AgentValidationError } from "@/lib/agent/client";
import { PERSONAS } from "@/lib/personas";

export async function GET() {
  const db = getDb();
  const { data, error } = await db
    .from("requisitions")
    .select("*")
    .eq("company_id", COMPANY_ID)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const db = getDb();
  const audit = createAuditLogger(db, COMPANY_ID);
  const body = await req.json() as {
    raw_text: string; category_hint?: string; budget?: number;
    need_by?: string; clarification_answered?: boolean;
  };

  // [2] AGENT — intake & structuring (in the tenant's language/currency)
  const tenant = await getTenant();
  const ctx = { locale: tenant.locale, currency: tenant.currency };
  let structured;
  try {
    structured = await parseRequisition(body, ctx);
  } catch (e) {
    if (e instanceof AgentValidationError) {
      await audit.log({ requisition_id: null, actor: "agent", action: "agent.error",
        payload: { step: "parse_requisition", error: e.lastValidationError, raw_text: body.raw_text } });
      return NextResponse.json({ error: "could_not_parse_request" }, { status: 422 }); // UI renders t(error)
    }
    throw e;
  }

  // One clarifying question max (F1 AC): bounce back without persisting
  if (structured.clarifying_question && !body.clarification_answered) {
    return NextResponse.json({ needs_clarification: true, question: structured.clarifying_question });
  }

  const { data: reqRow, error: insErr } = await db.from("requisitions").insert({
    company_id: COMPANY_ID,
    requester_id: PERSONAS.requester.id,
    raw_text: body.raw_text,
    structured,
    category: structured.category,
    estimated_amount: structured.estimated_amount,
    currency: tenant.currency,
    need_by: structured.need_by,
    status: "policy_check",
  }).select().single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  await audit.log({ requisition_id: reqRow.id, actor: "agent",
    action: "requisition.parsed", payload: structured });

  // [3] POLICY ENGINE — deterministic
  const { data: ruleRows, error: rulesErr } = await db.from("policies")
    .select("*").eq("company_id", COMPANY_ID);
  if (rulesErr) return NextResponse.json({ error: rulesErr.message }, { status: 500 });

  const verdict = evaluatePolicy(ruleRows as PolicyRule[], {
    category: structured.category,
    estimated_amount: structured.estimated_amount,
  });

  const status =
    verdict.verdict === "reject" ? "rejected" :
    verdict.verdict === "flag" ? "flagged" : "sourcing";

  await db.from("requisitions").update({ policy_result: verdict, status }).eq("id", reqRow.id);
  await audit.log({ requisition_id: reqRow.id, actor: "system",
    action: "policy.evaluated", payload: verdict });

  return NextResponse.json({ id: reqRow.id, status, policy_result: verdict, structured });
}
```

- [ ] **Step 10.2: Verify manually against the dev server**

```powershell
npm run dev   # leave running in another terminal
curl.exe -s -X POST http://localhost:3000/api/requisitions -H "Content-Type: application/json" -d '{\"raw_text\":\"Necesito 8 laptops para el equipo de ventas, presupuesto ~MXN 180,000, para el 15 de julio\"}'
```
Expected JSON: `status: "sourcing"`, `structured.category: "computo"`, `structured.items[0].qty: 8`, `estimated_amount: 180000`, `need_by: "2026-07-15"`. Then the rejection path:

```powershell
curl.exe -s -X POST http://localhost:3000/api/requisitions -H "Content-Type: application/json" -d '{\"raw_text\":\"Boletos de avion a Monterrey para 3 personas la proxima semana, unos 12,000 pesos\"}'
```
Expected: `status: "rejected"`, `policy_result.rules_cited[0].rule_code: "R-06"`.
Check Supabase `audit_log`: both requests produced `requisition.parsed` + `policy.evaluated` rows.

- [ ] **Step 10.3: Commit**

```powershell
git add app/api/requisitions
git commit -m "feat: intake API — agent parse + deterministic policy + audit (F1, F2)"
```

---

### Task 11: API — vendor discovery + RFQ generation + simulated replies (F3 + F4)

**Files:**
- Create: `app/api/agent/source/route.ts`
- Create: `app/api/agent/simulate-replies/route.ts`

- [ ] **Step 11.1: Write `app/api/agent/source/route.ts`**

Vendor selection is deterministic code (approved first by rating, up to 2 `open` for competition, never `blocked`, cap 5); the LLM only writes the RFQ text. RFQ specs are built once and reused verbatim per vendor so they are spec-identical (F4 AC).

```ts
import { NextResponse } from "next/server";
import { getDb, getTenant, COMPANY_ID } from "@/lib/db";
import { createAuditLogger } from "@/lib/services/audit-logger";
import { draftRFQ } from "@/lib/agent/tasks";
import { AgentValidationError } from "@/lib/agent/client";
import { getMailer } from "@/lib/adapters/mailer";
import type { StructuredRequisition } from "@/lib/types";

export async function POST(req: Request) {
  const db = getDb();
  const audit = createAuditLogger(db, COMPANY_ID);
  const { requisition_id } = await req.json() as { requisition_id: string };

  const { data: r, error } = await db.from("requisitions").select("*").eq("id", requisition_id).single();
  if (error || !r) return NextResponse.json({ error: "requisition not found" }, { status: 404 });
  if (r.status !== "sourcing") return NextResponse.json({ error: `invalid status: ${r.status}` }, { status: 409 });
  const structured = r.structured as StructuredRequisition;

  // [4] Vendor discovery — deterministic selection, rationale logged per vendor (F3)
  const { data: vendors } = await db.from("vendors")
    .select("*").eq("company_id", COMPANY_ID).contains("categories", [r.category]);
  const approved = (vendors ?? []).filter(v => v.status === "approved")
    .sort((a, b) => b.rating - a.rating);
  const open = (vendors ?? []).filter(v => v.status === "open")
    .sort((a, b) => b.rating - a.rating).slice(0, 2);
  const blocked = (vendors ?? []).filter(v => v.status === "blocked");
  const selected = [...approved, ...open].slice(0, 5);

  if (selected.length < 3) {
    await audit.log({ requisition_id, actor: "agent", action: "sourcing.insufficient_vendors",
      payload: { found: selected.length } });
    return NextResponse.json({ error: "fewer than 3 vendors available" }, { status: 422 });
  }

  // rationale is locale-neutral (reason_key + params); audit payloads never carry rendered copy
  await audit.log({ requisition_id, actor: "agent", action: "vendors.selected", payload: {
    selected: selected.map(v => ({
      id: v.id, name: v.name, status: v.status, rating: v.rating,
      rationale: v.status === "approved"
        ? { reason_key: "vendor_selected_approved", params: { category: r.category, rating: v.rating } }
        : { reason_key: "vendor_selected_open_competition", params: { rating: v.rating } },
    })),
    excluded_blocked: blocked.map(v => ({
      id: v.id, name: v.name,
      rationale: { reason_key: "vendor_excluded_blocked", params: { notes: v.notes ?? "" } },
    })),
  }});

  // [5] RFQ generation — identical specs block for every vendor (F4)
  const specs = [
    ...structured.items.map(i => `- ${i.qty} x ${i.description} (${i.unit})`),
    structured.need_by ? `Fecha requerida de entrega: ${structured.need_by}` : "",
  ].filter(Boolean).join("\n");
  const replyDeadline = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  const mailer = getMailer();
  const tenant = await getTenant();
  const ctx = { locale: tenant.locale, currency: tenant.currency };

  const rfqIds: string[] = [];
  for (const vendor of selected) {
    let rfqDraft;
    try {
      rfqDraft = await draftRFQ({
        vendor_name: vendor.name, specs, reply_deadline: replyDeadline,
        company_name: tenant.name,
      }, ctx);
    } catch (e) {
      if (e instanceof AgentValidationError) {
        await audit.log({ requisition_id, actor: "agent", action: "agent.error",
          payload: { step: "draft_rfq", vendor: vendor.name, error: e.lastValidationError } });
        continue; // skip this vendor, keep the rest
      }
      throw e;
    }
    const sent = await mailer.send({ to: vendor.contact_email, subject: rfqDraft.subject, body: rfqDraft.body_text });
    const { data: rfqRow } = await db.from("rfqs").insert({
      requisition_id, vendor_id: vendor.id, body_text: rfqDraft.body_text,
      sent_at: sent.sent_at, status: "sent",
    }).select().single();
    rfqIds.push(rfqRow!.id);
    await audit.log({ requisition_id, actor: "agent", action: "rfq.sent",
      payload: { rfq_id: rfqRow!.id, vendor: vendor.name, to: vendor.contact_email, subject: rfqDraft.subject } });
  }

  return NextResponse.json({ rfqs_sent: rfqIds.length });
}
```

- [ ] **Step 11.2: Write `app/api/agent/simulate-replies/route.ts`** (the admin "Simular respuestas" control)

```ts
import { NextResponse } from "next/server";
import { getDb, getTenant, COMPANY_ID } from "@/lib/db";
import { createAuditLogger } from "@/lib/services/audit-logger";
import { simulateVendorReply, REPLY_PROFILES } from "@/lib/agent/tasks";
import { AgentValidationError } from "@/lib/agent/client";
import type { StructuredRequisition } from "@/lib/types";

export async function POST(req: Request) {
  const db = getDb();
  const audit = createAuditLogger(db, COMPANY_ID);
  const { requisition_id } = await req.json() as { requisition_id: string };

  const { data: r } = await db.from("requisitions").select("*").eq("id", requisition_id).single();
  if (!r) return NextResponse.json({ error: "requisición no encontrada" }, { status: 404 });
  const structured = r.structured as StructuredRequisition;

  const { data: rfqs } = await db.from("rfqs")
    .select("*, vendors(name)").eq("requisition_id", requisition_id).eq("status", "sent");
  if (!rfqs?.length) return NextResponse.json({ error: "no pending RFQs" }, { status: 409 });

  const tenant = await getTenant();
  const ctx = { locale: tenant.locale, currency: tenant.currency };

  let replies = 0;
  for (const [i, rfq] of rfqs.entries()) {
    // profile rotation guarantees varied quotes incl. one intentionally weak (F4 AC)
    const profile = REPLY_PROFILES[i % REPLY_PROFILES.length];
    let replyText: string;
    try {
      replyText = await simulateVendorReply({
        rfq_body: rfq.body_text,
        vendor_name: (rfq.vendors as { name: string }).name,
        profile,
        budget_reference: structured.estimated_amount,
      }, ctx);
    } catch (e) {
      if (e instanceof AgentValidationError) {
        await audit.log({ requisition_id, actor: "agent", action: "agent.error",
          payload: { step: "simulate_vendor_reply", rfq_id: rfq.id, error: e.lastValidationError } });
        continue;
      }
      throw e;
    }
    await db.from("quotes").insert({ rfq_id: rfq.id, vendor_id: rfq.vendor_id, raw_reply: replyText });
    await db.from("rfqs").update({ status: "replied" }).eq("id", rfq.id);
    await audit.log({ requisition_id, actor: "system", action: "quote.received",
      payload: { rfq_id: rfq.id, vendor: (rfq.vendors as { name: string }).name, simulated: true, profile } });
    replies++;
  }

  if (replies > 0) await db.from("requisitions").update({ status: "quoted" }).eq("id", requisition_id);
  return NextResponse.json({ replies });
}
```

- [ ] **Step 11.3: Verify manually**

Using the requisition id returned in Task 10 (`$rid`):

```powershell
curl.exe -s -X POST http://localhost:3000/api/agent/source -H "Content-Type: application/json" -d "{\"requisition_id\":\"$rid\"}"
# Expected: {"rfqs_sent":5}  (4 approved+open computo vendors minimum 3, capped 5)
curl.exe -s -X POST http://localhost:3000/api/agent/simulate-replies -H "Content-Type: application/json" -d "{\"requisition_id\":\"$rid\"}"
# Expected: {"replies":4} or 5
```
Check `audit_log`: `vendors.selected` payload lists TecnoBarato under `excluded_blocked` (F3 AC). Check `rfqs.body_text` rows share the identical specs lines.

- [ ] **Step 11.4: Commit**

```powershell
git add app/api/agent/source app/api/agent/simulate-replies
git commit -m "feat: sourcing API — vendor discovery, RFQ generation, simulated replies (F3, F4)"
```

---

### Task 12: API — quote normalization, scoring, recommendation, savings (F5 + F8)

**Files:**
- Create: `app/api/agent/recommend/route.ts`

- [ ] **Step 12.1: Write `app/api/agent/recommend/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getDb, getTenant, COMPANY_ID } from "@/lib/db";
import { createAuditLogger } from "@/lib/services/audit-logger";
import { parseQuote, writeReasoning } from "@/lib/agent/tasks";
import { AgentValidationError } from "@/lib/agent/client";
import { scoreQuotes, ScorableQuote } from "@/lib/services/quote-scorer";
import { computeSavings } from "@/lib/services/savings-calc";
import type { StructuredRequisition } from "@/lib/types";

export async function POST(req: Request) {
  const db = getDb();
  const audit = createAuditLogger(db, COMPANY_ID);
  const { requisition_id } = await req.json() as { requisition_id: string };

  const { data: r } = await db.from("requisitions").select("*").eq("id", requisition_id).single();
  if (!r) return NextResponse.json({ error: "requisición no encontrada" }, { status: 404 });
  if (r.status !== "quoted") return NextResponse.json({ error: `invalid status: ${r.status}` }, { status: 409 });
  const structured = r.structured as StructuredRequisition;
  const qty = structured.items.reduce((s, i) => s + i.qty, 0);
  const tenant = await getTenant();
  const ctx = { locale: tenant.locale, currency: tenant.currency };

  // [6a] AGENT — normalize each raw reply
  const { data: quotes } = await db.from("quotes")
    .select("*, vendors(id, name, rating), rfqs!inner(requisition_id)")
    .eq("rfqs.requisition_id", requisition_id);
  if (!quotes?.length) return NextResponse.json({ error: "sin cotizaciones" }, { status: 409 });

  const scorable: ScorableQuote[] = [];
  for (const q of quotes) {
    let normalized;
    try {
      normalized = await parseQuote({ raw_reply: q.raw_reply, qty }, ctx);
    } catch (e) {
      if (e instanceof AgentValidationError) {
        await audit.log({ requisition_id, actor: "agent", action: "agent.error",
          payload: { step: "parse_quote", quote_id: q.id, error: e.lastValidationError } });
        continue;
      }
      throw e;
    }
    await db.from("quotes").update({ normalized }).eq("id", q.id);
    await audit.log({ requisition_id, actor: "agent", action: "quote.normalized",
      payload: { quote_id: q.id, vendor: q.vendors.name, normalized } });
    scorable.push({
      quote_id: q.id, vendor_id: q.vendors.id, vendor_name: q.vendors.name,
      vendor_rating: Number(q.vendors.rating), ...normalized,
    });
  }
  if (scorable.length === 0) {
    return NextResponse.json({ error: "ninguna cotización pudo normalizarse" }, { status: 422 });
  }

  // [6b] DETERMINISTIC — score with company weights
  const weights = tenant.scoring_weights;
  const ranked = scoreQuotes(scorable, weights);
  const winner = ranked[0];
  await audit.log({ requisition_id, actor: "system", action: "quotes.scored",
    payload: { weights, ranking: ranked.map(x => ({ vendor: x.vendor_name, total_score: x.total_score, rank: x.rank })) } });

  // [F8] DETERMINISTIC — savings vs SAME-CURRENCY baseline (never guessed, no FX in v0)
  const { data: baseline } = await db.from("baseline_purchases")
    .select("unit_price").eq("company_id", COMPANY_ID)
    .eq("category", r.category).eq("currency", winner.currency);
  const savings = computeSavings({
    category: r.category, qty,
    winning_unit_price: winner.unit_price,
    currency: winner.currency,
    baseline_unit_prices: (baseline ?? []).map(b => Number(b.unit_price)),
  });
  await audit.log({ requisition_id, actor: "system", action: "savings.computed", payload: savings });

  // [6c] AGENT — plain-language reasoning trace in the tenant's locale (explains, never decides)
  let reasoningTrace: string;
  try {
    reasoningTrace = await writeReasoning({ ranked, weights, savings }, ctx);
  } catch (e) {
    if (e instanceof AgentValidationError) {
      await audit.log({ requisition_id, actor: "agent", action: "agent.error",
        payload: { step: "write_reasoning", error: e.lastValidationError } });
      // locale-neutral deterministic fallback so the demo never dies here
      reasoningTrace = `#1 ${winner.vendor_name} — score ${winner.total_score.toFixed(2)} | ` +
        `${winner.currency} ${winner.unit_price} c/u | ${winner.delivery_days}d | ` +
        `${winner.warranty_months}m | ${winner.payment_terms}`;
    } else throw e;
  }

  const { data: rec } = await db.from("recommendations").insert({
    requisition_id,
    winning_quote_id: winner.quote_id,
    scoring: { weights, ranked, savings },   // structured savings lives here; UI localizes it
    reasoning_trace: reasoningTrace,
    savings_vs_baseline: savings.counted ? savings.savings : null,
    baseline_source: savings.counted
      ? `median:${savings.baseline_count}:${savings.category}:${savings.currency}` // machine-readable; UI renders t("savings_baseline_source")
      : "not_counted",
  }).select().single();

  await db.from("requisitions").update({ status: "recommended" }).eq("id", requisition_id);
  await audit.log({ requisition_id, actor: "agent", action: "recommendation.created",
    payload: { recommendation_id: rec!.id, winner: winner.vendor_name, savings } });

  return NextResponse.json({ recommendation_id: rec!.id, winner: winner.vendor_name });
}
```

- [ ] **Step 12.2: Verify manually**

```powershell
curl.exe -s -X POST http://localhost:3000/api/agent/recommend -H "Content-Type: application/json" -d "{\"requisition_id\":\"$rid\"}"
```
Expected: `{"recommendation_id":"...","winner":"..."}`. In Supabase: `recommendations.reasoning_trace` is 3–6 Spanish sentences citing ≥2 numbers; `savings_vs_baseline` is a concrete figure; requisition status is `recommended`; audit has `quote.normalized` ×N, `quotes.scored`, `savings.computed`, `recommendation.created`.

- [ ] **Step 12.3: Commit**

```powershell
git add app/api/agent/recommend
git commit -m "feat: recommend API — normalize, score, savings, reasoning trace (F5, F8)"
```

---

### Task 13: API — approval decision + PO generation + CSV export (F6 + F7 + F9)

**Files:**
- Create: `app/api/approvals/route.ts`
- Create: `app/api/audit/export/route.ts`

- [ ] **Step 13.1: Write `app/api/approvals/route.ts`**

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb, COMPANY_ID } from "@/lib/db";
import { createAuditLogger } from "@/lib/services/audit-logger";
import { getERPAdapter } from "@/lib/adapters/erp";
import { PERSONAS, resolvePersona } from "@/lib/personas";

export async function POST(req: Request) {
  const db = getDb();
  const audit = createAuditLogger(db, COMPANY_ID);
  const body = await req.json() as {
    requisition_id: string;
    decision: "approved" | "rejected" | "info_requested";
    comment?: string;
  };

  const persona = resolvePersona((await cookies()).get("persona")?.value);
  const approverId = PERSONAS[persona].id; // demo: persona switcher stands in for auth

  if (body.decision === "rejected" && !body.comment?.trim()) {
    return NextResponse.json({ error: "rejection requires a comment" }, { status: 400 });
  }

  const { data: r } = await db.from("requisitions").select("*").eq("id", body.requisition_id).single();
  if (!r) return NextResponse.json({ error: "requisition not found" }, { status: 404 });
  if (r.status !== "recommended") return NextResponse.json({ error: `invalid status: ${r.status}` }, { status: 409 });

  await db.from("approvals").insert({
    requisition_id: body.requisition_id, approver_id: approverId,
    decision: body.decision, comment: body.comment ?? null,
  });
  await audit.log({ requisition_id: body.requisition_id, actor: approverId,
    action: `approval.${body.decision}`, payload: { comment: body.comment ?? null } });

  if (body.decision === "rejected") {
    await db.from("requisitions").update({ status: "rejected" }).eq("id", body.requisition_id);
    return NextResponse.json({ status: "rejected" });
  }
  if (body.decision === "info_requested") {
    return NextResponse.json({ status: "recommended", info_requested: true });
  }

  // [8] PO generation via stub ERP adapter (F7)
  const { data: rec } = await db.from("recommendations")
    .select("*, quotes:winning_quote_id(id, normalized, vendor_id, vendors(name))")
    .eq("requisition_id", body.requisition_id).single();
  const winningQuote = rec!.quotes as {
    id: string; normalized: { total: number; currency: string };
    vendor_id: string; vendors: { name: string };
  };
  const poCurrency = winningQuote.normalized.currency; // PO inherits the quote's currency

  const { count } = await db.from("purchase_orders").select("*", { count: "exact", head: true });
  const poNumber = `PO-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(4, "0")}`;

  const erp = getERPAdapter();
  const { erp_ref } = await erp.createPO({
    po_number: poNumber, vendor_name: winningQuote.vendors.name,
    total: winningQuote.normalized.total, currency: poCurrency,
  });

  const { data: po } = await db.from("purchase_orders").insert({
    requisition_id: body.requisition_id, vendor_id: winningQuote.vendor_id,
    po_number: poNumber, total: winningQuote.normalized.total, currency: poCurrency, erp_ref,
  }).select().single();

  await db.from("requisitions").update({ status: "po_issued" }).eq("id", body.requisition_id);
  await audit.log({ requisition_id: body.requisition_id, actor: "system",
    action: "po.issued", payload: { po_number: poNumber, erp_ref, total: winningQuote.normalized.total } });
  await audit.log({ requisition_id: body.requisition_id, actor: "system",
    action: "requester.notified", payload: { channel: "simulated", to: PERSONAS.requester.name } });

  return NextResponse.json({ status: "po_issued", po_id: po!.id, po_number: poNumber, erp_ref });
}
```

- [ ] **Step 13.2: Write `app/api/audit/export/route.ts`** (F9 CSV)

```ts
import { getDb, COMPANY_ID } from "@/lib/db";

function csvCell(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const reqId = url.searchParams.get("requisition_id");
  const db = getDb();

  let q = db.from("audit_log").select("*").eq("company_id", COMPANY_ID)
    .order("created_at", { ascending: true });
  if (reqId) q = q.eq("requisition_id", reqId);
  const { data, error } = await q;
  if (error) return new Response(error.message, { status: 500 });

  const header = "created_at,requisition_id,actor,action,payload";
  const rows = (data ?? []).map(r =>
    [r.created_at, r.requisition_id ?? "", r.actor, r.action, r.payload]
      .map(csvCell).join(","));
  return new Response([header, ...rows].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="auditoria${reqId ? `-${reqId}` : ""}.csv"`,
    },
  });
}
```

- [ ] **Step 13.3: Verify manually**

```powershell
curl.exe -s -X POST http://localhost:3000/api/approvals -H "Content-Type: application/json" --cookie "persona=approver" -d "{\"requisition_id\":\"$rid\",\"decision\":\"approved\"}"
# Expected: {"status":"po_issued","po_number":"PO-2026-0001","erp_ref":"STUB-...."}
curl.exe -s "http://localhost:3000/api/audit/export?requisition_id=$rid"
# Expected: CSV with >= 10 rows telling the full story in order (F9 AC)
```
Also verify the rejection guard: posting `decision: "rejected"` with no comment returns 400.

- [ ] **Step 13.4: Commit**

```powershell
git add app/api/approvals app/api/audit
git commit -m "feat: approval + PO issuance via stub ERP, audit CSV export (F6, F7, F9)"
```

---

### Task 14: i18n core (TDD) + UI shell + persona/locale switchers

**Files:**
- Test: `tests/i18n.test.ts`
- Create: `lib/i18n.ts`
- Modify: `app/layout.tsx` (replace create-next-app default)
- Create: `app/page.tsx` (redirect), `app/components/PersonaSwitcher.tsx`, `app/components/LocaleSwitcher.tsx`, `app/components/StatusBadge.tsx`

- [ ] **Step 14.1: Write the failing i18n test**

```ts
// tests/i18n.test.ts
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
```

- [ ] **Step 14.2: Run — must fail** (`npm test`)

- [ ] **Step 14.3: Implement `lib/i18n.ts`**

Full es/en/pt dictionaries. Spanish is the demo default; en/pt must have every key (the parity test enforces it). All policy/savings/vendor `reason_key`s from the deterministic services live here.

```ts
import type { Locale } from "@/lib/types";

export const dict = {
  es: {
    app_name: "Agente de Compras",
    nav_requests: "Solicitudes", nav_approvals: "Aprobaciones", nav_admin: "Administración",
    persona_requester: "Solicitante", persona_approver: "Aprobador (CFO)", persona_admin: "Admin Compras",
    status_intake: "Captura", status_policy_check: "Validando política", status_sourcing: "Buscando proveedores",
    status_quoted: "Cotizado", status_recommended: "Recomendado", status_approved: "Aprobado",
    status_rejected: "Rechazado", status_po_issued: "OC emitida", status_flagged: "Escalado",
    form_title: "Nueva solicitud de compra", form_raw_text: "¿Qué necesitas comprar?",
    form_category_hint: "Categoría (opcional)", form_budget: "Presupuesto (opcional)",
    form_need_by: "Fecha requerida (opcional)", form_submit: "Enviar solicitud",
    form_clarification: "El agente necesita una aclaración:", form_answer_send: "Responder y enviar",
    btn_approve: "Aprobar", btn_reject: "Rechazar", btn_request_info: "Pedir más información",
    btn_source: "Buscar proveedores y enviar RFQs", btn_simulate_replies: "Simular respuestas",
    btn_recommend: "Generar recomendación", btn_export_csv: "Exportar CSV", btn_save_weights: "Guardar pesos",
    reject_comment_required: "El rechazo requiere un comentario",
    policy_verdict_title: "Resultado de política", policy_pass: "Cumple", policy_flag: "Escalado", policy_reject: "Rechazado",
    policy_blocked_category: "Categoría '{category}' bloqueada por la regla {rule_code}",
    policy_no_rule: "Sin regla configurada para la categoría '{category}'; requiere revisión manual",
    policy_over_limit: "El monto {amount} excede el límite {max_amount} de la regla {rule_code}",
    policy_allowed: "Permitido por la regla {rule_code} (límite {max_amount})",
    vendor_selected_approved: "Proveedor aprobado en '{category}' con calificación {rating}",
    vendor_selected_open_competition: "Proveedor abierto incluido para generar competencia (calificación {rating})",
    vendor_excluded_blocked: "Excluido por estar bloqueado. {notes}",
    savings_label: "Ahorro estimado",
    savings_baseline_source: "vs. mediana de {count} compras históricas ({category}, últimos 6 meses)",
    savings_not_counted: "No contabilizado — sin historial en la categoría '{category}'",
    comparison_title: "Comparativa de cotizaciones", reasoning_title: "Razonamiento del agente",
    th_rank: "#", th_vendor: "Proveedor", th_unit_price: "Precio unitario", th_total: "Total",
    th_delivery: "Entrega (días)", th_warranty: "Garantía (meses)", th_terms: "Condiciones de pago",
    th_rating: "Calificación", th_score: "Puntaje",
    tab_rules: "Reglas", tab_vendors: "Proveedores", tab_audit: "Auditoría", tab_kpis: "Indicadores", tab_weights: "Pesos",
    kpi_touchless: "% sin intervención hasta aprobación", kpi_avg_savings: "Ahorro promedio",
    kpi_cycle_time: "Ciclo promedio (solicitud → OC)", kpi_violations: "Violaciones de política detectadas",
    audit_title: "Bitácora de auditoría", audit_actor: "Actor", audit_action: "Acción", audit_when: "Fecha",
    po_title: "Orden de Compra", po_number: "Número de OC", po_vendor: "Proveedor", po_total: "Total",
    po_erp_ref: "Referencia ERP", po_issued_at: "Fecha de emisión", po_print: "Imprimir",
    could_not_parse_request: "No se pudo interpretar la solicitud; intenta reformularla",
    requests_title: "Mis solicitudes", approvals_title: "Cola de aprobación", empty_queue: "Sin pendientes",
    days_suffix: "días",
  },
  en: {
    app_name: "Buying Agent",
    nav_requests: "Requests", nav_approvals: "Approvals", nav_admin: "Admin",
    persona_requester: "Requester", persona_approver: "Approver (CFO)", persona_admin: "Procurement Admin",
    status_intake: "Intake", status_policy_check: "Policy check", status_sourcing: "Sourcing",
    status_quoted: "Quoted", status_recommended: "Recommended", status_approved: "Approved",
    status_rejected: "Rejected", status_po_issued: "PO issued", status_flagged: "Escalated",
    form_title: "New purchase request", form_raw_text: "What do you need to buy?",
    form_category_hint: "Category (optional)", form_budget: "Budget (optional)",
    form_need_by: "Needed by (optional)", form_submit: "Submit request",
    form_clarification: "The agent needs one clarification:", form_answer_send: "Answer and submit",
    btn_approve: "Approve", btn_reject: "Reject", btn_request_info: "Request more info",
    btn_source: "Find vendors & send RFQs", btn_simulate_replies: "Simulate replies",
    btn_recommend: "Generate recommendation", btn_export_csv: "Export CSV", btn_save_weights: "Save weights",
    reject_comment_required: "Rejection requires a comment",
    policy_verdict_title: "Policy result", policy_pass: "Pass", policy_flag: "Escalated", policy_reject: "Rejected",
    policy_blocked_category: "Category '{category}' is blocked by rule {rule_code}",
    policy_no_rule: "No rule configured for category '{category}'; manual review required",
    policy_over_limit: "Amount {amount} exceeds the {max_amount} limit of rule {rule_code}",
    policy_allowed: "Allowed by rule {rule_code} (limit {max_amount})",
    vendor_selected_approved: "Approved vendor in '{category}' with rating {rating}",
    vendor_selected_open_competition: "Open vendor included for competition (rating {rating})",
    vendor_excluded_blocked: "Excluded: vendor is blocked. {notes}",
    savings_label: "Estimated savings",
    savings_baseline_source: "vs. median of {count} historical purchases ({category}, trailing 6 months)",
    savings_not_counted: "Not counted — no purchase history in category '{category}'",
    comparison_title: "Quote comparison", reasoning_title: "Agent reasoning",
    th_rank: "#", th_vendor: "Vendor", th_unit_price: "Unit price", th_total: "Total",
    th_delivery: "Delivery (days)", th_warranty: "Warranty (months)", th_terms: "Payment terms",
    th_rating: "Rating", th_score: "Score",
    tab_rules: "Rules", tab_vendors: "Vendors", tab_audit: "Audit log", tab_kpis: "KPIs", tab_weights: "Weights",
    kpi_touchless: "% touchless to approval", kpi_avg_savings: "Average savings",
    kpi_cycle_time: "Avg cycle time (request → PO)", kpi_violations: "Policy violations caught",
    audit_title: "Audit log", audit_actor: "Actor", audit_action: "Action", audit_when: "When",
    po_title: "Purchase Order", po_number: "PO number", po_vendor: "Vendor", po_total: "Total",
    po_erp_ref: "ERP reference", po_issued_at: "Issued at", po_print: "Print",
    could_not_parse_request: "The request could not be interpreted; please rephrase it",
    requests_title: "My requests", approvals_title: "Approval queue", empty_queue: "Nothing pending",
    days_suffix: "days",
  },
  pt: {
    app_name: "Agente de Compras",
    nav_requests: "Solicitações", nav_approvals: "Aprovações", nav_admin: "Administração",
    persona_requester: "Solicitante", persona_approver: "Aprovador (CFO)", persona_admin: "Admin de Compras",
    status_intake: "Captura", status_policy_check: "Validação de política", status_sourcing: "Buscando fornecedores",
    status_quoted: "Cotado", status_recommended: "Recomendado", status_approved: "Aprovado",
    status_rejected: "Rejeitado", status_po_issued: "OC emitida", status_flagged: "Escalado",
    form_title: "Nova solicitação de compra", form_raw_text: "O que você precisa comprar?",
    form_category_hint: "Categoria (opcional)", form_budget: "Orçamento (opcional)",
    form_need_by: "Data necessária (opcional)", form_submit: "Enviar solicitação",
    form_clarification: "O agente precisa de um esclarecimento:", form_answer_send: "Responder e enviar",
    btn_approve: "Aprovar", btn_reject: "Rejeitar", btn_request_info: "Pedir mais informações",
    btn_source: "Buscar fornecedores e enviar RFQs", btn_simulate_replies: "Simular respostas",
    btn_recommend: "Gerar recomendação", btn_export_csv: "Exportar CSV", btn_save_weights: "Salvar pesos",
    reject_comment_required: "A rejeição exige um comentário",
    policy_verdict_title: "Resultado da política", policy_pass: "Aprovado", policy_flag: "Escalado", policy_reject: "Rejeitado",
    policy_blocked_category: "Categoria '{category}' bloqueada pela regra {rule_code}",
    policy_no_rule: "Sem regra configurada para a categoria '{category}'; revisão manual necessária",
    policy_over_limit: "O valor {amount} excede o limite {max_amount} da regra {rule_code}",
    policy_allowed: "Permitido pela regra {rule_code} (limite {max_amount})",
    vendor_selected_approved: "Fornecedor aprovado em '{category}' com avaliação {rating}",
    vendor_selected_open_competition: "Fornecedor aberto incluído para gerar concorrência (avaliação {rating})",
    vendor_excluded_blocked: "Excluído por estar bloqueado. {notes}",
    savings_label: "Economia estimada",
    savings_baseline_source: "vs. mediana de {count} compras históricas ({category}, últimos 6 meses)",
    savings_not_counted: "Não contabilizado — sem histórico na categoria '{category}'",
    comparison_title: "Comparativo de cotações", reasoning_title: "Raciocínio do agente",
    th_rank: "#", th_vendor: "Fornecedor", th_unit_price: "Preço unitário", th_total: "Total",
    th_delivery: "Entrega (dias)", th_warranty: "Garantia (meses)", th_terms: "Condições de pagamento",
    th_rating: "Avaliação", th_score: "Pontuação",
    tab_rules: "Regras", tab_vendors: "Fornecedores", tab_audit: "Auditoria", tab_kpis: "Indicadores", tab_weights: "Pesos",
    kpi_touchless: "% sem intervenção até aprovação", kpi_avg_savings: "Economia média",
    kpi_cycle_time: "Ciclo médio (solicitação → OC)", kpi_violations: "Violações de política detectadas",
    audit_title: "Registro de auditoria", audit_actor: "Ator", audit_action: "Ação", audit_when: "Data",
    po_title: "Ordem de Compra", po_number: "Número da OC", po_vendor: "Fornecedor", po_total: "Total",
    po_erp_ref: "Referência ERP", po_issued_at: "Data de emissão", po_print: "Imprimir",
    could_not_parse_request: "Não foi possível interpretar a solicitação; reformule-a",
    requests_title: "Minhas solicitações", approvals_title: "Fila de aprovação", empty_queue: "Nada pendente",
    days_suffix: "dias",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type MsgKey = keyof typeof dict.es;

export function t(locale: Locale, key: MsgKey, params?: Record<string, string | number>): string {
  let s: string = dict[locale][key] ?? dict.es[key] ?? key;
  for (const [k, v] of Object.entries(params ?? {})) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

const NUMBER_LOCALE: Record<Locale, string> = { es: "es-MX", en: "en-US", pt: "pt-BR" };

/** Money always renders with the value's OWN currency — never assume the tenant currency. */
export function fmtMoney(amount: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale], { style: "currency", currency }).format(amount);
}
```

- [ ] **Step 14.4: Run tests — pass** (`npm test`)

- [ ] **Step 14.5: Server helper for locale, in `lib/personas.ts`** (append)

```ts
import type { Locale } from "@/lib/types";

export function resolveLocale(cookieValue: string | undefined): Locale {
  return cookieValue === "en" || cookieValue === "pt" ? cookieValue : "es";
}
```

- [ ] **Step 14.6: Write the UI shell**

`app/layout.tsx`:

```tsx
import "./globals.css";
import Link from "next/link";
import { cookies } from "next/headers";
import { PERSONAS, resolvePersona, resolveLocale } from "@/lib/personas";
import { t } from "@/lib/i18n";
import { PersonaSwitcher } from "./components/PersonaSwitcher";
import { LocaleSwitcher } from "./components/LocaleSwitcher";

export const metadata = { title: "compras-agent" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const persona = resolvePersona(jar.get("persona")?.value);
  const locale = resolveLocale(jar.get("locale")?.value);

  return (
    <html lang={locale}>
      <body className="bg-slate-50 text-slate-900">
        <header className="flex items-center gap-6 border-b bg-white px-6 py-3">
          <span className="font-semibold">{t(locale, "app_name")}</span>
          <nav className="flex gap-4 text-sm">
            <Link href="/solicitudes" className="hover:underline">{t(locale, "nav_requests")}</Link>
            <Link href="/aprobaciones" className="hover:underline">{t(locale, "nav_approvals")}</Link>
            <Link href="/admin" className="hover:underline">{t(locale, "nav_admin")}</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <LocaleSwitcher current={locale} />
            <PersonaSwitcher current={persona} labels={{
              requester: t(locale, "persona_requester"),
              approver: t(locale, "persona_approver"),
              admin: t(locale, "persona_admin"),
            }} />
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-6">{children}</main>
      </body>
    </html>
  );
}
```

`app/page.tsx`:

```tsx
import { redirect } from "next/navigation";
export default function Home() { redirect("/solicitudes"); }
```

`app/components/PersonaSwitcher.tsx`:

```tsx
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
```

`app/components/LocaleSwitcher.tsx`:

```tsx
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
```

`app/components/StatusBadge.tsx`:

```tsx
import { t, MsgKey } from "@/lib/i18n";
import type { Locale, RequisitionStatus } from "@/lib/types";

const COLORS: Record<RequisitionStatus, string> = {
  intake: "bg-slate-200 text-slate-700",
  policy_check: "bg-slate-200 text-slate-700",
  sourcing: "bg-blue-100 text-blue-800",
  quoted: "bg-indigo-100 text-indigo-800",
  recommended: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  po_issued: "bg-emerald-200 text-emerald-900",
  flagged: "bg-orange-100 text-orange-800",
};

export function StatusBadge({ status, locale }: { status: RequisitionStatus; locale: Locale }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[status]}`}>
      {t(locale, `status_${status}` as MsgKey)}
    </span>
  );
}
```

- [ ] **Step 14.7: Verify in browser, commit**

`npm run dev` → http://localhost:3000 redirects to /solicitudes (404 body is fine for now); top bar shows nav + both switchers; switching locale re-renders labels in en/pt.

```powershell
git add lib/i18n.ts lib/personas.ts tests/i18n.test.ts app/layout.tsx app/page.tsx app/components
git commit -m "feat: es/en/pt i18n core (TDD), UI shell, persona and locale switchers"
```

---

### Task 15: UI — /solicitudes (requester: form + list + detail)

**Files:**
- Create: `app/components/NewRequestForm.tsx`, `app/components/PipelineControls.tsx`
- Create: `app/solicitudes/page.tsx`, `app/solicitudes/[id]/page.tsx`

- [ ] **Step 15.1: Write `app/components/NewRequestForm.tsx`** (client; handles the one-clarification round-trip)

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewRequestForm({ labels }: { labels: Record<string, string> }) {
  const router = useRouter();
  const [rawText, setRawText] = useState("");
  const [budget, setBudget] = useState("");
  const [needBy, setNeedBy] = useState("");
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(clarified: boolean) {
    setBusy(true); setError(null);
    const res = await fetch("/api/requisitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        raw_text: clarified ? `${rawText}\n[Aclaración] ${answer}` : rawText,
        budget: budget ? Number(budget) : undefined,
        need_by: needBy || undefined,
        clarification_answered: clarified,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "error"); return; }
    if (data.needs_clarification) { setQuestion(data.question); return; }
    setQuestion(null); setRawText(""); setBudget(""); setNeedBy(""); setAnswer("");
    router.refresh();
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="mb-3 font-semibold">{labels.form_title}</h2>
      <textarea
        className="mb-2 w-full rounded border p-2" rows={3}
        placeholder={labels.form_raw_text}
        value={rawText} onChange={(e) => setRawText(e.target.value)}
      />
      <div className="mb-2 flex gap-2">
        <input className="w-40 rounded border p-2" type="number" placeholder={labels.form_budget}
          value={budget} onChange={(e) => setBudget(e.target.value)} />
        <input className="w-44 rounded border p-2" type="date" title={labels.form_need_by}
          value={needBy} onChange={(e) => setNeedBy(e.target.value)} />
        <button
          className="ml-auto rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
          disabled={busy || !rawText.trim()} onClick={() => submit(false)}>
          {labels.form_submit}
        </button>
      </div>
      {question && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-medium">{labels.form_clarification} {question}</p>
          <div className="flex gap-2">
            <input className="flex-1 rounded border p-2" value={answer}
              onChange={(e) => setAnswer(e.target.value)} />
            <button className="rounded bg-amber-600 px-3 py-2 text-white disabled:opacity-50"
              disabled={busy || !answer.trim()} onClick={() => submit(true)}>
              {labels.form_answer_send}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 15.2: Write `app/components/PipelineControls.tsx`** (admin demo buttons: source → simulate → recommend)

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const STEPS = [
  { key: "source", url: "/api/agent/source", forStatus: "sourcing" },
  { key: "simulate", url: "/api/agent/simulate-replies", forStatus: "sourcing" },
  { key: "recommend", url: "/api/agent/recommend", forStatus: "quoted" },
] as const;

export function PipelineControls({ requisitionId, status, labels }: {
  requisitionId: string; status: string; labels: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(step: (typeof STEPS)[number]) {
    setBusy(step.key); setError(null);
    const res = await fetch(step.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requisition_id: requisitionId }),
    });
    setBusy(null);
    if (!res.ok) { setError((await res.json()).error ?? "error"); return; }
    router.refresh();
  }

  const buttons = [
    { step: STEPS[0], label: labels.btn_source, show: status === "sourcing" },
    { step: STEPS[1], label: labels.btn_simulate_replies, show: status === "sourcing" },
    { step: STEPS[2], label: labels.btn_recommend, show: status === "quoted" },
  ].filter(b => b.show);

  if (!buttons.length) return null;
  return (
    <div className="flex gap-2">
      {buttons.map(({ step, label }) => (
        <button key={step.key}
          className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          disabled={busy !== null} onClick={() => run(step)}>
          {busy === step.key ? "…" : label}
        </button>
      ))}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 15.3: Write `app/solicitudes/page.tsx`**

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { getDb, COMPANY_ID } from "@/lib/db";
import { resolveLocale } from "@/lib/personas";
import { t, fmtMoney } from "@/lib/i18n";
import { StatusBadge } from "@/app/components/StatusBadge";
import { NewRequestForm } from "@/app/components/NewRequestForm";

export const dynamic = "force-dynamic";

export default async function SolicitudesPage() {
  const locale = resolveLocale((await cookies()).get("locale")?.value);
  const { data: reqs } = await getDb().from("requisitions")
    .select("*").eq("company_id", COMPANY_ID).order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <NewRequestForm labels={{
        form_title: t(locale, "form_title"), form_raw_text: t(locale, "form_raw_text"),
        form_budget: t(locale, "form_budget"), form_need_by: t(locale, "form_need_by"),
        form_submit: t(locale, "form_submit"), form_clarification: t(locale, "form_clarification"),
        form_answer_send: t(locale, "form_answer_send"),
      }} />
      <div className="rounded-lg border bg-white">
        <h2 className="border-b px-4 py-3 font-semibold">{t(locale, "requests_title")}</h2>
        <table className="w-full text-sm">
          <tbody>
            {(reqs ?? []).map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link className="text-blue-700 hover:underline" href={`/solicitudes/${r.id}`}>
                    {r.raw_text.slice(0, 80)}
                  </Link>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.estimated_amount ? fmtMoney(Number(r.estimated_amount), r.currency, locale) : "—"}
                </td>
                <td className="px-4 py-2"><StatusBadge status={r.status} locale={locale} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 15.4: Write `app/solicitudes/[id]/page.tsx`** (detail: structured fields, policy verdict, audit timeline, pipeline controls for admin)

```tsx
import { cookies } from "next/headers";
import { getDb, COMPANY_ID } from "@/lib/db";
import { resolveLocale, resolvePersona } from "@/lib/personas";
import { t, fmtMoney, MsgKey } from "@/lib/i18n";
import { StatusBadge } from "@/app/components/StatusBadge";
import { PipelineControls } from "@/app/components/PipelineControls";
import type { CitedRule } from "@/lib/services/policy-engine";

export const dynamic = "force-dynamic";

export default async function RequisitionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jar = await cookies();
  const locale = resolveLocale(jar.get("locale")?.value);
  const persona = resolvePersona(jar.get("persona")?.value);
  const db = getDb();

  const { data: r } = await db.from("requisitions").select("*").eq("id", id).single();
  if (!r) return <p>404</p>;
  const { data: audit } = await db.from("audit_log").select("*")
    .eq("requisition_id", id).order("created_at", { ascending: true });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{r.raw_text.slice(0, 100)}</h1>
        <StatusBadge status={r.status} locale={locale} />
      </div>

      {persona === "admin" && (
        <PipelineControls requisitionId={id} status={r.status} labels={{
          btn_source: t(locale, "btn_source"),
          btn_simulate_replies: t(locale, "btn_simulate_replies"),
          btn_recommend: t(locale, "btn_recommend"),
        }} />
      )}

      {r.policy_result && (
        <section className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 font-semibold">{t(locale, "policy_verdict_title")}:{" "}
            {t(locale, `policy_${r.policy_result.verdict === "pass" ? "pass" : r.policy_result.verdict}` as MsgKey)}
          </h2>
          <ul className="list-disc pl-5 text-sm">
            {(r.policy_result.rules_cited as CitedRule[]).map((c, i) => (
              <li key={i}>
                <span className="font-mono font-medium">{c.rule_code}</span>{": "}
                {t(locale, c.reason_key as MsgKey, c.params)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 font-semibold">{t(locale, "audit_title")}</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500">
            <th className="py-1">{t(locale, "audit_when")}</th>
            <th>{t(locale, "audit_actor")}</th>
            <th>{t(locale, "audit_action")}</th>
          </tr></thead>
          <tbody>
            {(audit ?? []).map((a) => (
              <tr key={a.id} className="border-t">
                <td className="py-1 tabular-nums">{new Date(a.created_at).toLocaleString()}</td>
                <td>{a.actor}</td>
                <td className="font-mono text-xs">{a.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <a className="mt-2 inline-block text-sm text-blue-700 hover:underline"
           href={`/api/audit/export?requisition_id=${id}`}>
          {t(locale, "btn_export_csv")}
        </a>
      </section>
    </div>
  );
}
```

- [ ] **Step 15.5: Verify and commit**

Browser: submit the demo laptop sentence → row appears with status; open detail → policy verdict in current locale; switch to admin persona → pipeline buttons appear; run source → simulate → recommend end-to-end from the UI.

```powershell
git add app/solicitudes app/components/NewRequestForm.tsx app/components/PipelineControls.tsx
git commit -m "feat: requester screens — form with clarification loop, list, detail (F1 UI)"
```

---

### Task 16: UI — /aprobaciones (HERO screen, F6)

**Files:**
- Create: `app/components/ApprovalActions.tsx`
- Create: `app/aprobaciones/page.tsx`, `app/aprobaciones/[id]/page.tsx`

This is the screen the spec says to polish most: requisition summary, policy verdict, side-by-side comparison table, recommendation + verbatim reasoning trace, savings figure, one-click actions.

- [ ] **Step 16.1: Write `app/components/ApprovalActions.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ApprovalActions({ requisitionId, labels }: {
  requisitionId: string; labels: Record<string, string>;
}) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected" | "info_requested") {
    if (decision === "rejected" && !comment.trim()) {
      setError(labels.reject_comment_required); return;
    }
    setBusy(true); setError(null);
    const res = await fetch("/api/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requisition_id: requisitionId, decision, comment: comment || undefined }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "error"); return; }
    const data = await res.json();
    if (data.status === "po_issued" && data.po_id) router.push(`/po/${data.po_id}`);
    else router.refresh();
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <input className="mb-3 w-full rounded border p-2 text-sm" placeholder="…"
        value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="flex gap-3">
        <button className="rounded bg-emerald-600 px-5 py-2 font-medium text-white disabled:opacity-50"
          disabled={busy} onClick={() => decide("approved")}>{labels.btn_approve}</button>
        <button className="rounded bg-red-600 px-5 py-2 font-medium text-white disabled:opacity-50"
          disabled={busy} onClick={() => decide("rejected")}>{labels.btn_reject}</button>
        <button className="rounded border px-5 py-2 font-medium disabled:opacity-50"
          disabled={busy} onClick={() => decide("info_requested")}>{labels.btn_request_info}</button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 16.2: Write `app/aprobaciones/page.tsx`** (queue of `recommended` requisitions)

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { getDb, COMPANY_ID } from "@/lib/db";
import { resolveLocale } from "@/lib/personas";
import { t, fmtMoney } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function AprobacionesPage() {
  const locale = resolveLocale((await cookies()).get("locale")?.value);
  const { data: reqs } = await getDb().from("requisitions")
    .select("*").eq("company_id", COMPANY_ID).eq("status", "recommended")
    .order("created_at", { ascending: true });

  return (
    <div className="rounded-lg border bg-white">
      <h1 className="border-b px-4 py-3 font-semibold">{t(locale, "approvals_title")}</h1>
      {!reqs?.length && <p className="px-4 py-6 text-sm text-slate-500">{t(locale, "empty_queue")}</p>}
      {(reqs ?? []).map((r) => (
        <Link key={r.id} href={`/aprobaciones/${r.id}`}
          className="flex items-center justify-between border-b px-4 py-3 last:border-0 hover:bg-slate-50">
          <span>{r.raw_text.slice(0, 90)}</span>
          <span className="tabular-nums font-medium">
            {r.estimated_amount ? fmtMoney(Number(r.estimated_amount), r.currency, locale) : "—"}
          </span>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 16.3: Write `app/aprobaciones/[id]/page.tsx`** (the hero)

```tsx
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { resolveLocale } from "@/lib/personas";
import { t, fmtMoney, MsgKey } from "@/lib/i18n";
import { StatusBadge } from "@/app/components/StatusBadge";
import { ApprovalActions } from "@/app/components/ApprovalActions";
import type { CitedRule } from "@/lib/services/policy-engine";
import type { ScoredQuote } from "@/lib/services/quote-scorer";
import type { SavingsResult } from "@/lib/services/savings-calc";

export const dynamic = "force-dynamic";

export default async function ApprovalDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = resolveLocale((await cookies()).get("locale")?.value);
  const db = getDb();

  const { data: r } = await db.from("requisitions").select("*").eq("id", id).single();
  const { data: rec } = await db.from("recommendations")
    .select("*").eq("requisition_id", id).order("created_at", { ascending: false }).limit(1).single();
  if (!r || !rec) return <p>404</p>;

  const ranked = (rec.scoring.ranked ?? []) as ScoredQuote[];
  const savings = rec.scoring.savings as SavingsResult | undefined;
  const winner = ranked[0];

  return (
    <div className="space-y-6">
      {/* summary */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{r.raw_text.slice(0, 100)}</h1>
        <StatusBadge status={r.status} locale={locale} />
      </div>

      {/* policy verdict */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-500">{t(locale, "policy_verdict_title")}</h2>
        <ul className="text-sm">
          {(r.policy_result?.rules_cited as CitedRule[] ?? []).map((c, i) => (
            <li key={i}>
              <span className="font-mono font-medium">{c.rule_code}</span>{": "}
              {t(locale, c.reason_key as MsgKey, c.params)}
            </li>
          ))}
        </ul>
      </section>

      {/* comparison table — the centerpiece */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-3 font-semibold">{t(locale, "comparison_title")}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="py-2">{t(locale, "th_rank")}</th>
              <th>{t(locale, "th_vendor")}</th>
              <th className="text-right">{t(locale, "th_unit_price")}</th>
              <th className="text-right">{t(locale, "th_total")}</th>
              <th className="text-right">{t(locale, "th_delivery")}</th>
              <th className="text-right">{t(locale, "th_warranty")}</th>
              <th>{t(locale, "th_terms")}</th>
              <th className="text-right">{t(locale, "th_rating")}</th>
              <th className="text-right">{t(locale, "th_score")}</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((q) => (
              <tr key={q.quote_id}
                  className={`border-b last:border-0 ${q.rank === 1 ? "bg-emerald-50 font-medium" : ""}`}>
                <td className="py-2">{q.rank}</td>
                <td>{q.vendor_name}</td>
                <td className="text-right tabular-nums">{fmtMoney(q.unit_price, q.currency, locale)}</td>
                <td className="text-right tabular-nums">{fmtMoney(q.total, q.currency, locale)}</td>
                <td className="text-right tabular-nums">{q.delivery_days}</td>
                <td className="text-right tabular-nums">{q.warranty_months}</td>
                <td>{q.payment_terms}</td>
                <td className="text-right tabular-nums">{q.vendor_rating.toFixed(1)}</td>
                <td className="text-right tabular-nums">{q.total_score.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* reasoning trace — rendered verbatim (spec rule #4) + savings */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 font-semibold">{t(locale, "reasoning_title")}</h2>
        <p className="whitespace-pre-wrap text-sm leading-6">{rec.reasoning_trace}</p>
        <div className="mt-4 rounded bg-slate-50 p-3 text-sm">
          <span className="font-semibold">{t(locale, "savings_label")}: </span>
          {savings?.counted ? (
            <>
              <span className="font-medium text-emerald-700">
                {fmtMoney(savings.savings, savings.currency, locale)}
              </span>{" "}
              {t(locale, "savings_baseline_source",
                 { count: savings.baseline_count, category: savings.category })}
            </>
          ) : (
            <span className="text-slate-500">
              {t(locale, "savings_not_counted", { category: savings?.category ?? r.category })}
            </span>
          )}
        </div>
      </section>

      {r.status === "recommended" && winner && (
        <ApprovalActions requisitionId={id} labels={{
          btn_approve: t(locale, "btn_approve"),
          btn_reject: t(locale, "btn_reject"),
          btn_request_info: t(locale, "btn_request_info"),
          reject_comment_required: t(locale, "reject_comment_required"),
        }} />
      )}
    </div>
  );
}
```

- [ ] **Step 16.4: Verify and commit**

Browser as approver persona: queue lists the recommended requisition; hero screen shows table (winner highlighted), verbatim trace, savings with named baseline; Approve navigates to the PO page (Task 18); Reject without comment shows the localized validation error.

```powershell
git add app/aprobaciones app/components/ApprovalActions.tsx
git commit -m "feat: approval queue and hero comparison screen (F6 UI)"
```

---

### Task 17: UI — /admin (rules, vendors, audit, KPIs, weights) (F9 + F10)

**Files:**
- Create: `app/admin/page.tsx`, `app/admin/actions.ts`

- [ ] **Step 17.1: Write `app/admin/actions.ts`** (server action for editable weights — F5 AC)

```ts
"use server";
import { revalidatePath } from "next/cache";
import { getDb, COMPANY_ID } from "@/lib/db";
import { createAuditLogger } from "@/lib/services/audit-logger";
import { PERSONAS } from "@/lib/personas";

export async function saveWeights(formData: FormData) {
  const weights = {
    price: Number(formData.get("price")),
    delivery: Number(formData.get("delivery")),
    terms: Number(formData.get("terms")),
    rating: Number(formData.get("rating")),
  };
  const sum = weights.price + weights.delivery + weights.terms + weights.rating;
  if (Math.abs(sum - 1) > 0.001) throw new Error("weights must sum to 1");

  const db = getDb();
  await db.from("companies").update({ scoring_weights: weights }).eq("id", COMPANY_ID);
  await createAuditLogger(db, COMPANY_ID).log({
    requisition_id: null, actor: PERSONAS.admin.id,
    action: "weights.updated", payload: weights,
  });
  revalidatePath("/admin");
}
```

- [ ] **Step 17.2: Write `app/admin/page.tsx`** (tabs via `?tab=` searchParam; KPIs computed live from real tables — F10)

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { getDb, getTenant, COMPANY_ID } from "@/lib/db";
import { resolveLocale } from "@/lib/personas";
import { t, fmtMoney, MsgKey } from "@/lib/i18n";
import { saveWeights } from "./actions";
import type { SavingsResult } from "@/lib/services/savings-calc";

export const dynamic = "force-dynamic";

const TABS = ["kpis", "rules", "vendors", "audit", "weights"] as const;

export default async function AdminPage({ searchParams }: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab = (TABS as readonly string[]).includes(rawTab ?? "") ? rawTab! : "kpis";
  const locale = resolveLocale((await cookies()).get("locale")?.value);
  const db = getDb();
  const tenant = await getTenant();

  const TAB_LABELS: Record<string, MsgKey> = {
    kpis: "tab_kpis", rules: "tab_rules", vendors: "tab_vendors",
    audit: "tab_audit", weights: "tab_weights",
  };

  return (
    <div className="space-y-4">
      <nav className="flex gap-2 border-b pb-2">
        {TABS.map((k) => (
          <Link key={k} href={`/admin?tab=${k}`}
            className={`rounded px-3 py-1.5 text-sm ${tab === k ? "bg-slate-900 text-white" : "hover:bg-slate-200"}`}>
            {t(locale, TAB_LABELS[k])}
          </Link>
        ))}
      </nav>

      {tab === "kpis" && <Kpis locale={locale} />}
      {tab === "rules" && <Rules locale={locale} currency={tenant.currency} />}
      {tab === "vendors" && <Vendors />}
      {tab === "audit" && <Audit locale={locale} />}
      {tab === "weights" && <Weights locale={locale} weights={tenant.scoring_weights} />}
    </div>
  );
}

async function Kpis({ locale }: { locale: "es" | "en" | "pt" }) {
  const db = getDb();
  // F10: computed live from real tables — the exact instrumentation the pilot will use
  const { data: reqs } = await db.from("requisitions")
    .select("id, status, created_at, policy_result").eq("company_id", COMPANY_ID);
  const { data: pos } = await db.from("purchase_orders").select("requisition_id, issued_at");
  const { data: recs } = await db.from("recommendations").select("requisition_id, scoring");
  const { data: infoReqs } = await db.from("approvals").select("requisition_id").eq("decision", "info_requested");

  const reached = (reqs ?? []).filter(r => ["recommended", "approved", "po_issued"].includes(r.status));
  const issued = (reqs ?? []).filter(r => r.status === "po_issued");
  const touched = new Set((infoReqs ?? []).map(a => a.requisition_id));
  const touchless = issued.filter(r => !touched.has(r.id));
  const touchlessPct = reached.length ? Math.round((touchless.length / reached.length) * 100) : 0;

  const savingsPcts = (recs ?? []).flatMap(rec => {
    const s = rec.scoring?.savings as SavingsResult | undefined;
    if (!s?.counted) return [];
    return [(s.savings / (s.baseline_unit_price * s.qty)) * 100]; // qty carried in SavingsResult (Task 6)
  });
  const avgSavingsPct = savingsPcts.length
    ? (savingsPcts.reduce((a, b) => a + b, 0) / savingsPcts.length).toFixed(1) : "0.0";

  const byId = new Map((reqs ?? []).map(r => [r.id, r]));
  const cycleDays = (pos ?? []).flatMap(po => {
    const r = byId.get(po.requisition_id);
    return r ? [(Date.parse(po.issued_at) - Date.parse(r.created_at)) / 86400000] : [];
  });
  const avgCycle = cycleDays.length
    ? (cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length).toFixed(1) : "—";

  const violations = (reqs ?? []).filter(r =>
    r.policy_result && r.policy_result.verdict !== "pass").length;

  const tiles = [
    { label: t(locale, "kpi_touchless"), value: `${touchlessPct}%` },
    { label: t(locale, "kpi_avg_savings"), value: `${avgSavingsPct}%` },
    { label: t(locale, "kpi_cycle_time"), value: `${avgCycle} ${t(locale, "days_suffix")}` },
    { label: t(locale, "kpi_violations"), value: String(violations) },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((k) => (
        <div key={k.label} className="rounded-lg border bg-white p-4">
          <p className="text-3xl font-semibold tabular-nums">{k.value}</p>
          <p className="mt-1 text-sm text-slate-500">{k.label}</p>
        </div>
      ))}
    </div>
  );
}

async function Rules({ locale, currency }: { locale: "es" | "en" | "pt"; currency: string }) {
  const { data } = await getDb().from("policies").select("*")
    .eq("company_id", COMPANY_ID).order("rule_code");
  return (
    <table className="w-full rounded-lg border bg-white text-sm">
      <tbody>
        {(data ?? []).map((p) => (
          <tr key={p.id} className="border-b last:border-0">
            <td className="px-4 py-2 font-mono font-medium">{p.rule_code}</td>
            <td className="px-4 py-2">{p.category ?? "*"}</td>
            <td className="px-4 py-2">{p.action}</td>
            <td className="px-4 py-2 text-right tabular-nums">
              {p.max_amount ? fmtMoney(Number(p.max_amount), currency, locale) : "—"}
            </td>
            <td className="px-4 py-2">{p.approval_route}</td>
            <td className="px-4 py-2">{p.active ? "✓" : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function Vendors() {
  const { data } = await getDb().from("vendors").select("*")
    .eq("company_id", COMPANY_ID).order("name");
  return (
    <table className="w-full rounded-lg border bg-white text-sm">
      <tbody>
        {(data ?? []).map((v) => (
          <tr key={v.id} className={`border-b last:border-0 ${v.status === "blocked" ? "bg-red-50" : ""}`}>
            <td className="px-4 py-2 font-medium">{v.name}</td>
            <td className="px-4 py-2">{v.categories.join(", ")}</td>
            <td className="px-4 py-2">{v.status}</td>
            <td className="px-4 py-2 text-right tabular-nums">{Number(v.rating).toFixed(1)}</td>
            <td className="px-4 py-2 text-slate-500">{v.notes}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function Audit({ locale }: { locale: "es" | "en" | "pt" }) {
  const { data } = await getDb().from("audit_log").select("*")
    .eq("company_id", COMPANY_ID).order("created_at", { ascending: false }).limit(100);
  return (
    <div className="rounded-lg border bg-white">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="font-semibold">{t(locale, "audit_title")}</h2>
        <a className="text-sm text-blue-700 hover:underline" href="/api/audit/export">
          {t(locale, "btn_export_csv")}
        </a>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {(data ?? []).map((a) => (
            <tr key={a.id} className="border-b last:border-0">
              <td className="px-4 py-1.5 tabular-nums">{new Date(a.created_at).toLocaleString()}</td>
              <td className="px-4 py-1.5">{a.actor.length > 12 ? a.actor.slice(0, 8) : a.actor}</td>
              <td className="px-4 py-1.5 font-mono text-xs">{a.action}</td>
              <td className="px-4 py-1.5 font-mono text-xs text-slate-400">
                {a.requisition_id?.slice(0, 8) ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Weights({ locale, weights }: {
  locale: "es" | "en" | "pt";
  weights: Record<string, number>;
}) {
  return (
    <form action={saveWeights} className="max-w-md space-y-3 rounded-lg border bg-white p-4">
      {(["price", "delivery", "terms", "rating"] as const).map((k) => (
        <label key={k} className="flex items-center justify-between gap-3 text-sm">
          <span className="capitalize">{k}</span>
          <input name={k} type="number" step="0.05" min="0" max="1"
            defaultValue={weights[k]} className="w-24 rounded border p-1.5 text-right" />
        </label>
      ))}
      <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white">
        {t(locale, "btn_save_weights")}
      </button>
    </form>
  );
}
```

- [ ] **Step 17.3: Verify and commit**

Browser as admin: 4 KPI tiles render numbers that reconcile with the tables; rules tab shows R-01…R-08 with localized amounts; vendors tab shows TecnoBarato highlighted red; audit tab lists newest-first with CSV link; weights tab: set price=1, others=0 → re-run recommend on a fresh requisition → cheapest vendor now wins (F5 AC).

```powershell
git add app/admin
git commit -m "feat: admin — KPI tiles, rules, vendors, audit log, editable weights (F9, F10)"
```

---

### Task 18: UI — printable PO view (F7)

**Files:**
- Create: `app/po/[id]/page.tsx`

- [ ] **Step 18.1: Write `app/po/[id]/page.tsx`**

```tsx
import { cookies } from "next/headers";
import { getDb, getTenant } from "@/lib/db";
import { resolveLocale } from "@/lib/personas";
import { t, fmtMoney } from "@/lib/i18n";
import type { StructuredRequisition } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function POView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = resolveLocale((await cookies()).get("locale")?.value);
  const db = getDb();
  const tenant = await getTenant();

  const { data: po } = await db.from("purchase_orders")
    .select("*, vendors(name, contact_email, tax_id), requisitions(raw_text, structured, need_by)")
    .eq("id", id).single();
  if (!po) return <p>404</p>;
  const structured = po.requisitions.structured as StructuredRequisition;

  return (
    <div className="mx-auto max-w-2xl bg-white p-10 shadow print:shadow-none">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t(locale, "po_title")}</h1>
          <p className="font-mono text-lg">{po.po_number}</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold">{tenant.name}</p>
          <p>{t(locale, "po_issued_at")}: {new Date(po.issued_at).toLocaleDateString()}</p>
          <p>{t(locale, "po_erp_ref")}: <span className="font-mono">{po.erp_ref}</span></p>
        </div>
      </div>

      <div className="mb-6 text-sm">
        <p className="font-semibold">{t(locale, "po_vendor")}: {po.vendors.name}</p>
        <p className="text-slate-500">{po.vendors.contact_email}</p>
        {po.vendors.tax_id && <p className="text-slate-500">RFC/Tax ID: {po.vendors.tax_id}</p>}
      </div>

      <table className="mb-6 w-full text-sm">
        <thead><tr className="border-b text-left">
          <th className="py-2">Item</th><th className="text-right">Qty</th>
        </tr></thead>
        <tbody>
          {structured.items.map((it, i) => (
            <tr key={i} className="border-b">
              <td className="py-2">{it.description}</td>
              <td className="py-2 text-right tabular-nums">{it.qty} {it.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-right text-xl font-semibold tabular-nums">
        {t(locale, "po_total")}: {fmtMoney(Number(po.total), po.currency, locale)}
      </p>

      <button className="mt-8 rounded border px-4 py-2 text-sm print:hidden"
        // eslint-disable-next-line react/no-unknown-property
        onClick={undefined}>
        <a href="javascript:window.print()">{t(locale, "po_print")}</a>
      </button>
    </div>
  );
}
```

**Implementation note:** the print button via `javascript:` href is a placeholder — implement as a tiny `"use client"` `<PrintButton/>` component calling `window.print()` (3 lines). Server components can't have onClick.

- [ ] **Step 18.2: Verify and commit**

Approve a requisition → lands on `/po/<id>`: vendor, line items, total in the PO's own currency, PO number, ERP ref (`STUB-####` looks like a real ERP ref on screen — spec: stubs must look real). Print preview is clean.

```powershell
git add app/po
git commit -m "feat: printable PO view with ERP ref (F7 UI)"
```

---

### Task 19: Country-compliance forward design (CFDI), demo dry-run + deploy

**Files:**
- Create: `lib/adapters/invoice.ts` (interface only — v0 ships no implementation)
- Create: `docs/demo-script.md`

- [ ] **Step 19.1: Write `lib/adapters/invoice.ts`** — the CFDI/e-invoice seam

Mexican law mandates CFDI 4.0: every vendor invoice is a structured, SAT-stamped XML — so invoice ingestion in MX is **XML parsing + fiscal validation (UUID, RFC match, SAT status), not OCR**. OCR/LLM extraction is the variant for the US and other markets without structured e-invoicing. v0 ships only the interface so v1 country modules drop in without touching agent or approval code (same pattern as `ERPAdapter`/`Mailer`):

```ts
/**
 * Country-variant invoice ingestion (v1+; interface reserved in v0).
 *
 * MX  → CfdiInvoiceAdapter: parse CFDI 4.0 XML, validate SAT stamp (UUID),
 *       match issuer RFC against vendors.tax_id, check SAT cancellation status.
 *       Deterministic — no OCR, no LLM.
 * US/intl → OcrInvoiceAdapter: LLM/OCR extraction from PDF/image invoices,
 *       lower confidence, human-review queue.
 *
 * Both feed the same NormalizedInvoice so 3-way match (PO ↔ receipt ↔ invoice)
 * is country-agnostic.
 */
export interface NormalizedInvoice {
  vendor_tax_id: string | null;   // RFC (MX) / EIN (US)
  invoice_number: string;         // CFDI folio or vendor invoice no.
  fiscal_uuid: string | null;     // CFDI UUID (MX only)
  total: number;
  currency: string;               // ISO 4217
  issued_at: string;              // ISO date
  line_items: { description: string; qty: number; unit_price: number }[];
  confidence: "exact" | "extracted"; // exact = structured source (CFDI), extracted = OCR
}

export interface InvoiceIngestionAdapter {
  /** country code this adapter serves, e.g. 'MX', 'US' */
  readonly country: string;
  ingest(payload: { content: Buffer; mime_type: string }): Promise<NormalizedInvoice>;
}

/** v1: registry keyed by companies.country — getInvoiceAdapter(tenant.country). */
```

- [ ] **Step 19.2: Write `docs/demo-script.md`** — the 10-minute script (§3) as a checklist

```markdown
# Demo dry-run (10 min) — run 3× before Sunday night

Pre-flight: `npm run seed` on the production Supabase; deployed URL open; locale = ES; persona = Solicitante.

1. [Solicitante] Submit: "Necesito 8 laptops para el equipo de ventas, presupuesto ~MXN 180,000, para el 15 de julio"
   → status pasa a "Buscando proveedores"; abrir detalle: verdict R-01 visible.
2. [Admin] On the detail page: "Buscar proveedores y enviar RFQs" → audit shows 4-5 vendors selected,
   TecnoBarato excluded (blocked). Then "Simular respuestas" → "Generar recomendación".
3. [Aprobador] Open Aprobaciones → hero screen: table, winner highlighted, reasoning in Spanish,
   savings vs 6 historical purchases. Click Aprobar → PO page with PO-2026-XXXX + ERP ref.
4. [Solicitante] List shows "OC emitida".
5. Guardrail demo: submit "Viaje a Las Vegas para 4 personas, 60,000" → rejected citing R-06 on screen.
6. [Admin] KPI tab: 4 tiles reconcile. Audit tab: full story ≥10 entries; export CSV.
7. Multilingual beat (30 s): switch locale EN → entire UI re-renders in English; switch PT → Portuguese.
   (Same data, same audit trail — the structured payloads localize at render time.)

If any step needs dev intervention, fix before the demo — Definition of Done requires zero.
```

- [ ] **Step 19.3: Full test + build gate**

```powershell
npm test          # all suites green
npx tsc --noEmit  # clean
npm run build     # production build succeeds
```

- [ ] **Step 19.4: Deploy to Vercel**

```powershell
npm install -g vercel
vercel --prod
```
Set env vars in the Vercel dashboard (`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), redeploy, run the demo script against the deployed URL.

- [ ] **Step 19.5: Final commit**

```powershell
git add lib/adapters/invoice.ts docs/demo-script.md
git commit -m "feat: CFDI-ready invoice ingestion interface, demo script, deploy"
```

---

## Definition of Done checklist (spec §11) — verify before calling it shipped

- [ ] Full demo script runs end-to-end on the deployed URL without dev intervention
- [ ] Policy rejection path demonstrable on demand (R-06 / viajes)
- [ ] Every step visible in audit log; trigger blocks UPDATE/DELETE (test: try `update audit_log set actor='x'` in SQL editor → error)
- [ ] Savings figure traceable to named baseline rows; `servicios` category shows "not counted"
- [ ] Dashboard reconciles with data
- [ ] UI fully renders in es, en, and pt; money always shows the value's own currency
- [ ] 10-minute demo rehearsed ×3; stubs look real on screen
- [ ] Zero real client names in code, seed data, or UI

## Self-review notes (spec-coverage pass already applied)

- **F1–F10 → Tasks:** F1→10, F2→4+10, F3→11, F4→11, F5→5+12, F6→13+16, F7→7+13+18, F8→6+12, F9→3+13+15+17, F10→17. Spec §3 demo flow steps [1]–[9] all have owners.
- **Known judgment calls (flagged inline):** `policies.action` column extends the spec schema to make blocked-category rejection deterministic; the PO print button needs a 3-line client component (noted in Task 18); re-seeding accumulates audit rows because the log is append-only (harmless; drop schema to fully reset).
- **i18n/multi-currency (spec amendment):** all deterministic outputs are key+params; dictionaries parity-tested; every money render goes through `fmtMoney(value, value.currency, locale)`.
- **CFDI (spec amendment):** schema carries `companies.country/tax_id` and `vendors.tax_id` now; `InvoiceIngestionAdapter` reserves the country-variant seam; no OCR work in v0.



