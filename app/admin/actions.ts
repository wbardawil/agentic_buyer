"use server";
import { revalidatePath } from "next/cache";
import { getDb, COMPANY_ID } from "@/lib/db";
import { createAuditLogger } from "@/lib/services/audit-logger";
import { PERSONAS } from "@/lib/personas";

export async function saveWeights(formData: FormData) {
  const weights = {
    price: Number(formData.get("price")),
    delivery: Number(formData.get("delivery")),
    terms: Number(formData.get("terms")),
    rating: Number(formData.get("rating")),
  };
  const sum = weights.price + weights.delivery + weights.terms + weights.rating;
  if (Math.abs(sum - 1) > 0.001) throw new Error("weights must sum to 1");

  const db = getDb();
  const { error } = await db.from("companies").update({ scoring_weights: weights }).eq("id", COMPANY_ID);
  if (error) throw new Error(error.message);
  await createAuditLogger(db, COMPANY_ID).log({
    requisition_id: null, actor: PERSONAS.admin.id,
    action: "weights.updated", payload: weights,
  });
  revalidatePath("/admin");
}
