"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Menu, X } from "lucide-react";
import { LanguageToggle } from "./LanguageToggle";

export function Header() {
  const t = useTranslations("nav");
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-[#060913]/70 backdrop-blur-2xl border-b border-white/5 transition-colors duration-300">
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-white">
          Dragin
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-8">
          <Link
            href="/"
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            {t("home")}
          </Link>
          <Link
            href="/flow"
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            {t("flow")}
          </Link>
          <Link
            href="/shelf"
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            {t("shelf")}
          </Link>
          <Link
            href="/glimpse"
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            {t("glimpse")}
          </Link>
          <LanguageToggle />
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden text-slate-400 hover:text-white cursor-pointer"
        >
          {mobileOpen ? (
            <X className="w-6 h-6" />
          ) : (
            <Menu className="w-6 h-6" />
          )}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-[#060913]/95 backdrop-blur-3xl border-b border-white/5 px-6 pb-6 space-y-4 shadow-2xl">
          <Link
            href="/"
            onClick={() => setMobileOpen(false)}
            className="block text-sm text-slate-400 hover:text-white transition-colors py-2"
          >
            {t("home")}
          </Link>
          <Link
            href="/flow"
            onClick={() => setMobileOpen(false)}
            className="block text-sm text-slate-400 hover:text-white transition-colors py-2"
          >
            {t("flow")}
          </Link>
          <Link
            href="/shelf"
            onClick={() => setMobileOpen(false)}
            className="block text-sm text-slate-400 hover:text-white transition-colors py-2"
          >
            {t("shelf")}
          </Link>
          <Link
            href="/glimpse"
            onClick={() => setMobileOpen(false)}
            className="block text-sm text-slate-400 hover:text-white transition-colors py-2"
          >
            {t("glimpse")}
          </Link>
          <LanguageToggle />
        </div>
      )}
    </header>
  );
}
