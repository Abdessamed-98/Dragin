import React from 'react';
import { Settings, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';

interface ToolHeaderProps {
    /** Pre-colored tool icon element, e.g. <Scaling className="w-4 h-4 text-sky-400" /> */
    icon: React.ReactNode;
    title: string;
    /** Shows a count badge when > 1 (or > 0 if showSingle). */
    count?: number;
    showSingleCount?: boolean;
    onClose: () => void;
    /** Gear handler. Defaults to opening the gallery / control center. */
    onSettings?: () => void;
}

/**
 * Shared tool-panel header: colored icon + title + optional count badge + settings gear + close.
 * Every tool uses this so the chrome can't drift. The gear opens the gallery by default.
 */
export const ToolHeader: React.FC<ToolHeaderProps> = ({ icon, title, count, showSingleCount, onClose, onSettings }) => {
    const { t } = useI18n();
    const openSettings = onSettings ?? (() => (window as any).electron?.openGallery?.());
    const showCount = count != null && count > (showSingleCount ? 0 : 1);
    return (
        <div className="flex items-center px-4 py-3 border-b border-[var(--separator)] shrink-0">
            <div className="flex items-center gap-2 min-w-0">
                {icon}
                <span className="text-sm font-bold text-[var(--text)] truncate">{title}</span>
                {showCount && <span className="text-xs bg-[var(--surface-3)] px-2 py-0.5 rounded-full text-[var(--text-2)] shrink-0">{count}</span>}
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-0.5">
                <button onClick={openSettings} title={t('widget.settings')}
                    className="text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors p-1 rounded-lg">
                    <Settings className="w-4 h-4" />
                </button>
                <button onClick={onClose} aria-label="Close"
                    className="text-[var(--text-3)] hover:text-[var(--text)] transition-colors p-1 rounded-lg">
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};
