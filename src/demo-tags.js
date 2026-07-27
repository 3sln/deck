/**
 * Reading and rewriting the `<deck-demo>` tags in a card.
 *
 * Small enough to have been a pair of regular expressions inlined in the build,
 * and that is exactly how it went wrong: `canonical-src` ends in `src="`, so a
 * greedy `[^>]*src="([^"]+)"` captures the canonical source in preference to
 * the real one, and a plain string replace of `src="…"` can land on the wrong
 * attribute depending on which order the author wrote them in. Attributes are
 * parsed and rewritten by name here instead.
 */

const DEMO_TAG = /<deck-demo\s+([^>]*)><\/deck-demo>/g;
const ATTR = /(?:^|\s)([\w-]+)="([^"]*)"/g;
const FENCE = /^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1\2[^\n]*$/gm;
/**
 * A tag's attributes, by name.
 *
 * Parsed rather than pattern-matched out, because `canonical-src` ends in
 * `src="` and a greedy `[^>]*src="([^"]+)"` therefore captures *it* in
 * preference to the real `src` — quietly telling the build that a demo's module
 * is the ClojureScript file it was authored from.
 */
export function attributesOf(tagBody) {
  const attributes = {};
  for (const match of tagBody.matchAll(ATTR)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

/** Rewrites one attribute of a tag, leaving every other one alone. */
export function withAttribute(tag, name, value) {
  const pattern = new RegExp(`(^|\\s)${name}="[^"]*"`);
  return pattern.test(tag)
    ? tag.replace(pattern, `$1${name}="${value}"`)
    : tag.replace(/\s*><\/deck-demo>$/, ` ${name}="${value}"></deck-demo>`);
}

/**
 * The demo tags a card actually embeds — not the ones it merely writes about.
 *
 * A card documenting `<deck-demo>` shows the tag in a fenced code block, and a
 * naive scan treats that example as a real embed: it warns that the file is
 * missing and, worse, would rewrite the example the reader is meant to copy.
 */
export function demoTagsIn(content) {
  const fences = [...content.matchAll(FENCE)].map(m => [m.index, m.index + m[0].length]);
  const inFence = index => fences.some(([start, end]) => index >= start && index < end);
  return [...content.matchAll(DEMO_TAG)]
    .filter(match => !inFence(match.index))
    .map(match => ({
      tag: match[0],
      index: match.index,
      attributes: attributesOf(match[1]),
    }));
}
