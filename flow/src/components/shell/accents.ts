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
    rose: {
        icon: 'text-rose-400',
        spinner: 'text-rose-400',
        spinnerDim: 'text-rose-400/40',
        dropBorder: 'border-rose-400',
        dropBg: 'bg-rose-500/10',
        dropIconBg: 'bg-rose-500/20',
        button: 'bg-rose-600 hover:bg-rose-500 text-white',
    },
    pink: {
        icon: 'text-pink-400',
        spinner: 'text-pink-400',
        spinnerDim: 'text-pink-400/40',
        dropBorder: 'border-pink-400',
        dropBg: 'bg-pink-500/10',
        dropIconBg: 'bg-pink-500/20',
        button: 'bg-pink-600 hover:bg-pink-500 text-white',
    },
    emerald: {
        icon: 'text-emerald-400',
        spinner: 'text-emerald-400',
        spinnerDim: 'text-emerald-400/40',
        dropBorder: 'border-emerald-400',
        dropBg: 'bg-emerald-500/10',
        dropIconBg: 'bg-emerald-500/20',
        button: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    },
    blue: {
        icon: 'text-blue-400',
        spinner: 'text-blue-400',
        spinnerDim: 'text-blue-400/40',
        dropBorder: 'border-blue-400',
        dropBg: 'bg-blue-500/10',
        dropIconBg: 'bg-blue-500/20',
        button: 'bg-blue-600 hover:bg-blue-500 text-white',
    },
    violet: {
        icon: 'text-violet-400',
        spinner: 'text-violet-400',
        spinnerDim: 'text-violet-400/40',
        dropBorder: 'border-violet-400',
        dropBg: 'bg-violet-500/10',
        dropIconBg: 'bg-violet-500/20',
        button: 'bg-violet-600 hover:bg-violet-500 text-white',
    },
    fuchsia: {
        icon: 'text-fuchsia-400',
        spinner: 'text-fuchsia-400',
        spinnerDim: 'text-fuchsia-400/40',
        dropBorder: 'border-fuchsia-400',
        dropBg: 'bg-fuchsia-500/10',
        dropIconBg: 'bg-fuchsia-500/20',
        button: 'bg-fuchsia-600 hover:bg-fuchsia-500 text-white',
    },
    teal: {
        icon: 'text-teal-400',
        spinner: 'text-teal-400',
        spinnerDim: 'text-teal-400/40',
        dropBorder: 'border-teal-400',
        dropBg: 'bg-teal-500/10',
        dropIconBg: 'bg-teal-500/20',
        button: 'bg-teal-600 hover:bg-teal-500 text-white',
    },
};

export const accentOf = (accent: string): AccentClasses => ACCENTS[accent] ?? ACCENTS.sky;
