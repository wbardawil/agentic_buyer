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
  // wipe demo tenant rows, children before parents; audit_log is append-only and survives
  // (its requisition_id FK is ON DELETE SET NULL, so deleting requisitions is safe)

  // child tables that have no company_id column — delete all rows (single-tenant demo)
  for (const t of ["purchase_orders", "approvals", "recommendations", "quotes", "rfqs"]) {
    const { error } = await db.from(t).delete().not("id", "is", null);
    if (error) console.warn(`${t}: ${error.message}`);
  }

  // parent tables that carry company_id — delete only the demo tenant's rows
  for (const t of ["requisitions", "baseline_purchases", "policies", "vendors", "users", "companies"]) {
    const col = t === "companies" ? "id" : "company_id";
    const { error } = await db.from(t).delete().eq(col, C);
    if (error) console.warn(`${t}: ${error.message}`);
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

  // --- baseline purchases: 30 rows, trailing 6 months; NONE for 'servicios' (F8 AC) ---
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
      policy_result: { verdict: "pass", rules_cited: [{ rule_code: "R-02", reason_key: "policy_allowed", params: { rule_code: "R-02", max_amount: 150000 } }], approval_route: "single", min_quotes: 3 },
    },
    {
      company_id: C, requester_id: REQUESTER, status: "quoted", category: "papeleria",
      raw_text: "Tóner para las 4 impresoras del piso 2",
      estimated_amount: 9500, currency: "MXN", need_by: null,
      structured: { category: "papeleria", items: [{ description: "Tóner HP 26A", qty: 4, unit: "pieza" }], estimated_amount: 9500, need_by: null, urgency: "baja", clarifying_question: null, assumptions: ["Modelo HP 26A según historial"] },
      policy_result: { verdict: "pass", rules_cited: [{ rule_code: "R-03", reason_key: "policy_allowed", params: { rule_code: "R-03", max_amount: 30000 } }], approval_route: "auto", min_quotes: 2 },
    },
    {
      company_id: C, requester_id: REQUESTER, status: "flagged", category: "mantenimiento",
      raw_text: "Renovación completa del sistema HVAC del edificio, estimado 350,000",
      estimated_amount: 350000, currency: "MXN", need_by: "2026-08-15",
      structured: { category: "mantenimiento", items: [{ description: "Renovación sistema HVAC", qty: 1, unit: "servicio" }], estimated_amount: 350000, need_by: "2026-08-15", urgency: "alta", clarifying_question: null, assumptions: [] },
      policy_result: { verdict: "flag", rules_cited: [{ rule_code: "R-05", reason_key: "policy_over_limit", params: { amount: 350000, max_amount: 100000, rule_code: "R-05" } }], approval_route: "committee", min_quotes: 3 },
    },
    {
      company_id: C, requester_id: REQUESTER, status: "rejected", category: "viajes",
      raw_text: "Viaje a Cancún para el offsite del equipo, 6 personas",
      estimated_amount: 85000, currency: "MXN", need_by: "2026-07-20",
      structured: { category: "viajes", items: [{ description: "Viaje offsite Cancún 6 personas", qty: 6, unit: "persona" }], estimated_amount: 85000, need_by: "2026-07-20", urgency: "normal", clarifying_question: null, assumptions: [] },
      policy_result: { verdict: "reject", rules_cited: [{ rule_code: "R-06", reason_key: "policy_blocked_category", params: { category: "viajes", rule_code: "R-06" } }], approval_route: "single", min_quotes: 0 },
    },
  ]));

  console.log("Seed OK: 1 company, 3 users, 25 vendors, 8 policies, 30 baselines, 4 requisitions");
}

main().catch((e) => { console.error(e); process.exit(1); });
