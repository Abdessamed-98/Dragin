"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Download, Layers } from "lucide-react";
import { MagneticButton } from "./MagneticButton";

export function FlowHero() {
  const t = useTranslations("flowPage.hero");

  return (
    <section className="relative pt-40 pb-20 px-6 overflow-hidden bg-[#060913] min-h-[90vh] flex flex-col justify-center">
      {/* Intense Background Glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/15 rounded-full blur-[100px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 40, filter: "blur(10px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ type: "spring", stiffness: 200, damping: 30, delay: 0.1 }}
        className="max-w-4xl mx-auto text-center relative z-10"
      >
        <h1 className="text-6xl md:text-8xl font-bold text-white mb-8 tracking-tight leading-[1.05]">
          {t("title").split('. ').map((part, i, arr) => (
            <span key={i}>
              {part}{i !== arr.length - 1 ? '. ' : ''}
              {i === 0 && <br />}
            </span>
          ))}
        </h1>
        <p className="text-xl md:text-2xl text-slate-400 mb-14 font-light max-w-2xl mx-auto leading-relaxed">
          {t("subtitle")}
        </p>

        {/* Cinematic Placeholder screenshot */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 150, damping: 25, delay: 0.4 }}
          className="relative aspect-video max-w-4xl mx-auto rounded-[32px] bg-[#0c1024]/80 border border-white/10 flex items-center justify-center mb-16 overflow-hidden shadow-2xl backdrop-blur-xl group"
        >
          <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/20 via-transparent to-transparent opacity-50 group-hover:opacity-100 transition-opacity duration-700" />
          <Layers className="w-24 h-24 text-indigo-400 opacity-20 group-hover:opacity-40 transition-opacity duration-700 group-hover:scale-110" />

          {/* Faint reflection line */}
          <div className="absolute bottom-0 left-20 right-20 h-[2px] bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent blur-sm" />
        </motion.div>

        <MagneticButton href="#download" className="inline-flex items-center gap-3 px-12 py-5 rounded-2xl bg-indigo-600 text-white font-bold text-xl transition-all shadow-[0_0_40px_rgba(79,70,229,0.4)] hover:shadow-[0_0_60px_rgba(79,70,229,0.6)]">
          <Download className="w-6 h-6" />
          {t("cta")}
        </MagneticButton>
      </motion.div>
    </section>
  );
}
