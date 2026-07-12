export function chunkText(text: string, size = 500, overlap = 100): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const para of paras) {
    if ((current + "\n\n" + para).length > size && current) {
      chunks.push(current);
      current = current.slice(-overlap) + "\n\n" + para; // carry a little overlap
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}