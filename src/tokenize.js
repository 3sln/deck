/**
 * The one place deck decides what a word is and what a word is worth.
 *
 * Both indexers use it: the browser one in `db.js`, which indexes cards as they
 * arrive, and the build-time one in `bin/build.js`, which precompiles the whole
 * deck into a single downloadable index. They have to agree, or a search would
 * rank differently depending on whether the precompiled index happened to be
 * available — which is exactly the kind of difference that only ever shows up
 * in production.
 *
 * Deliberately free of both DOM and node APIs so it can be imported from
 * either side.
 */

const WORD = /[\p{L}\p{N}_]+/gu;

/** Lowercased word tokens. Punctuation and whitespace split; nothing is stemmed. */
export function tokenize(text) {
  if (!text) return [];
  return String(text).toLowerCase().match(WORD) ?? [];
}

const TITLE_BOOST = 8;
const SUMMARY_BOOST = 3;

/**
 * Scores every word of a card, as `Map<word, score>`.
 *
 * A word's score is how often it appears in the body, plus a boost for
 * appearing in the title or the summary. The boosts are large relative to
 * ordinary term frequency because a deck is a set of *named* documents: a
 * reader searching "configuration" wants the card called Configuration, not the
 * card that happens to say the word nine times.
 *
 * Words that appear only in the title or summary still score — `body` is
 * allowed to be empty, which is what indexing a card from its metadata alone
 * looks like.
 */
export function scoreCard({title = '', summary = '', body = ''} = {}) {
  const bodyTokens = tokenize(body);
  const titleWords = new Set(tokenize(title));
  const summaryWords = new Set(tokenize(summary));

  const scores = new Map();
  for (const word of bodyTokens) {
    scores.set(word, (scores.get(word) ?? 0) + 1);
  }
  for (const word of titleWords) {
    scores.set(word, (scores.get(word) ?? 0) + TITLE_BOOST);
  }
  for (const word of summaryWords) {
    scores.set(word, (scores.get(word) ?? 0) + SUMMARY_BOOST);
  }
  return scores;
}

/**
 * How much a prefix match is worth relative to an exact one.
 *
 * Typing is prefix matching: everything up to the final keystroke of "deck" is
 * a prefix of it. Scoring prefixes at full weight would let a long word the
 * reader has not finished typing outrank the exact word they just finished, so
 * they are discounted — enough to lose a tie, not enough to disappear.
 */
export const PREFIX_WEIGHT = 0.4;
