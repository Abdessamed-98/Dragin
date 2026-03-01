"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { MagneticButton } from "./MagneticButton";

export function CtaSection() {
  const t = useTranslations("cta");

  return (
    <section className="py-40 px-6 relative overflow-hidden bg-[#060913]">
      {/* Intense background glow for CTA */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ type: "spring", stiffness: 200, damping: 30 }}
        className="max-w-3xl mx-auto text-center relative z-10"
      >
        <h2 className="text-5xl md:text-7xl font-bold text-white mb-8 tracking-tight">
          {t("title")}
        </h2>
        <p className="text-xl md:text-2xl text-slate-400 mb-14 font-light max-w-2xl mx-auto">
          {t("subtitle")}
        </p>

        <MagneticButton className="inline-flex items-center gap-3 px-12 py-5 rounded-2xl bg-white text-black font-bold text-xl transition-all shadow-[0_0_40px_rgba(255,255,255,0.3)] hover:shadow-[0_0_60px_rgba(255,255,255,0.5)]">
          <Download className="w-6 h-6" />
          {t("button")}
        </MagneticButton>
      </motion.div>
    </section>
  );
}
