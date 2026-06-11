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
