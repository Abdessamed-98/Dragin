# Dragin Tools — Brand Assets

Suite-level brand (the umbrella "Dragin Tools", not any single app). Apps (Flow, Glimpse, Space)
reference these assets; don't fork per-app copies.

## Tokens

| Token | Value |
|---|---|
| Gradient (symbol) | radial, 135°: `#B5A7FC` → `#706FFB` (from top-right) |
| Accent (flat, when gradient impractical) | `#706FFB` |
| Wordmark on light | `Dragin` `#1B1B1E` · `TOOLS` `#000000` |
| Wordmark on dark | `Dragin` `#FFFFFF` · `TOOLS` `#E7E7EC` |
| Symbol corner radius | 48/200 of tile size (24%) |

## Files

```
svg/symbol-gradient.svg    the mark, gradient (master)
svg/symbol-white.svg       mono white — dark UIs, macOS tray/template icons
svg/symbol-black.svg       mono black — light print contexts
svg/lockup-on-light.svg    symbol + wordmark, for light backgrounds (master export from Figma)
svg/lockup-on-dark.svg     symbol + wordmark, for dark backgrounds (derived)
png/symbol-{16..1024}.png  raster renders (resvg)
png/symbol-white-*.png     mono white rasters
png/lockup-{light,dark}-{512..2048}.png
favicon.ico                multi-size (16/32/48/64/128/256)
```

Regenerate rasters from the SVGs with `@resvg/resvg-js` (any renderer with correct
radial-gradient support works; avoid renderPM/svglib — poor gradient handling).

## Usage notes

- **≤24px**: the fold motif fades — the mark reads as a plain gradient tile. Fine for
  favicons; use ≥32px wherever the fold should be recognizable.
- **macOS menu bar / tray**: use `symbol-white` as a template image (monochrome), never
  the gradient version.
- The wordmark is **outlined vector** (no font file shipped or embedded).

## Font

Wordmark is set in **Montserrat** (SIL Open Font License — free for any use, including
logos): `Dragin` = Bold (700), `TOOLS` = SemiBold (600), letterspaced/justified to the
"Dragin" width. Outlined to paths — no font file is shipped or required.

The original draft used Gotham (commercial, unlicensed) — replaced 2026-07 with
Montserrat, traced programmatically (fontTools instancer + opentype.js) to match the
original lockup geometry (cap heights, baselines, x-origin). Sync the Figma file's
wordmark to Montserrat Bold/SemiBold when convenient so design and repo match.
