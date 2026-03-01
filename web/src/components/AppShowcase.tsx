"use client";

import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Layers, Share2, ArrowRight } from "lucide-react";
import { MouseEvent } from "react";

const apps = [
  {
    key: "flow",
    href: "/flow" as const,
    icon: Layers,
    accent: "text-indigo-400",
    bgAccent: "bg-indigo-500/10",
    borderAccent: "border-indigo-500/30",
    glowColor: "rgba(99,102,241,0.15)",
    layout: "md:col-span-2 lg:col-span-7",
  },
  {
    key: "shelf",
    href: "/shelf" as const,
    icon: Share2,
    accent: "text-sky-400",
    bgAccent: "bg-sky-500/10",
    borderAccent: "border-sky-500/30",
    glowColor: "rgba(14,165,233,0.15)",
    layout: "md:col-span-2 lg:col-span-5",
  },
];

function BentoCard({ app, i }: { app: typeof apps[0], i: number }) {
  const t = useTranslations("apps");
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  function onMouseMove({ currentTarget, clientX, clientY }: MouseEvent) {
    const { left, top } = currentTarget.getBoundingClientRect();
    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  const Icon = app.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 30,
        delay: i * 0.1,
      }}
      className={`${app.layout}`}
    >
      <Link href={app.href} className="block h-full group">
        <div
          onMouseMove={onMouseMove}
          className="relative h-full overflow-hidden rounded-[32px] bg-[#0c1024]/60 border border-white/5 p-8 md:p-10 backdrop-blur-xl transition-all duration-500 hover:border-white/10"
        >
          {/* Subtle Base Glow */}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700" style={{ boxShadow: `inset 0 0 100px ${app.glowColor}` }} />

          {/* Interactive Spotlight */}
          <motion.div
            className="pointer-events-none absolute -inset-px rounded-[31px] opacity-0 transition duration-300 group-hover:opacity-100"
            style={{
              background: useMotionTemplate`
                radial-gradient(
                  600px circle at ${mouseX}px ${mouseY}px,
                  ${app.glowColor},
                  transparent 80%
                )
              `,
            }}
          />

          <div className="relative z-10 flex flex-col h-full">
            <div className="flex justify-between items-start mb-12">
              <div
                className={`w-14 h-14 rounded-2xl ${app.bgAccent} border ${app.borderAccent} flex items-center justify-center shadow-inner`}
              >
                <Icon className={`w-7 h-7 ${app.accent}`} />
              </div>
              <div className={`p-3 rounded-full bg-white/5 text-slate-400 group-hover:bg-white/10 transition-colors group-hover:${app.accent}`}>
                <ArrowRight className="w-5 h-5 -rotate-45 group-hover:rotate-0 transition-transform duration-300" />
              </div>
            </div>

            <div className="mt-auto">
              <h3 className="text-3xl md:text-4xl font-bold text-white mb-2 tracking-tight group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-slate-400 transition-all duration-500">
                {t(`${app.key}.name`)}
              </h3>
              <p className={`text-sm md:text-base font-medium ${app.accent} mb-4 tracking-wide`}>
                {t(`${app.key}.tagline`)}
              </p>
              <p className="text-slate-400 text-sm md:text-base leading-relaxed max-w-sm">
                {t(`${app.key}.description`)}
              </p>
            </div>

            {/* Cinematic faint reflection at bottom */}
            <div className={`absolute bottom-0 left-10 right-10 h-1 bg-gradient-to-r from-transparent via-${app.accent.split('-')[1]}-500/30 to-transparent blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-700`} />
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export function AppShowcase() {
  const t = useTranslations("apps");

  return (
    <section id="apps" className="py-32 px-6 relative z-10 bg-[#060913]">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <h2 className="text-4xl md:text-6xl font-bold text-white tracking-tight mb-4">
            {t("title")}
          </h2>
          <div className="w-24 h-1 bg-gradient-to-r from-indigo-500 to-transparent mx-auto rounded-full opacity-50" />
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 md:gap-8">
          {apps.map((app, i) => (
            <BentoCard key={app.key} app={app} i={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
