import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Locale } from "@/lib/types";
import { LOCALES } from "@/lib/types";

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

const TenantInfoSchema = z.object({
  name: z.string(),
  locale: z.enum(LOCALES),
  currency: z.string(),
  country: z.string(),
  scoring_weights: z.object({
    price: z.number(), delivery: z.number(), terms: z.number(), rating: z.number(),
  }),
});

export type TenantInfo = z.infer<typeof TenantInfoSchema>;

/** Tenant context: drives agent output language, currency labeling, and country variants. */
export async function getTenant(): Promise<TenantInfo> {
  const { data, error } = await getDb()
    .from("companies")
    .select("name, locale, currency, country, scoring_weights")
    .eq("id", COMPANY_ID)
    .single();
  if (error || !data) throw new Error(`tenant not found: ${error?.message}`);
  return TenantInfoSchema.parse(data);
}
