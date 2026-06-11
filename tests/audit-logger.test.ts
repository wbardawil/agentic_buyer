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
    const audit = createAuditLogger(db as unknown as never, "company-1");
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
    const audit = createAuditLogger(db as unknown as never, "company-1");
    await expect(
      audit.log({ requisition_id: null, actor: "system", action: "x", payload: {} })
    ).rejects.toThrow(/audit/i);
  });
});
