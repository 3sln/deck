import {test, expect} from 'bun:test';
import {robotsTxt, sitemapXml, llmsTxt, cardUrl} from '../src/discovery.js';

const cards = [
  {path: '/cards/intro.md', title: 'Introduction', summary: 'What this is.'},
  {path: '/cards/a b.md', title: 'Spaced & Ampersanded', summary: ''},
];

test('robots.txt allows everything and points at the plain documents', () => {
  const robots = robotsTxt({title: 'My Deck', url: 'https://deck.example.com'});
  expect(robots).toContain('User-agent: *');
  expect(robots).toContain('Allow: /');
  expect(robots).not.toContain('Disallow');
  expect(robots).toContain('/llms.txt');
  expect(robots).toContain('/agents.md');
  expect(robots).toContain('Sitemap: https://deck.example.com/sitemap.xml');
});

test('robots.txt names no sitemap when the deck does not know its own URL', () => {
  const robots = robotsTxt({title: 'My Deck'});
  expect(robots).not.toContain('Sitemap:');
  expect(robots).toContain('Allow: /');
});

test('a trailing slash on the configured URL does not double up', () => {
  expect(robotsTxt({url: 'https://x.example.com/'})).toContain('https://x.example.com/sitemap.xml');
  expect(cardUrl('https://x.example.com/', '/cards/a.md')).toBe(
    'https://x.example.com/?c=%2Fcards%2Fa.md',
  );
});

test('the sitemap lists the root and every card, at the URL that opens it', () => {
  const xml = sitemapXml({url: 'https://deck.example.com', cards});
  expect(xml).toContain('<loc>https://deck.example.com/</loc>');
  expect(xml).toContain('<loc>https://deck.example.com/?c=%2Fcards%2Fintro.md</loc>');
  // A card path is percent-encoded into the query, and the XML is escaped on
  // top of that — an unescaped `&` in a loc is a malformed sitemap.
  expect(xml).toContain('%2Fcards%2Fa%20b.md');
  expect(xml).not.toMatch(/&(?!amp;|apos;|quot;|lt;|gt;)/);
  expect(xml.match(/<url>/g)).toHaveLength(3);
});

test('llms.txt is a map of the deck, linking the Markdown rather than the app', () => {
  const txt = llmsTxt({
    title: 'My Deck',
    description: 'A deck about things.',
    url: 'https://deck.example.com',
    cards,
  });
  expect(txt.startsWith('# My Deck')).toBe(true);
  expect(txt).toContain('> A deck about things.');
  expect(txt).toContain('[Introduction](https://deck.example.com/cards/intro.md): What this is.');
  expect(txt).toContain('[Everything, in one file](https://deck.example.com/agents.md)');
  // The `?c=` URL is an application; the Markdown is the content.
  expect(txt).not.toContain('?c=');
});

test('llms.txt falls back to relative links without a configured URL', () => {
  const txt = llmsTxt({title: 'My Deck', cards});
  expect(txt).toContain('[Introduction](/cards/intro.md)');
  expect(txt).toContain('[Everything, in one file](/agents.md)');
  expect(txt).not.toContain('Sitemap');
});

test('a card with no summary still gets a clean line', () => {
  const txt = llmsTxt({title: 'D', cards});
  expect(txt).toContain('- [Spaced & Ampersanded](/cards/a b.md)\n');
});
