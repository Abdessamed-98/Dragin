"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Wand2,
  Minimize2,
  Archive,
  ArrowRightLeft,
  PenTool,
  ScanText,
  FileScan,
  Crop,
  ImagePlus,
  FileText,
  ShieldAlert,
  Stamp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Tool = {
  id: string;
  icon: LucideIcon;
  bg: string;
  border: string;
  text: string;
};

const tools: Tool[] = [
  { id: "remover", icon: Wand2, bg: "bg-indigo-500/10", border: "border-indigo-500/20", text: "text-indigo-400" },
  { id: "compressor", icon: Minimize2, bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400" },
  { id: "shelf", icon: Archive, bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400" },
  { id: "upscaler", icon: ImagePlus, bg: "bg-pink-500/10", border: "border-pink-500/20", text: "text-pink-400" },
  { id: "pdf", icon: FileText, bg: "bg-teal-500/10", border: "border-teal-500/20", text: "text-teal-400" },
  { id: "converter", icon: ArrowRightLeft, bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-400" },
  { id: "metadata", icon: ShieldAlert, bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-400" },
  { id: "watermark", icon: Stamp, bg: "bg-cyan-500/10", border: "border-cyan-500/20", text: "text-cyan-400" },
  { id: "vectorizer", icon: PenTool, bg: "bg-rose-500/10", border: "border-rose-500/20", text: "text-rose-400" },
  { id: "ocr", icon: ScanText, bg: "bg-fuchsia-500/10", border: "border-fuchsia-500/20", text: "text-fuchsia-400" },
  { id: "scanner", icon: FileScan, bg: "bg-violet-500/10", border: "border-violet-500/20", text: "text-violet-400" },
  { id: "cropper", icon: Crop, bg: "bg-orange-500/10", border: "border-orange-500/20", text: "text-orange-400" },
];

export function ToolGrid() {
  const t = useTranslations("flowPage.tools");

  return (
    <section className="py-32 px-6 bg-[#060913] relative z-10">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-24"
        >
          <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4">
            {t("title")}
          </h2>
          <div className="w-16 h-1 bg-white/10 mx-auto rounded-full" />
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {tools.map((tool, i) => {
            const Icon = tool.icon;
            return (
              <motion.div
                key={tool.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{
                  type: "spring",
                  stiffness: 300,
                  damping: 30,
                  delay: (i % 4) * 0.1, // Stagger by column
                }}
              >
                <div
                  className="group relative h-full p-6 rounded-[28px] bg-[#0c1024]/60 border border-white/5 backdrop-blur-md hover:bg-white/[0.03] transition-colors duration-500 overflow-hidden"
                >
                  <div className={`absolute -right-6 -top-6 w-24 h-24 ${tool.bg} rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700`} />

                  <div
                    className={`relative z-10 w-12 h-12 rounded-[18px] ${tool.bg} border ${tool.border} flex items-center justify-center mb-5 shadow-inner transition-transform duration-300 group-hover:scale-110`}
                  >
                    <Icon className={`w-6 h-6 ${tool.text}`} />
                  </div>
                  <h3 className="relative z-10 text-base font-bold text-white tracking-tight mb-2 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-slate-400 transition-all duration-300">
                    {t(`${tool.id}.title`)}
                  </h3>
                  <p className="relative z-10 text-[13px] text-slate-400 leading-relaxed font-medium">
                    {t(`${tool.id}.desc`)}
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
