/**
 * Carry banner — appears briefly after switching tools with processed results,
 * telling the user their files carried over as RESULTS (the pipeline), with a
 * one-click escape hatch back to the originals.
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ToolId } from '../types';
import { useLocalizedTools } from '../i18n/useLocalizedTools';
import { useI18n } from '../i18n/I18nContext';
import { sessionStore, useSession } from '../state/sessionStore';

interface CarryBannerProps {
    /** The tool we just switched TO. */
    expandedToolId: ToolId;
}

export const CarryBanner: React.FC<CarryBannerProps> = ({ expandedToolId }) => {
    const { t } = useI18n();
    const ALL_TOOLS = useLocalizedTools();
    const { files } = useSession();
    const [visible, setVisible] = useState(false);

    // Files whose current state came from a DIFFERENT tool than the one now open.
    const carried = files.filter(f => {
        const last = f.provenance[f.provenance.length - 1];
        return last && last !== expandedToolId;
    });
    const fromId = carried.length ? carried[carried.length - 1].provenance.slice(-1)[0] : null;
    const fromTool = fromId ? ALL_TOOLS.find(t2 => t2.id === fromId) : null;

    // Show for a few seconds on each switch that actually carries results.
    useEffect(() => {
        if (!carried.length) { setVisible(false); return; }
        setVisible(true);
        const timer = setTimeout(() => setVisible(false), 5000);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expandedToolId]);

    return (
        <AnimatePresence>
            {visible && carried.length > 0 && fromTool && (
                <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    className="absolute left-1/2 -translate-x-1/2 top-[52px] z-[70] pointer-events-auto"
                    data-interactive
                >
                    <div className="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full bg-[var(--surface-3)]/95 border border-[var(--border)] shadow-lg backdrop-blur-sm whitespace-nowrap">
                        <span className="text-[11px] text-[var(--text-2)]">
                            {t('session.carried', { count: carried.length, tool: fromTool.title })}
                        </span>
                        <button
                            onClick={() => { sessionStore.revertAll(); setVisible(false); }}
                            className="text-[11px] font-semibold text-[var(--accent)] hover:underline px-1"
                        >
                            {t('session.useOriginals')}
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
