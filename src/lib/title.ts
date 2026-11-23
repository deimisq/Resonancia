// Default take title: the first sentence of the first non-empty line, without expressive tags.
export function deriveTitle(text: string, max = 80): string {
  const line =
    text
      .replace(/<[^>]+>/g, " ")
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .find(Boolean) || "";
  const sentence = (line.split(/(?<=[.!?…])\s+/)[0] || "").replace(/[.,;:]+$/, "");
  if (sentence.length <= max) return sentence;
  return sentence.slice(0, max).replace(/\s+\S*$/, "") + "…";
}
