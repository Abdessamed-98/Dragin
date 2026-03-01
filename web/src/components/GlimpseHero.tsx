"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { MagneticButton } from "./MagneticButton";
import Image from "next/image";

export function GlimpseHero() {
    const t = useTranslations("glimpsePage.hero");

    return (
        <section className="relative pt-32 pb-20 px-6 min-h-[90vh] flex flex-col items-center justify-center overflow-hidden bg-[#060913]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(244,63,94,0.15),transparent_50%)] pointer-events-none" />

            <div className="max-w-4xl mx-auto text-center relative z-10 w-full mb-20">
                <motion.div
                    initial={{ opacity: 0, y: 30, filter: "blur(10px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                >
                    <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold text-white mb-8 tracking-tight leading-[1.05]">
                        {t("title").split('. ').map((part, i, arr) => (
                            <span key={i}>
                                {part}{i !== arr.length - 1 ? '. ' : ''}
                                {i === 0 && <br className="hidden md:block" />}
                            </span>
                        ))}
                    </h1>
                </motion.div>

                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="text-xl md:text-2xl text-slate-400 mb-12 max-w-2xl mx-auto font-light leading-relaxed"
                >
                    {t("subtitle")}
                </motion.p>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
                >
                    <MagneticButton className="inline-flex items-center gap-3 flex-row px-12 py-5 rounded-2xl bg-rose-600 text-white font-bold text-xl transition-all shadow-[0_0_40px_rgba(244,63,94,0.4)] hover:shadow-[0_0_60px_rgba(244,63,94,0.6)] group">
                        <Download className="w-6 h-6 group-hover:-translate-y-1 transition-transform" />
                        {t("cta")}
                    </MagneticButton>
                </motion.div>
            </div>

            <motion.div
                initial={{ opacity: 0, y: 40, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 1, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="w-full max-w-5xl relative z-20 group"
            >
                <div className="absolute -inset-4 bg-gradient-to-r from-rose-500/30 to-rose-700/30 rounded-[40px] blur-3xl opacity-50 group-hover:opacity-75 transition-opacity duration-700" />
                <div className="relative rounded-[32px] bg-[#0c1024]/80 border border-white/10 p-2 backdrop-blur-3xl shadow-2xl overflow-hidden aspect-[16/10] md:aspect-video flex items-center justify-center">
                    <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.03] mix-blend-overlay" />
                    <div className="w-24 h-24 rounded-full bg-rose-500/20 blur-2xl absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    <span className="relative text-rose-300/50 font-medium text-lg tracking-widest uppercase">Glimpse Interface</span>
                </div>
            </motion.div>
        </section>
    );
}
