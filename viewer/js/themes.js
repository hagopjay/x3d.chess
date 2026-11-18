// Themes (original: themeStore.ts). Applied to the board PROTO fields, the Background and a rebuild of the pieces.
export const THEMES = {
  neon:    { bg: "0.02 0.03 0.06", dark: "0.18 0.2 0.3",  light: "0.55 0.6 0.72", tint: 1,
             w: { c: "0.95 0.95 0.9", e: "0.12 0.4 0.5" },  b: { c: "0.15 0.12 0.2", e: "0.45 0.05 0.35" } },
  classic: { bg: "0.09 0.07 0.06", dark: "0.36 0.22 0.12", light: "0.86 0.72 0.5",  tint: 0,
             w: { c: "0.97 0.93 0.82", e: "0.0 0.0 0.0" },  b: { c: "0.16 0.1 0.07", e: "0.0 0.0 0.0" } },
  ice:     { bg: "0.85 0.9 0.95", dark: "0.45 0.55 0.7", light: "0.92 0.95 0.98", tint: 0.4,
             w: { c: "1 1 1", e: "0.05 0.1 0.15" },        b: { c: "0.12 0.2 0.32", e: "0.0 0.05 0.12" } },
};
export const THEME_ORDER = ["neon", "classic", "ice"];
