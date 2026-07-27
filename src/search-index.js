/**
 * The precompiled search index: built once by `deck-build`, downloaded once by
 * the browser, before any card is fetched.
 *
 * Without it, deck can only search what it has already downloaded and indexed
 * into IndexedDB, so on a cold visit to a large deck the first searches are
 * answered from a fraction of the deck and quietly get better as cards trickle
 * in. With it, the very first search is answered from the whole deck — and
 * because the index carries each card's title and summary, results render
 * immediately, whether or not their bodies have arrived yet. Fetching the
 * missing bodies is then a matter of priority, not of correctness (see
 * `fetcher.js`).
 *
 * Dev builds do not have one. `available` is false there and callers fall back
 * to the IndexedDB index, which is the right trade for a deck you are editing:
 * no build step, and the content is whatever is on disk this second.
 *
 * ## Wire format (version 1)
 *
 *     {
 *       "version": 1,
 *       "cards": [[path, title, summary, hash], ...],
 *       "terms": {"word": [cardIndex, score, cardIndex, score, ...]}
 *     }
 *
 * Postings are flat number arrays rather than arrays of pairs: same
 * information, roughly half the JSON, and it parses faster.
 */

import {tokenize, PREFIX_WEIGHT} from './tokenize.js';

export const INDEX_VERSION = 1;
export const INDEX_FILE = 'deck-search-index.json';

/** Builds the wire format from `[{path, title, summary, hash, scores}]`. */
export function encodeIndex(entries) {
  const cards = [];
  const terms = Object.create(null);

  entries.forEach(({path, title, summary, hash, scores}, cardIndex) => {
    cards.push([path, title ?? path, summary ?? '', hash ?? '']);
    for (const [word, score] of scores) {
      const postings = terms[word] ?? (terms[word] = []);
      postings.push(cardIndex, score);
    }
  });

  return {version: INDEX_VERSION, cards, terms};
}

export class SearchIndex {
  #cards = [];
  #byPath = new Map();
  #terms = new Map();
  /** Sorted, so a prefix scan can stop as soon as it runs past the prefix. */
  #sortedTerms = [];
  #loaded = false;

  /** Whether a precompiled index is in hand. False in dev, and after a failure. */
  get available() {
    return this.#loaded;
  }

  get size() {
    return this.#cards.length;
  }

  /**
   * Downloads and installs the index.
   *
   * A missing or malformed index is not fatal — it degrades deck to the
   * IndexedDB search rather than breaking it — so this reports failure by
   * returning false and never rejects.
   */
  async load(url, {fetch: fetchImpl = (...args) => globalThis.fetch(...args)} = {}) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      this.install(await response.json());
      return true;
    } catch (err) {
      console.warn(
        `Deck: no precompiled search index at ${url}; searching loaded cards only.`,
        err,
      );
      return false;
    }
  }

  install(data) {
    if (!data || data.version !== INDEX_VERSION || !Array.isArray(data.cards)) {
      throw new Error(`Unsupported search index (version ${data?.version}).`);
    }

    this.#cards = data.cards.map(([path, title, summary, hash]) => ({
      path,
      title: title || path,
      summary: summary || '',
      hash: hash || '',
    }));
    this.#byPath = new Map(this.#cards.map((card, index) => [card.path, index]));
    this.#terms = new Map(Object.entries(data.terms ?? {}));
    this.#sortedTerms = [...this.#terms.keys()].sort();
    this.#loaded = true;
  }

  /** Every path the index knows, in build order. */
  paths() {
    return this.#cards.map(card => card.path);
  }

  /**
   * The metadata for a path: enough to render a list item, or the header of a
   * card whose body is still in flight. Undefined for a path the index has
   * never heard of.
   */
  card(path) {
    const index = this.#byPath.get(path);
    return index === undefined ? undefined : this.#cards[index];
  }

  /**
   * Ranked results for `query`, as card metadata.
   *
   * Every token is matched exactly. The *last* token is additionally matched by
   * prefix, because it is the one the reader is still typing — that is what
   * makes results appear as the query is entered rather than only when a word
   * is finished. A token that matches nothing exactly falls back to prefix
   * matching too, so a typo-free partial word never returns nothing.
   */
  search(query, limit = 100) {
    if (!this.#loaded) return [];
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const scores = new Map();
    const add = (cardIndex, score) => {
      scores.set(cardIndex, (scores.get(cardIndex) ?? 0) + score);
    };

    tokens.forEach((token, i) => {
      const exact = this.#terms.get(token);
      if (exact) {
        for (let p = 0; p < exact.length; p += 2) add(exact[p], exact[p + 1]);
      }
      const isLast = i === tokens.length - 1;
      if (exact && !isLast) return;

      for (const term of this.#prefixed(token)) {
        if (term === token) continue;
        const postings = this.#terms.get(term);
        for (let p = 0; p < postings.length; p += 2) {
          add(postings[p], postings[p + 1] * PREFIX_WEIGHT);
        }
      }
    });

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1] || this.#cards[a[0]].title.localeCompare(this.#cards[b[0]].title))
      .slice(0, limit)
      .map(([cardIndex]) => this.#cards[cardIndex]);
  }

  /** Terms starting with `prefix`, via binary search over the sorted term list. */
  *#prefixed(prefix) {
    const terms = this.#sortedTerms;
    let low = 0;
    let high = terms.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (terms[mid] < prefix) low = mid + 1;
      else high = mid;
    }
    for (let i = low; i < terms.length && terms[i].startsWith(prefix); i++) {
      yield terms[i];
    }
  }
}
