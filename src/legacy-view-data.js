import {parseCardContent} from './card-content.js';
import {SearchIndex, encodeIndex} from './search-index.js';
import {scoreCard, tokenize} from './tokenize.js';

export async function legacyDeck(entries, {pinnedPaths, title, searchIndexUrl}) {
  const baseUrl = new URL('.', document.baseURI).href;
  const index = new SearchIndex();
  if (searchIndexUrl) await index.load(new URL(searchIndexUrl, baseUrl));

  const cards = entries.map(entry => {
    const metadata = index.card(entry.path);
    return {
      ...entry,
      deckId: baseUrl,
      deckTitle: title,
      title:
        metadata?.title ??
        entry.title ??
        entry.path
          .split('/')
          .pop()
          .replace(/\.(md|html)$/i, ''),
      summary: metadata?.summary ?? entry.summary ?? '',
      tags: entry.tags ?? [],
      format: entry.path.endsWith('.html') ? 'html' : 'markdown',
      url: new URL('./' + entry.path.replace(/^\//, ''), baseUrl).href,
    };
  });
  const byPath = new Map(cards.map(card => [card.path, card]));
  let indexing;

  async function fetchDocument(card) {
    const response = await fetch(card.url, {cache: 'no-store'});
    if (!response.ok) throw new Error(`Could not load ${card.path} (HTTP ${response.status})`);
    const content = await response.text();
    const parsed = parseCardContent({...card, content});
    card.title = parsed.querySelector('h1')?.textContent.trim() || card.title;
    card.summary = parsed.querySelector('p')?.textContent.trim() || card.summary;
    const scores = scoreCard({...card, body: parsed.textContent});
    return {card, content, scores};
  }

  async function createIndex() {
    const documents = [];
    for (let start = 0; start < cards.length; start += 6) {
      const batch = await Promise.all(cards.slice(start, start + 6).map(fetchDocument));
      for (const {card, scores} of batch) documents.push({...card, scores});
    }
    index.install(encodeIndex(documents));
  }

  return {
    id: baseUrl,
    title,
    cards,
    pinned: (pinnedPaths ?? []).map(path => byPath.get(path)).filter(Boolean),
    enabled: true,
    manifestUrl: baseUrl,
    baseUrl,
    async search({query = '', tags = [], limit = 100} = {}) {
      const matchesTags = card =>
        tags.every(tag => card.tags.some(value => value.toLowerCase() === tag.toLowerCase()));
      if (!tokenize(query).length)
        return cards
          .filter(matchesTags)
          .slice(0, limit)
          .map(card => ({card, score: 0}));
      if (!index.available) {
        indexing ??= createIndex().catch(error => {
          indexing = undefined;
          throw error;
        });
        await indexing;
      }
      return index
        .search(query, cards.length)
        .map(({path}) => byPath.get(path))
        .filter(card => card && matchesTags(card))
        .slice(0, limit)
        .map((card, rank) => ({card, score: limit - rank}));
    },
    async getCard(path) {
      const {card, content} = await fetchDocument(byPath.get(path));
      return {...card, content};
    },
  };
}
