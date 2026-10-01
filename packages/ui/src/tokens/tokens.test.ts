import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allTokens } from "./tokens";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

describe("tokens.css and tokens.ts agree", () => {
  for (const [name, value] of Object.entries(allTokens)) {
    it(name, () => {
      const m = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
      expect(m, `${name} missing from tokens.css`).not.toBeNull();
      expect(m![1]!.trim()).toBe(value);
    });
  }
});

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe("contrast (WCAG AA 4.5:1)", () => {
  const t = allTokens as Record<string, string>;
  for (const bg of ["--surface-2", "--surface-1", "--surface-0"]) {
    for (const fg of ["--text-primary", "--text-secondary", "--text-muted"]) {
      it(`${fg} on ${bg}`, () => expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5));
    }
  }
  it("white text on the brand button, rest and hover", () => {
    expect(ratio(t["--text-inverse"]!, t["--brand"]!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t["--text-inverse"]!, t["--brand-strong"]!)).toBeGreaterThanOrEqual(4.5);
  });
  it("brand text on brand-bg and on white", () => {
    expect(ratio(t["--brand"]!, t["--brand-bg"]!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t["--brand"]!, t["--surface-2"]!)).toBeGreaterThanOrEqual(4.5);
  });
  it("accent text on accent-bg and on white", () => {
    expect(ratio(t["--accent"]!, t["--accent-bg"]!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t["--accent"]!, t["--surface-2"]!)).toBeGreaterThanOrEqual(4.5);
  });
  for (const c of ["teal", "amber", "coral", "green"]) {
    it(`--${c} on --${c}-bg`, () => expect(ratio(t[`--${c}`]!, t[`--${c}-bg`]!)).toBeGreaterThanOrEqual(4.5));
  }
});
