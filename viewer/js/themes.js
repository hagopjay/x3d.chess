// Themes (original: themeStore.ts). Applied to the board PROTO fields, the Background and a rebuild of the pieces.
export const THEMES = {
  neon:    { bg: "0.02 0.03 0.06", dark: "0.18 0.2 0.3",  light: "0.55 0.6 0.72", tint: 1,
             w: { c: "0.95 0.95 0.9", e: "0.12 0.4 0.5" },  b: { c: "0.15 0.12 0.2", e: "0.45 0.05 0.35" } },
  classic: { bg: "0.09 0.07 0.06", dark: "0.36 0.22 0.12", light: "0.86 0.72 0.5",  tint: 0,
             w: { c: "0.97 0.93 0.82", e: "0.0 0.0 0.0" },  b: { c: "0.16 0.1 0.07", e: "0.0 0.0 0.0" } },
  ice:     { bg: "0.85 0.9 0.95", dark: "0.45 0.55 0.7", light: "0.92 0.95 0.98", tint: 0.4,
             w: { c: "1 1 1", e: "0.05 0.1 0.15" },        b: { c: "0.12 0.2 0.32", e: "0.0 0.05 0.12" } },
  // Greens, tuned for long viewing: low saturation, no pure white or black, soft piece contrast. `hue` replaces the neon eval tint
  // with a faint teal (white ahead) or amber (black ahead) wash, and the base emissive is zero so the greens stay true.
  sage:    { hue: { w: "0.0 0.07 0.05", b: "0.09 0.05 0.0" }, bg: "0.17 0.21 0.16", dark: "0.46 0.59 0.34", light: "0.93 0.93 0.82", tint: 0.15,        // tournament green and cream
             w: { c: "0.96 0.95 0.88", e: "0.0 0.0 0.0" },  b: { c: "0.17 0.2 0.16", e: "0.0 0.0 0.0" } },
  moss:    { hue: { w: "0.0 0.06 0.05", b: "0.08 0.05 0.0" }, bg: "0.055 0.09 0.07", dark: "0.13 0.22 0.17", light: "0.31 0.44 0.33", tint: 0.15,       // dark mode, lowest glare
             w: { c: "0.85 0.88 0.76", e: "0.02 0.04 0.02" }, b: { c: "0.05 0.1 0.08", e: "0.0 0.02 0.01" } },
  mint:    { hue: { w: "0.0 0.05 0.05", b: "0.07 0.04 0.0" }, bg: "0.9 0.95 0.91", dark: "0.55 0.7 0.6", light: "0.9 0.96 0.9", tint: 0.15,             // pastel, light mode
             w: { c: "0.99 0.99 0.97", e: "0.0 0.0 0.0" },  b: { c: "0.1 0.27 0.2", e: "0.0 0.0 0.0" } },
};
export const THEME_ORDER = ["moss", "sage", "mint", "neon", "classic", "ice"];
