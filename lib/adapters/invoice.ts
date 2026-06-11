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
