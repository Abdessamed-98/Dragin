"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { AppWindow, MousePointerClick, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Step = {
  key: string;
  icon: LucideIcon;
  number: string;
};

const steps: Step[] = [
  { key: "step1", icon: AppWindow, number: "1" },
  { key: "step2", icon: MousePointerClick, number: "2" },
  { key: "step3", icon: Zap, number: "3" },
];

export function HowItWorks() {
  const t = useTranslations("shelfPage.howItWorks");

  return (
    <section className="py-32 px-6 bg-[#060913]">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center mb-24"
        >
          <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-6">
            {t("title")}
          </h2>
          <div className="w-16 h-1 bg-white/10 mx-auto rounded-full" />
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
          {/* Connecting line for desktop */}
          <div className="hidden md:block absolute top-[4.5rem] left-[15%] right-[15%] h-[1px] border-t border-dashed border-white/10" />

          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.key}
                initial={{ opacity: 0, y: 40, filter: "blur(10px)" }}
                whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 25,
                  delay: i * 0.2,
                }}
                className="text-center relative z-10 group"
              >
                <div className="w-24 h-24 rounded-full bg-[#0c1024]/80 border border-white/10 flex items-center justify-center mx-auto mb-8 relative backdrop-blur-xl group-hover:border-white/20 transition-all duration-500 shadow-xl group-hover:shadow-[0_0_30px_rgba(14,165,233,0.15)] group-hover:-translate-y-2">
                  <Icon className="w-10 h-10 text-sky-400" />
                  <span className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-sky-500 text-white text-sm font-bold flex items-center justify-center shadow-lg border-2 border-[#060913]">
                    {step.number}
                  </span>
                </div>
                <h3 className="text-2xl font-bold text-white mb-4 tracking-tight group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-slate-400 transition-all duration-300">
                  {t(`${step.key}.title`)}
                </h3>
                <p className="text-slate-400 text-base leading-relaxed max-w-xs mx-auto font-medium">
                  {t(`${step.key}.desc`)}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
