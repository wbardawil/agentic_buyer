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
