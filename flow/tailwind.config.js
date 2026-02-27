/** @type {import('tailwindcss').Config} */

// All colorClass values used dynamically in ToolWidget/SideDock/Gallery.
// Listed explicitly so Tailwind JIT includes them even though they're
// constructed at runtime (e.g. `text-${colorClass}-400`).
const TOOL_COLORS = ['indigo', 'emerald', 'amber', 'pink', 'red', 'blue', 'orange', 'cyan', 'rose', 'fuchsia', 'violet', 'teal', 'sky'];
const colorSafelist = TOOL_COLORS.flatMap(c => [
    `text-${c}-300`, `text-${c}-400`,
    `bg-${c}-500`, `bg-${c}-500/10`, `bg-${c}-500/20`, `bg-${c}-600/50`,
    `border-${c}-500`, `border-${c}-500/20`, `border-${c}-500/30`,
    `ring-${c}-500`,
]);

export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    safelist: colorSafelist,
    theme: {
        extend: {},
    },
    plugins: [],
}
