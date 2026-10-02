// Downloads the latin subset of the hub fonts and writes them as base64 @font-face rules
// so the standalone HTML files render correctly offline. Run only when the fonts change.
import { writeFileSync } from "node:fs";

const CSS_URL = "https://fonts.googleapis.com/css2?family=Rosarivo&family=Urbanist:wght@400;500&display=swap";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const css = await (await fetch(CSS_URL, { headers: { "user-agent": UA } })).text();
const blocks = css.split("/* ").slice(1).filter((b) => b.startsWith("latin */"));
let out = "";
for (const b of blocks) {
  const url = /url\((https:[^)]+)\)/.exec(b)?.[1];
  if (!url) continue;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  out += "@font-face{" + b.slice(b.indexOf("{") + 1, b.lastIndexOf("}")).replace(/src:[^;]+;/, `src:url(data:font/woff2;base64,${buf.toString("base64")}) format('woff2');`).replace(/\s+/g, " ") + "}\n";
}
writeFileSync(new URL("../standalone/fonts.inline.txt", import.meta.url), out);
console.log(`fonts: ${blocks.length} faces, ${(out.length / 1024).toFixed(0)} KB`);
