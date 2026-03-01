"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Settings2, Wifi, Monitor } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Feature = {
  key: string;
  icon: LucideIcon;
  bg: string;
  border: string;
  text: string;
};

const features: Feature[] = [
  {
    key: "zeroConfig",
    icon: Settings2,
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    text: "text-blue-400",
  },
  {
    key: "lanOnly",
    icon: Wifi,
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    text: "text-emerald-400",
  },
  {
    key: "crossPlatform",
    icon: Monitor,
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
    text: "text-violet-400",
  },
];

export function ShelfFeatures() {
  const t = useTranslations("shelfPage.features");

  return (
    <section className="py-32 px-6 bg-[#060913] relative z-10">
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.key}
                initial={{ opacity: 0, y: 40, filter: "blur(10px)" }}
                whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 25,
                  delay: i * 0.15,
                }}
                className="group relative"
              >
                {/* Back glow */}
                <div className={`absolute inset-0 ${f.bg} rounded-[32px] blur-2xl opacity-0 group-hover:opacity-40 transition-opacity duration-700`} />

                <div className="relative h-full p-10 rounded-[32px] bg-[#0c1024]/80 border border-white/5 backdrop-blur-xl hover:border-white/10 transition-all duration-500 flex flex-col items-center text-center">
                  <div
                    className={`w-16 h-16 rounded-2xl ${f.bg} border ${f.border} flex items-center justify-center mb-8 shadow-inner transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3`}
                  >
                    <Icon className={`w-8 h-8 ${f.text}`} />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-4 tracking-tight group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-slate-400 transition-all duration-300">
                    {t(`${f.key}.title`)}
                  </h3>
                  <p className="text-slate-400 text-base leading-relaxed font-medium">
                    {t(`${f.key}.desc`)}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
