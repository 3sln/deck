export function splitFrontMatter(content) {
  const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(content);
  if (!match || match.index !== 0) return {body: content};
  return {metadata: match[1], body: content.slice(match[0].length)};
}

export function stripFrontMatter(content) {
  return splitFrontMatter(content).body;
}
