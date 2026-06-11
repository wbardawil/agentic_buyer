import type { Locale } from "@/lib/types";

export const COMPANY_ID = "00000000-0000-0000-0000-000000000001";

export const PERSONAS = {
  requester: { id: "00000000-0000-0000-0000-000000000011", name: "Laura Méndez", label: "Solicitante" },
  approver:  { id: "00000000-0000-0000-0000-000000000012", name: "Carlos Rivas", label: "Aprobador (CFO)" },
  admin:     { id: "00000000-0000-0000-0000-000000000013", name: "Sofía Ortega", label: "Admin Compras" },
} as const;
export type PersonaKey = keyof typeof PERSONAS;

export function resolvePersona(cookieValue: string | undefined): PersonaKey {
  return cookieValue === "approver" || cookieValue === "admin" ? cookieValue : "requester";
}

export function resolveLocale(cookieValue: string | undefined): Locale {
  return cookieValue === "en" || cookieValue === "pt" ? cookieValue : "es";
}
