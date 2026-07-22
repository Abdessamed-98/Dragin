import React from 'react';

interface ToolIconButtonProps {
    onClick?: () => void;
    title?: string;
    disabled?: boolean;
    /** Destructive button (e.g. clear/trash): neutral idle, red on hover. */
    danger?: boolean;
    children: React.ReactNode;
}

/**
 * Shared secondary footer button (copy / paste / clear). Locks the neutral palette so it
 * can't drift per-tool: copy/paste are neutral→bright on hover; danger is neutral→red on hover.
 */
export const ToolIconButton: React.FC<ToolIconButtonProps> = ({ onClick, title, disabled, danger, children }) => (
    <button onClick={onClick} title={title} disabled={disabled}
        className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors bg-[var(--surface-2)] hover:bg-[var(--surface-3)] disabled:opacity-40 disabled:cursor-not-allowed ${danger ? 'text-[var(--text-2)] hover:text-[var(--red)]' : 'text-[var(--text-2)] hover:text-[var(--text)]'}`}>
        {children}
    </button>
);
