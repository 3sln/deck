import {createHash} from 'node:crypto';
import {parse} from 'yaml';
import {extractCard} from './card-text.js';
import {sha256, toWebPath} from './config.js';
import {normalizeTags} from './data.js';
import {splitFrontMatter} from './frontmatter.js';
import {encodeIndex, INDEX_FILE} from './search-index.js';
import {scoreCard} from './tokenize.js';

export const MANIFEST_FILE = 'deck-manifest.json';
export const CARD_PREFIX = '/@deck-card/';

export function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function slugSegment(value) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function explicitSlug(value, file) {
  const segments = typeof value === 'string' ? value.split('/').map(slugSegment) : [];
  if (!segments.length || segments.some(segment => !segment)) {
    throw new Error(`Invalid card slug in ${file}: use words separated by hyphens or slashes`);
  }
  return segments.join('/');
}

function defaultSlug(path) {
  return (
    path
      .replace(/^\/(?:cards\/)?/i, '')
      .replace(/\.(?:md|html)$/i, '')
      .split('/')
      .map(slugSegment)
      .filter(Boolean)
      .join('/') || 'card'
  );
}

function assignSlugs(cards) {
  const requested = cards.map(card => ({card, slug: card.slug ?? defaultSlug(card.path)}));
  const reserved = new Set(requested.map(entry => entry.slug));
  const assigned = new Map();
  for (const {card, slug} of requested) {
    if (card.slug === undefined) continue;
    if (assigned.has(slug)) {
      throw new Error(`Duplicate card slug "${slug}" in ${assigned.get(slug)} and ${card.path}`);
    }
    assigned.set(slug, card.path);
  }
  return requested.map(({card, slug}) => {
    if (card.slug !== undefined) return card;
    const base = slug;
    if (assigned.has(slug)) {
      let suffix = 2;
      do {
        slug = `${base}-${suffix++}`;
      } while (assigned.has(slug) || reserved.has(slug));
    }
    assigned.set(slug, card.path);
    return {...card, slug};
  });
}

export async function describeCard(file, raw, contentUrl) {
  const format = file.endsWith('.html') ? 'html' : 'markdown';
  const {metadata, body} = format === 'markdown' ? splitFrontMatter(raw) : {body: raw};
  let properties = {};
  if (metadata) {
    try {
      properties = parse(metadata) ?? {};
    } catch (error) {
      throw new Error(`Invalid front matter in ${file}: ${error.message}`, {cause: error});
    }
  }

  const extracted = extractCard(file, body);
  const title =
    (typeof properties.title === 'string' && properties.title.trim()) || extracted.title;
  const summary =
    (typeof properties.summary === 'string' && properties.summary.trim()) || extracted.summary;
  const tags = normalizeTags(properties.tags);
  return {
    path: toWebPath(file),
    format,
    hash: await sha256(raw),
    title,
    summary,
    tags,
    ...(properties.slug !== undefined && {slug: explicitSlug(properties.slug, file)}),
    scores: scoreCard({title, summary, tags, body: extracted.text}),
    ...(contentUrl && {contentUrl}),
  };
}

export function createArtifacts(cards, config, {dev = false} = {}) {
  const index = encodeIndex(cards);
  // Include the postings in the revision so changes to indexing invalidate it.
  const searchRevision = createHash('sha256').update(JSON.stringify(index)).digest('hex');
  return {
    manifest: {
      version: 1,
      title: config.title,
      index: `./${INDEX_FILE}?v=${searchRevision}`,
      searchRevision,
      cards: assignSlugs(cards).map(({scores, ...card}) => card),
      pinned: config.pinned,
      ...(config.version !== undefined && {versionId: config.version}),
      ...(config.versions !== undefined && {versions: config.versions}),
      ...(config.defaultVersion !== undefined && {defaultVersion: config.defaultVersion}),
      ...(dev && {dev}),
      ...(config.suggestedTags !== undefined && {
        suggestedTags: normalizeTags(config.suggestedTags),
      }),
    },
    index: {...index, revision: searchRevision},
  };
}
