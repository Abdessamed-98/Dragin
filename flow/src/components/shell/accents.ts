/**
 * Static accent class sets for the shell chrome (FileGrid / ToolFooter / header).
 *
 * Tailwind JIT can't see runtime-built class names like `text-${accent}-400/40`,
 * so shared shell components read fully-literal strings from here instead of
 * interpolating. Per-tool Controls keep their own literal classes. Add an entry
 * when a new shell tool uses a new accent.
 */
export interface AccentClasses {
    icon: string;         // header/upload icon color
    spinner: string;      // active processing spinner
    spinnerDim: string;   // placeholder spinner (no image yet)
    dropBorder: string;   // dropzone border when dragging over
    dropBg: string;       // dropzone background when dragging over
    dropIconBg: string;   // dropzone icon chip when dragging over
    button: string;       // primary action button (bg + hover + text)
}

export const ACCENTS: Record<string, AccentClasses> = {
    sky: {
        icon: 'text-sky-400',
        spinner: 'text-sky-400',
        spinnerDim: 'text-sky-400/40',
        dropBorder: 'border-sky-400',
        dropBg: 'bg-sky-500/10',
        dropIconBg: 'bg-sky-500/20',
        button: 'bg-sky-600 hover:bg-sky-500 text-white',
    },
    cyan: {
        icon: 'text-cyan-400',
        spinner: 'text-cyan-400',
        spinnerDim: 'text-cyan-400/40',
        dropBorder: 'border-cyan-400',
        dropBg: 'bg-cyan-500/10',
        dropIconBg: 'bg-cyan-500/20',
        button: 'bg-cyan-600 hover:bg-cyan-500 text-white',
    },
    orange: {
        icon: 'text-orange-400',
        spinner: 'text-orange-400',
        spinnerDim: 'text-orange-400/40',
        dropBorder: 'border-orange-400',
        dropBg: 'bg-orange-500/10',
        dropIconBg: 'bg-orange-500/20',
        button: 'bg-orange-600 hover:bg-orange-500 text-white',
    },
};

export const accentOf = (accent: string): AccentClasses => ACCENTS[accent] ?? ACCENTS.sky;
