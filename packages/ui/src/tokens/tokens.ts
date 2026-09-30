/** Typed mirror of tokens.css, used by /design-system in ui-hub. tokens.test.ts keeps both in sync. */
export const colorTokens = {
  surface: { "--surface-2": "#ffffff", "--surface-1": "#f6f5f2", "--surface-0": "#efeee8" },
  text: {
    "--text-primary": "#1a1a18",
    "--text-secondary": "#57564f",
    "--text-muted": "#6a6862",
    "--text-inverse": "#ffffff"
  },
  border: { "--border": "#dddddd", "--border-strong": "#b8b6ae" },
  status: {
    "--teal": "#0f6e56",
    "--teal-bg": "#e1f5ee",
    "--amber": "#854f0b",
    "--amber-bg": "#faeeda",
    "--coral": "#993c1d",
    "--coral-bg": "#faece7",
    "--green": "#3b6d11",
    "--green-bg": "#eaf3de"
  }
} as const;

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
  ...colorTokens.status,
  ...fontTokens,
  ...sizeTokens,
  ...radiusTokens,
  ...spaceTokens
};
