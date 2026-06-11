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
