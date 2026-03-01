"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { FolderHeart, Filter, Layers } from "lucide-react";

export function GlimpseFeatures() {
    const t = useTranslations("glimpsePage.features");

    const features = [
        {
            key: "linked",
            icon: FolderHeart,
            bg: "bg-rose-500/10",
            border: "border-rose-500/30",
            text: "text-rose-400",
        },
        {
            key: "filters",
            icon: Filter,
            bg: "bg-fuchsia-500/10",
            border: "border-fuchsia-500/30",
            text: "text-fuchsia-400",
        },
        {
            key: "thumbnails",
            icon: Layers,
            bg: "bg-pink-500/10",
            border: "border-pink-500/30",
            text: "text-pink-400",
        },
    ];

    return (
        <section className="py-24 px-6 relative bg-[#060913]">
            <div className="max-w-6xl mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center mb-20"
                >
                    <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4">
                        {t("title")}
                    </h2>
                    <div className="w-16 h-1 bg-gradient-to-r from-rose-500 to-transparent mx-auto rounded-full" />
                </motion.div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {features.map((f, i) => {
                        const Icon = f.icon;
                        return (
                            <motion.div
                                key={f.key}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.15 }}
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
