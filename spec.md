# SPEC.md — Agentic Tail-Spend Buying Agent (v0 "Weekend MVP")

**Codename:** `compras-agent`
**Version:** 0.1 (Demo-grade MVP — weekend build)
**Owner:** Product Owner / CSIO
**Build target:** Claude Code, single repo, deployable demo by Sunday night
**Language:** Multilingual ES/EN/PT (Spanish-first demo copy, English code/comments). All UI strings through i18n keys from day one; no hardcoded user-facing copy in components or services.
**Currency:** Multi-currency by design, MXN first. Every money value carries its currency; formatting via `Intl.NumberFormat`. v0 demo tenant operates in MXN; USD next.

---

## 1. Product summary

An AI buying agent for mid-market companies ($20M–$500M revenue) worldwide. The product is multilingual (Spanish, English, Portuguese) and multi-currency from the ground up; the launch market is Mexico (MXN, Spanish-first demo). Employees request purchases the way they always have (a simple form in v0; email/WhatsApp in v1). The agent validates the request against company spending policy, identifies candidate vendors, generates RFQs, normalizes and compares the quotes received, and queues a documented recommendation for one-click human approval. Every step is recorded in an immutable audit trail.

**One-liner:** *Every purchase gets three quotes, follows your rules, and leaves a paper trail — without hiring anyone.*

### v0 goal (this weekend)
A working end-to-end demo on realistic seed data that a CEO/CFO can click through in 10 minutes and immediately understand the value. NOT production. Sells the paid pilot.

### Explicit non-goals for v0
- ❌ Live ERP write-back (Odoo/SAP/Oracle) — stubbed behind an adapter interface
- ❌ Actually sending emails to real vendors — RFQs are generated and "sent" to a simulated outbox; replies are simulated
- ❌ Payments of any kind
- ❌ 3-way match / invoice ingestion — but the **country-variant invoice seam ships in v0 as an interface** (`InvoiceIngestionAdapter`). Invoicing is country-specific by law: in Mexico it is **CFDI 4.0** (SAT-stamped structured XML — parsed and fiscally validated deterministically, *not* OCR'd), while the US/international variant is OCR/LLM extraction. Common platform, per-country adapters keyed by `companies.country`.
- ❌ Authentication hardening, multi-tenant isolation (single demo tenant)
- ❌ WhatsApp/email intake (form only in v0)
- ❌ FX conversion between currencies — each tenant operates in one currency in v0, but every money column carries its currency so v1 can mix them

Everything stubbed in v0 sits behind a clean interface so v1 swaps in real implementations without rewrites.

---

## 2. Personas

| Persona | Role in product | What they see |
|---|---|---|
| **Requester** (any employee) | Submits purchase requests | Simple request form + status of their requests |
| **Approver** (admin manager / CFO / owner) | Approves or rejects agent recommendations | Approval queue with side-by-side comparison + reasoning |
| **Admin** (procurement/finance lead) | Owns policies and vendor base | Policy editor, vendor directory, audit log, savings dashboard |

v0 ships one demo user per persona, switchable from a top-bar selector (no real auth).

---

## 3. Core flow (the demo script — build to this)

```
[1] Requester submits: "Necesito 8 laptops para el equipo de ventas, presupuesto ~MXN 180,000, para el 15 de julio"
        │
[2] AGENT — Intake & structuring (Claude API):
    parses free text → structured requisition {category, items, qty, budget, need-by date, urgency}
        │
[3] POLICY ENGINE — deterministic code, NOT LLM:
    checks category allowed, amount vs. threshold, budget owner, approval route
    → PASS (route: single approver) | FLAG (escalate) | REJECT (with cited rule)
        │
[4] AGENT — Vendor discovery:
    queries vendor directory for category matches (approved + open)
    → selects 3–5 candidates, logs why each was selected
        │
[5] AGENT — RFQ generation:
    drafts a structured RFQ per vendor (ES), identical specs, deadline
    → writes to outbox (v0: simulated send; simulated replies arrive after delay)
        │
[6] AGENT — Quote normalization & comparison:
    parses quote replies → normalized table (unit price, total, delivery days,
    warranty, payment terms) → scores against weighted criteria
    → produces RECOMMENDATION + plain-language reasoning trace
        │
[7] HUMAN — Approval queue:
    approver sees comparison table, recommendation, reasoning, policy check results
    → Approve / Reject / Request more info (one click each)
        │
[8] SYSTEM — PO generation:
    on approval: generates PO record + PDF-style PO view, "writes to ERP" (stub adapter),
    notifies requester, computes savings vs. baseline
        │
[9] AUDIT — every step above appended to immutable audit_log with actor, timestamp, payload
```

**Demo seed data must include:** ~30 historical purchases (the savings baseline), ~25 vendors across 6 categories, 3 in-flight requisitions at different stages, 1 requisition that violates policy (to demo the guardrails firing).

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────┐
│  Next.js 15 (App Router) — UI + API routes          │
│  ├─ /solicitudes   (requester)                      │
│  ├─ /aprobaciones  (approver queue)                 │
│  ├─ /admin         (policies, vendors, audit, KPIs) │
│  └─ /api/agent/*   (agent orchestration endpoints)  │
├─────────────────────────────────────────────────────┤
│  Agent layer — Claude API (claude-sonnet-4) w/ tool │
│  use. Each step = explicit tool; NO open-ended      │
│  autonomous loops in v0.                            │
├─────────────────────────────────────────────────────┤
│  Deterministic services (plain TypeScript):         │
│  • PolicyEngine  • QuoteScorer  • SavingsCalc       │
│  • AuditLogger   • ERPAdapter(stub) • Mailer(stub)  │
├─────────────────────────────────────────────────────┤
│  Supabase (Postgres) — single demo tenant           │
└─────────────────────────────────────────────────────┘
```

**Hard architectural rules:**
1. **Policy decisions are deterministic code.** The LLM never decides whether a purchase is allowed; it only structures data and writes text. Policy verdicts must be reproducible and citable ("Rejected per rule R-07: category 'viajes' requires director approval above MXN 50,000").
2. **Every agent step writes to `audit_log` before returning.** No exceptions. The audit trail is the product.
3. **All external side-effects and country-specific integrations go through adapter interfaces** (`ERPAdapter`, `Mailer`, `InvoiceIngestionAdapter`). v0 implements `StubERPAdapter` and `SimulatedMailer` and reserves the invoice interface. v1 swaps in `OdooAdapter` / `SMTPMailer` / `CfdiInvoiceAdapter` (MX) / `OcrInvoiceAdapter` (US/intl) without touching agent code. Country compliance is an adapter variation, never a fork of the platform.
4. **Reasoning traces are first-class data**, stored per recommendation, rendered verbatim in the UI.

---

## 5. Data model (Supabase / Postgres)

```sql
-- Companies (single row in v0, schema ready for multi-tenant)
companies(id, name, currency, locale,        -- locale: es | en | pt
          country,                           -- drives compliance variants (MX → CFDI)
          tax_id,                            -- RFC in MX, EIN in US
          scoring_weights jsonb, created_at)

users(id, company_id, name, email, role)  -- role: requester|approver|admin

vendors(id, company_id, name, categories text[], contact_email,
        status,            -- approved | open | blocked
        rating numeric,
        tax_id,            -- RFC (MX) — CFDI issuer matching + compliance pack in v1
        notes, created_at)

policies(id, company_id, rule_code,        -- e.g. R-01
         category, max_amount numeric,
         min_quotes int default 3,
         approval_route,                    -- auto | single | committee
         active bool, created_at)

requisitions(id, company_id, requester_id,
         raw_text,                          -- what the user typed
         structured jsonb,                  -- agent-parsed fields
         category, estimated_amount numeric, currency text, need_by date,
         status,  -- intake|policy_check|sourcing|quoted|recommended|
                  -- approved|rejected|po_issued|flagged
         policy_result jsonb,               -- verdict + cited rules
         created_at)

rfqs(id, requisition_id, vendor_id, body_text, sent_at,
     status)  -- sent | replied | no_response

quotes(id, rfq_id, vendor_id, raw_reply text,
       normalized jsonb,  -- {unit_price,total,currency,delivery_days,warranty_months,payment_terms}
       received_at)

recommendations(id, requisition_id, winning_quote_id,
       scoring jsonb,         -- per-quote scores + weights used
       reasoning_trace text,  -- plain-language explanation
       savings_vs_baseline numeric, baseline_source text,
       created_at)

approvals(id, requisition_id, approver_id,
       decision,              -- approved | rejected | info_requested
       comment, decided_at)

purchase_orders(id, requisition_id, vendor_id, po_number,
       total numeric, currency, erp_ref text,  -- stub returns 'STUB-####'
       issued_at)

baseline_purchases(id, company_id, category, description,
       unit_price numeric, qty, total numeric, currency text, vendor_name, purchased_at)
       -- seed data: trailing-6-months history for savings math (same-currency rows only)

audit_log(id, company_id, requisition_id, actor,  -- 'agent'|user_id|'system'
       action, payload jsonb, created_at)
       -- append-only; no UPDATE/DELETE grants
```

---

## 6. Feature spec & acceptance criteria

### F1 — Request intake (form)
- Single free-text field + optional fields (category hint, budget, need-by).
- Agent parses free text → structured requisition via Claude API (force JSON output).
- **AC:** Submitting the demo sentence in §3 yields a structured requisition with correct category, qty=8, budget=180000, need_by=2026-07-15, and an audit entry. Ambiguous input triggers ONE clarifying question max, then proceeds with stated assumptions.

### F2 — Policy engine (deterministic)
- Rules table evaluated in order; first REJECT wins; FLAGs accumulate.
- Verdict object: `{verdict: pass|flag|reject, rules_cited: [...], approval_route}`.
- **AC:** The seeded violating requisition (e.g., blocked category) is rejected with the exact rule code shown to the requester. Same input → same verdict, always. Zero LLM calls inside this module.

### F3 — Vendor discovery
- Match vendors by category; prefer `approved`, include up to 2 `open` for competition; never `blocked`.
- Selection rationale logged per vendor.
- **AC:** For the laptop demo, 3–5 vendors selected; rationale visible in audit log; a blocked vendor in the same category is provably excluded.

### F4 — RFQ generation & simulated send
- One structured RFQ per vendor (identical specs, deadline, contact) drafted by the agent **in the tenant's language** (demo: Spanish); stored in `rfqs`; `SimulatedMailer` marks sent. Prompts are language-parameterized, not language-hardcoded.
- Demo control: an admin button **"Simular respuestas"** generates 3–4 realistic, *varied* quote replies (different prices, delivery, terms; one intentionally weak) via Claude API.
- **AC:** RFQs are spec-identical across vendors; simulated replies parse successfully in F5.

### F5 — Quote normalization & comparison
- Agent parses each raw reply → `normalized` JSON. `QuoteScorer` (deterministic) applies weights: price 50%, delivery 20%, terms 15%, vendor rating 15% (weights editable in admin).
- Output: ranked table + `reasoning_trace` (3–6 sentences, plain language **in the tenant's locale** — es/en/pt, generated once at recommendation time — references concrete numbers).
- **AC:** Side-by-side table renders all quotes; the recommendation cites at least two quantitative factors; changing weights in admin changes the ranking deterministically.

### F6 — Approval queue
- Approver sees: requisition summary, policy verdict, comparison table, recommendation + trace, savings estimate. Actions: Approve / Reject / Request info (each requires zero or one click + optional comment).
- **AC:** Approval moves status → `po_issued` and generates PO in <2s perceived; rejection requires a comment; both write audit entries with approver identity.

### F7 — PO generation (stub ERP)
- PO record + clean printable PO view (HTML). `StubERPAdapter.createPO()` returns fake ERP ref; interface signature matches planned Odoo adapter.
- **AC:** PO view shows vendor, line items, totals, terms, PO number, ERP ref; requester sees status update.

### F8 — Savings calculation
- `SavingsCalc`: compare winning unit price vs. median baseline unit price for same category (from `baseline_purchases`). No baseline → savings = "no contabilizado" (never guessed).
- **AC:** Demo laptop purchase shows a concrete MXN figure with the baseline source named; a category without history shows the "not counted" state, not a number.

### F9 — Audit trail
- Append-only log; filterable by requisition; human-readable action labels; exportable to CSV.
- **AC:** The full demo flow produces ≥10 entries telling the complete story of one purchase in order; no UI path can edit or delete entries.

### F10 — KPI dashboard (admin)
- Four tiles: % requisitions touchless-to-approval, avg. savings %, avg. cycle time (request→PO), policy violations caught. Computed live from real tables — these are the contractual pilot kill-or-scale metrics, so the demo must show the exact instrumentation the pilot will use.
- **AC:** Numbers reconcile with underlying data; tiles update after completing a new requisition end-to-end.

---

## 7. Agent implementation notes (Claude API)

- Model: `claude-sonnet-4` family; `max_tokens` modest; temperature low for parsing tasks.
- Each agent capability = one endpoint with ONE focused prompt: `parse_requisition`, `draft_rfq`, `parse_quote`, `write_reasoning`, `simulate_vendor_reply` (demo only).
- All parsing prompts demand JSON-only output; strip fences; validate with zod; on validation failure retry once with the error appended, then fail visibly into the audit log.
- The agent NEVER: approves anything, evaluates policy, invents prices, or contacts anyone outside the adapter layer.
- System prompts live in `/prompts/*.md`, versioned in git (they are product surface area, not config). Prompts are written in English and take `language` (es/en/pt) and `currency` parameters in the user message — output language and currency are never hardcoded in a prompt.

---

## 8. UI requirements

- Next.js 15 + Tailwind; clean, dense, executive-friendly. No chat interface — the product is queues, tables, and traces.
- Multilingual UI: es / en / pt dictionaries behind a single `t()` helper, locale switcher in the top bar, Spanish as the demo default. Every user-facing string is an i18n key — zero hardcoded copy. Money formatted with `Intl.NumberFormat` using the value's own currency.
- Deterministic services (policy engine, savings calc) return locale-neutral structured results (rule codes + params); the UI localizes them. The audit log stores structured payloads, never pre-rendered copy.
- Status badges per requisition stage; the approval screen is the hero screen — invest the most polish there.
- Persona switcher in the top bar (demo convenience).

---

## 9. Build plan — weekend schedule (2 builders + Claude Code)

| Block | Hours | Deliverable |
|---|---|---|
| Sat AM | 4 | Repo, Supabase schema + RLS-ready migrations, seed script (vendors, baseline, policies, users) |
| Sat PM | 5 | F1 intake + F2 policy engine + audit logger (the spine) |
| Sat eve | 3 | F3 discovery + F4 RFQ gen + simulated mailer/replies |
| Sun AM | 4 | F5 normalization/scoring/reasoning + F6 approval queue |
| Sun PM | 4 | F7 PO + F8 savings + F10 dashboard tiles |
| Sun eve | 3 | Polish hero screens, seed-data realism pass, full demo dry-run ×3, deploy (Vercel + Supabase) |

**Scope-cut order if behind (cut from the bottom, never the spine):** PT/EN copy review (keys stay, translations can be rough) → CSV export → editable scoring weights → dashboard tiles (hardcode from query) → PO print view styling. The i18n key system and currency-carrying columns are spine — never cut.

---

## 10. v1 roadmap (post-pilot-signature — NOT this weekend)

1. Real SMTP/IMAP mailer + inbound quote parsing (replace `SimulatedMailer`)
2. Odoo adapter (XML-RPC/JSON-RPC): vendor sync, PO write-back (replace stub)
3. Email + WhatsApp intake channels
4. Real auth (Supabase Auth) + multi-tenant RLS
5. Vendor compliance pack as first paid module — country-variant: **MX = CFDI-centric** (RFC validation against `vendors.tax_id`, SAT 32-D opinion / tax-status checks, EFOS/69-B blacklist screening); US/intl = W-9/credential checks
5b. Invoice ingestion + 3-way match (PO ↔ receipt ↔ invoice) on the v0 `InvoiceIngestionAdapter` seam — **MX = CFDI 4.0 XML** (UUID stamp validation, issuer-RFC match, SAT cancellation-status check; deterministic, no OCR), **US/intl = OCR/LLM extraction** with a human-review queue for low-confidence fields
6. Verified-savings reporting workflow (monthly statement, finance sign-off) — invoices the success fee
7. Pilot instrumentation hardening: the four KPI tiles become the contract exhibit
8. FX support: mixed-currency quotes normalized to tenant currency at a dated rate; USD tenant onboarding
9. Per-vendor language detection for RFQs (vendor replies already parse in any of es/en/pt)

---

## 11. Definition of done (v0)

- [ ] Full demo script (§3) runs end-to-end on deployed URL without dev intervention
- [ ] Policy rejection path demonstrable on demand
- [ ] Every step visible in audit log; log is append-only
- [ ] Savings figure traceable to named baseline rows
- [ ] Dashboard reconciles with data
- [ ] 10-minute demo rehearsed; happy path never touches a stub visibly (stubs must look real on screen)
- [ ] Zero real client names anywhere in code, seed data, or UI
