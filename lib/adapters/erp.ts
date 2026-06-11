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
