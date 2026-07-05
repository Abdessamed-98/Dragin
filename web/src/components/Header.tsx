"use client";

import { Link } from "@/i18n/navigation";
import { LanguageToggle } from "./LanguageToggle";

// Flow-only phase: the homepage IS the Flow page, so nav links are gone and the
// suite lockup links home. Restore app links here when Glimpse/Shelf ship.
export function Header() {
  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-[#060913]/70 backdrop-blur-2xl border-b border-white/5 transition-colors duration-300">
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center" aria-label="Dragin Tools">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/lockup-on-dark.svg"
            alt="Dragin Tools"
            className="h-8 w-auto"
          />
        </Link>

        <LanguageToggle />
      </nav>
    </header>
  );
}
