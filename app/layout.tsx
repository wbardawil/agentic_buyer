import "./globals.css";
import Link from "next/link";
import { cookies } from "next/headers";
import { PERSONAS, resolvePersona, resolveLocale } from "@/lib/personas";
import { t } from "@/lib/i18n";
import { PersonaSwitcher } from "./components/PersonaSwitcher";
import { LocaleSwitcher } from "./components/LocaleSwitcher";

export const metadata = { title: "compras-agent" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const persona = resolvePersona(jar.get("persona")?.value);
  const locale = resolveLocale(jar.get("locale")?.value);

  return (
    <html lang={locale}>
      <body className="bg-slate-50 text-slate-900">
        <header className="flex items-center gap-6 border-b bg-white px-6 py-3">
          <span className="font-semibold">{t(locale, "app_name")}</span>
          <nav className="flex gap-4 text-sm">
            <Link href="/solicitudes" className="hover:underline">{t(locale, "nav_requests")}</Link>
            <Link href="/aprobaciones" className="hover:underline">{t(locale, "nav_approvals")}</Link>
            <Link href="/admin" className="hover:underline">{t(locale, "nav_admin")}</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <LocaleSwitcher current={locale} />
            <PersonaSwitcher current={persona} labels={{
              requester: t(locale, "persona_requester"),
              approver: t(locale, "persona_approver"),
              admin: t(locale, "persona_admin"),
            }} />
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-6">{children}</main>
      </body>
    </html>
  );
}
