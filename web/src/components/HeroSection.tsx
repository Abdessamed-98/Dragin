"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  Layers,
  Share2,
  Shield,
  Cpu,
  MousePointerClick,
  Wifi,
  Zap,
  Lock,
  PlayCircle,
  LayoutGrid
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ── Floating element data ── */

type FloatingItem = {
  icon: LucideIcon;
  label: string;
  color: string;
  bg: string;
  border: string;
  x: string;
  y: string;
  parallax: number;
  delay: number;
  duration: number;
};

const floatingItems: FloatingItem[] = [
  // Brand concepts — what makes Dragin special
  { icon: Cpu, label: "Local AI", color: "text-indigo-400", bg: "bg-[#0c1024]/80", border: "border-indigo-500/20", x: "8%", y: "20%", parallax: 0.06, delay: 0, duration: 6 },
  { icon: MousePointerClick, label: "Drag & Drop", color: "text-emerald-400", bg: "bg-[#0c1024]/80", border: "border-emerald-500/20", x: "85%", y: "18%", parallax: 0.04, delay: 0.5, duration: 7 },
  { icon: Lock, label: "Privacy First", color: "text-rose-400", bg: "bg-[#0c1024]/80", border: "border-rose-500/20", x: "12%", y: "75%", parallax: 0.08, delay: 1.0, duration: 5.5 },
  { icon: Wifi, label: "LAN Share", color: "text-blue-400", bg: "bg-[#0c1024]/80", border: "border-blue-500/20", x: "82%", y: "80%", parallax: 0.05, delay: 0.3, duration: 6.5 },
  { icon: Zap, label: "Instant", color: "text-amber-400", bg: "bg-[#0c1024]/80", border: "border-amber-500/20", x: "28%", y: "88%", parallax: 0.07, delay: 0.8, duration: 7.5 },
  { icon: Shield, label: "Zero Cloud", color: "text-teal-400", bg: "bg-[#0c1024]/80", border: "border-teal-500/20", x: "72%", y: "12%", parallax: 0.03, delay: 1.2, duration: 5 },
];

/* ── Interactive Orb Component ── */
function AmbientOrb({
  mouseX,
  mouseY,
}: {
  mouseX: ReturnType<typeof useMotionValue<number>>;
  mouseY: ReturnType<typeof useMotionValue<number>>;
}) {
  const orbX = useSpring(mouseX, { stiffness: 40, damping: 30 });
  const orbY = useSpring(mouseY, { stiffness: 40, damping: 30 });

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none flex items-center justify-center">
      {/* Intense Core Glow */}
      <motion.div
        className="absolute w-[600px] h-[600px] rounded-full"
        style={{
          x: orbX,
          y: orbY,
          background: "radial-gradient(circle, rgba(99,102,241,0.2) 0%, rgba(79,70,229,0.05) 40%, transparent 70%)",
          filter: "blur(60px)",
        }}
      />
      {/* Floating secondary orbs */}
      <motion.div
        className="absolute w-[800px] h-[800px] rounded-full"
        animate={{
          rotate: 360,
          scale: [1, 1.1, 1],
        }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        style={{
          background: "radial-gradient(ellipse at 80% 20%, rgba(99,102,241,0.15) 0%, transparent 50%)",
          filter: "blur(80px)",
        }}
      />
      <motion.div
        className="absolute w-[900px] h-[900px] rounded-full"
        animate={{
          rotate: -360,
          scale: [1, 1.2, 1],
        }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        style={{
          background: "radial-gradient(ellipse at 20% 80%, rgba(56,189,248,0.1) 0%, transparent 50%)",
          filter: "blur(90px)",
        }}
      />
    </div>
  );
}

/* ── Floating pill component ── */

function FloatingPill({
  item,
  mouseX,
  mouseY,
}: {
  item: FloatingItem;
  mouseX: ReturnType<typeof useMotionValue<number>>;
  mouseY: ReturnType<typeof useMotionValue<number>>;
}) {
  const Icon = item.icon;

  const offsetX = useTransform(mouseX, (v) => v * item.parallax);
  const offsetY = useTransform(mouseY, (v) => v * item.parallax);
  const smoothX = useSpring(offsetX, { stiffness: 100, damping: 30 });
  const smoothY = useSpring(offsetY, { stiffness: 100, damping: 30 });

  return (
    <motion.div
      className="absolute hidden md:flex z-20"
      style={{
        left: item.x,
        top: item.y,
        x: smoothX,
        y: smoothY,
      }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 25,
        delay: 0.5 + item.delay,
      }}
    >
      <motion.div
        animate={{ y: [-8, 8, -8] }}
        transition={{
          duration: item.duration,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <motion.div
          whileHover={{ scale: 1.05, y: -4 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-full ${item.bg} border ${item.border} backdrop-blur-xl shadow-2xl shadow-black/50 cursor-default select-none transition-colors duration-300 hover:border-indigo-500/40 hover:bg-[#0c1024]/95`}
        >
          <div className={`p-1 rounded-full bg-white/5`}>
            <Icon className={`w-3.5 h-3.5 ${item.color}`} />
          </div>
          <span className="text-[13px] tracking-wide font-medium text-slate-300">
            {item.label}
          </span>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/* ── Floating app card ── */

function FloatingAppCard({
  icon: Icon,
  name,
  tagline,
  color,
  bg,
  border,
  glow,
  x,
  y,
  parallax,
  delay,
  duration,
  mouseX,
  mouseY,
}: {
  icon: LucideIcon;
  name: string;
  tagline: string;
  color: string;
  bg: string;
  border: string;
  glow: string;
  x: string;
  y: string;
  parallax: number;
  delay: number;
  duration: number;
  mouseX: ReturnType<typeof useMotionValue<number>>;
  mouseY: ReturnType<typeof useMotionValue<number>>;
}) {
  const offsetX = useTransform(mouseX, (v) => v * parallax);
  const offsetY = useTransform(mouseY, (v) => v * parallax);
  const smoothX = useSpring(offsetX, { stiffness: 60, damping: 30 });
  const smoothY = useSpring(offsetY, { stiffness: 60, damping: 30 });

  return (
    <motion.div
      className="absolute hidden lg:flex z-20"
      style={{ left: x, top: y, x: smoothX, y: smoothY }}
      initial={{ opacity: 0, filter: "blur(10px)", y: 40 }}
      animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
      transition={{
        type: "spring",
        stiffness: 150,
        damping: 25,
        delay: 1.0 + delay,
      }}
    >
      <motion.div
        animate={{ y: [-10, 10, -10] }}
        transition={{ duration, repeat: Infinity, ease: "easeInOut" }}
      >
        <motion.div
          whileHover={{ scale: 1.05, y: -5 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="group relative flex items-center gap-4 px-5 py-4 rounded-3xl bg-[#0c1024]/80 border border-white/5 backdrop-blur-2xl shadow-2xl cursor-default select-none hover:border-white/10 transition-colors"
        >
          <div className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ boxShadow: `0 0 50px ${glow}` }} />

          <div
            className={`relative z-10 w-12 h-12 rounded-2xl ${bg} border ${border} flex items-center justify-center shadow-inner`}
          >
            <Icon className={`w-6 h-6 ${color}`} />
          </div>
          <div className="relative z-10">
            <div className="text-base font-bold text-white tracking-tight">{name}</div>
            <div className="text-xs font-medium text-slate-400 mt-0.5">{tagline}</div>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/* ── Main hero ── */

export function HeroSection() {
  const t = useTranslations("hero");
  const tApps = useTranslations("apps");
  const sectionRef = useRef<HTMLElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!sectionRef.current) return;
      const rect = sectionRef.current.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      mouseX.set(e.clientX - rect.left - centerX);
      mouseY.set(e.clientY - rect.top - centerY);
    },
    [mouseX, mouseY]
  );

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    el.addEventListener("mousemove", handleMouseMove);
    return () => el.removeEventListener("mousemove", handleMouseMove);
  }, [handleMouseMove]);

  return (
    <section
      ref={sectionRef}
      className="relative min-h-screen flex flex-col items-center justify-center px-6 overflow-hidden bg-[#060913]"
    >
      {/* ── Subtle grid ── */}
      <div
        className="absolute inset-0 z-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)`,
          backgroundSize: '4rem 4rem',
          maskImage: 'radial-gradient(circle at center, black 40%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(circle at center, black 40%, transparent 80%)'
        }}
      />

      <AmbientOrb mouseX={mouseX} mouseY={mouseY} />

      {/* ── Floating concept pills ── */}
      {floatingItems.map((item) => (
        <FloatingPill
          key={item.label}
          item={item}
          mouseX={mouseX}
          mouseY={mouseY}
        />
      ))}

      {/* ── Floating app cards ── */}
      <FloatingAppCard
        icon={Layers}
        name={tApps("flow.name")}
        tagline={tApps("flow.tagline")}
        color="text-indigo-400"
        bg="bg-indigo-500/10"
        border="border-indigo-500/30"
        glow="rgba(99,102,241,0.15)"
        x="6%"
        y="35%"
        parallax={0.03}
        delay={0}
        duration={8}
        mouseX={mouseX}
        mouseY={mouseY}
      />
      <FloatingAppCard
        icon={Share2}
        name={tApps("shelf.name")}
        tagline={tApps("shelf.tagline")}
        color="text-sky-400"
        bg="bg-sky-500/10"
        border="border-sky-500/30"
        glow="rgba(14,165,233,0.15)"
        x="72%"
        y="32%"
        parallax={0.04}
        delay={0.4}
        duration={7}
        mouseX={mouseX}
        mouseY={mouseY}
      />
      <FloatingAppCard
        icon={LayoutGrid}
        name={tApps("glimpse.name")}
        tagline={tApps("glimpse.tagline")}
        color="text-rose-400"
        bg="bg-rose-500/10"
        border="border-rose-500/30"
        glow="rgba(244,63,94,0.15)"
        x="10%"
        y="65%"
        parallax={0.05}
        delay={0.6}
        duration={6}
        mouseX={mouseX}
        mouseY={mouseY}
      />

      {/* ── Hero content ── */}
      <div className="text-center max-w-4xl relative z-30 flex flex-col items-center mt-10">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-10 shadow-2xl"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
          </span>
          <span className="text-[11px] uppercase tracking-widest font-semibold text-slate-300">
            {t("badge")}
          </span>
        </motion.div>

        {/* Title with dramatic entrance */}
        <motion.div
          initial={{ opacity: 0, y: 30, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="mb-8"
        >
          <h1 className="text-6xl sm:text-7xl md:text-8xl lg:text-[100px] font-bold leading-[1.05] tracking-tight text-white whitespace-pre-line">
            {t("title")}
          </h1>
        </motion.div>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="text-lg md:text-2xl text-slate-400 mb-14 max-w-2xl mx-auto leading-relaxed font-light"
        >
          {t("subtitle")}
        </motion.p>

        {/* CTA buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col sm:flex-row items-center justify-center gap-5 w-full sm:w-auto"
        >
          <motion.a
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            href="#apps"
            className="group relative flex items-center justify-center gap-3 w-full sm:w-auto px-8 py-4 rounded-2xl bg-indigo-600 text-white font-semibold text-lg overflow-hidden transition-all shadow-[0_0_40px_rgba(79,70,229,0.4)] hover:shadow-[0_0_60px_rgba(79,70,229,0.6)]"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
            <span className="relative z-10">{t("cta")}</span>
            <ArrowDown className="w-5 h-5 relative z-10 group-hover:translate-y-1 transition-transform" />
          </motion.a>

          <motion.a
            whileHover={{ scale: 1.02, backgroundColor: "rgba(255,255,255,0.05)" }}
            whileTap={{ scale: 0.98 }}
            href="#film"
            className="group flex items-center justify-center gap-3 w-full sm:w-auto px-8 py-4 rounded-2xl border border-white/10 text-slate-300 font-medium text-lg transition-all"
          >
            <PlayCircle className="w-5 h-5 text-slate-400 group-hover:text-indigo-400 transition-colors" />
            <span>{t("ctaSecondary")}</span>
          </motion.a>
        </motion.div>
      </div>

      {/* ── Scroll down indicator ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 1 }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 z-30"
      >
        <div className="text-[10px] uppercase tracking-[0.3em] font-semibold text-slate-500">Scroll</div>
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="w-[1px] h-12 bg-gradient-to-b from-slate-500 to-transparent"
        />
      </motion.div>
    </section>
  );
}

