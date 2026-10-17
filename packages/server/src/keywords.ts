const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Which keywords appear in the worker's note: whole words or phrases, any case. An aid for the reviewer, never an automatic approval. */
export function matchKeywords(note: string | null | undefined, keywords: readonly string[]): string[] {
  if (!note) return [];
  return keywords.filter((k) => {
    const kw = k.trim();
    return kw !== "" && new RegExp(`(?<![\\p{L}\\p{N}])${escape(kw)}(?![\\p{L}\\p{N}])`, "iu").test(note);
  });
}
