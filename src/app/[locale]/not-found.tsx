import { getTranslations } from "next-intl/server";
import { Link } from "../../i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg)", color: "var(--text-hi)", fontFamily: "var(--font-sans)" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, marginBottom: 12 }}>{t("title")}</h1>
        <Link href="/options" style={{ color: "var(--brand)", fontSize: 13 }}>{t("back")}</Link>
      </div>
    </main>
  );
}
