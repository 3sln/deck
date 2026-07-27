/**
 * The files that tell crawlers and agents what a published deck contains.
 *
 * A deck is a single-page application: every card lives behind a `?c=` query
 * parameter and its body arrives by fetch. Anything that does not run
 * JavaScript — a search crawler, and most agents — sees one nearly empty page
 * and nothing else. The deck is fully readable, just not by looking at the
 * page it is served on.
 *
 * So the build writes down where the content actually is:
 *
 *   - `robots.txt`   — nothing is disallowed, and it names the sitemap.
 *   - `sitemap.xml`  — one entry per card, at the URL that opens it.
 *   - `llms.txt`     — the llmstxt.org convention: a map of the deck with a
 *                      direct link to each card's Markdown.
 *   - `agents.md` / `agents.html` — the whole deck as one document, demo
 *                      sources inlined, for an agent that would rather read
 *                      once than crawl.
 *
 * Absolute URLs need to know where the deck is published, which only the deck
 * itself knows. Set `url` in the config to get a sitemap; without it, the files
 * that can be relative are still written and the sitemap is skipped rather than
 * emitted full of URLs pointing at nowhere.
 */

const xmlEscape = value =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Trailing slashes off, so joins do not double up. */
const trimSlash = url => String(url).replace(/\/+$/, '');

/** The URL that opens a card in the app. */
export function cardUrl(baseUrl, cardPath) {
  return `${trimSlash(baseUrl)}/?c=${encodeURIComponent(cardPath)}`;
}

export function robotsTxt({title, url} = {}) {
  const lines = [
    `# ${title ?? 'Deck'}`,
    '#',
    '# This is a single-page application. The whole deck is also available as',
    '# plain documents, which is what you probably want if you are not a browser:',
    '#',
    '#   /llms.txt      an index of every card, linking to its Markdown',
    '#   /agents.md     every card concatenated, with demo sources inlined',
    '#   /agents.html   the same, as HTML',
    '',
    'User-agent: *',
    'Allow: /',
    '',
  ];
  if (url) {
    lines.push(`Sitemap: ${trimSlash(url)}/sitemap.xml`, '');
  }
  return lines.join('\n');
}

export function sitemapXml({url, cards}) {
  const entries = [
    `  <url>\n    <loc>${xmlEscape(trimSlash(url) + '/')}</loc>\n  </url>`,
    ...cards.map(card => `  <url>\n    <loc>${xmlEscape(cardUrl(url, card.path))}</loc>\n  </url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
}

/**
 * The llmstxt.org format: an H1, an optional summary, then linked sections.
 *
 * Links are to each card's Markdown file rather than to its `?c=` URL, because
 * the Markdown is the content and the `?c=` URL is an application that has to
 * be run to produce it.
 */
export function llmsTxt({title, description, cards, url}) {
  const absolute = path => (url ? `${trimSlash(url)}${path}` : path);

  const lines = [`# ${title ?? 'Deck'}`, ''];
  if (description) {
    lines.push(`> ${description}`, '');
  }
  lines.push(
    'Each link below is a single card, as Markdown. `/agents.md` is all of them ' +
      'concatenated into one document, with the source of any live demo inlined.',
    '',
    '## Cards',
    '',
  );

  for (const card of cards) {
    const summary = card.summary ? `: ${card.summary.replace(/\s+/g, ' ').trim()}` : '';
    lines.push(`- [${card.title}](${absolute(card.path)})${summary}`);
  }

  lines.push('', '## Optional', '', `- [Everything, in one file](${absolute('/agents.md')})`);
  if (url) {
    lines.push(`- [Sitemap](${absolute('/sitemap.xml')})`);
  }
  lines.push('');

  return lines.join('\n');
}
