/** Typed mirror of tokens.css, used by /design-system in ui-hub. tokens.test.ts keeps both in sync. */
export const colorTokens = {
  surface: { "--surface-2": "#ffffff", "--surface-1": "#f5f7f4", "--surface-0": "#e9eee9" },
  text: {
    "--text-primary": "#16211b",
    "--text-secondary": "#44524a",
    "--text-muted": "#5a685f",
    "--text-inverse": "#ffffff"
  },
  border: { "--border": "#dce3dd", "--border-strong": "#b3bdb5" },
  brand: { "--brand": "#0c6a4e", "--brand-strong": "#08523d", "--brand-bg": "#e1f2ea" },
  accent: { "--accent": "#8c5200", "--accent-bg": "#fdefd2" },
  status: {
    "--teal": "#0c6a4e",
    "--teal-bg": "#e1f2ea",
    "--green": "#0c6a4e",
    "--green-bg": "#e1f2ea",
    "--amber": "#8c5200",
    "--amber-bg": "#fdefd2",
    "--coral": "#a13a22",
    "--coral-bg": "#fbe9e3"
  }
} as const;

export const layoutTokens = { "--safe-top": "12px", "--safe-bottom": "24px" } as const;

export const fontTokens = {
  "--font-body": '"Urbanist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  "--font-heading": '"Rosarivo", Georgia, "Times New Roman", serif',
  "--font-mono": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
} as const;

export const sizeTokens = {
  "--text-2xs": "10.5px",
  "--text-xs": "11px",
  "--text-sm": "12px",
  "--text-md": "13px",
  "--text-lg": "14px",
  "--text-xl": "15px",
  "--text-2xl": "20px",
  "--text-stat": "16px",
  "--text-display": "40px"
} as const;

export const radiusTokens = {
  "--radius-sm": "8px",
  "--radius-md": "10px",
  "--radius-lg": "12px",
  "--radius-pill": "20px",
  "--radius-device": "30px"
} as const;

export const spaceTokens = {
  "--space-1": "4px",
  "--space-2": "6px",
  "--space-3": "8px",
  "--space-4": "10px",
  "--space-5": "12px",
  "--space-6": "14px",
  "--space-7": "16px",
  "--space-8": "20px",
  "--space-9": "32px"
} as const;

export const allTokens: Record<string, string> = {
  ...colorTokens.surface,
  ...colorTokens.text,
  ...colorTokens.border,
  ...colorTokens.brand,
  ...colorTokens.accent,
  ...colorTokens.status,
  ...fontTokens,
  ...sizeTokens,
  ...radiusTokens,
  ...spaceTokens,
  ...layoutTokens
};
