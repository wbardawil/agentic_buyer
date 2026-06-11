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
