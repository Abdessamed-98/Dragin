import { useTranslations } from "next-intl";

export function Footer() {
  const t = useTranslations("footer");

  return (
    <footer className="border-t border-white/5 py-12 px-6 bg-[#060913]">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-sm text-slate-500 font-medium tracking-wide">{t("copyright")}</p>
        <div className="flex items-center gap-6">
          <span className="text-sm font-medium text-slate-500 hover:text-white transition-colors cursor-pointer">
            {t("privacy")}
          </span>
          <span className="text-sm font-medium text-slate-500 hover:text-white transition-colors cursor-pointer">
            {t("github")}
          </span>
        </div>
      </div>
    </footer>
  );
}
