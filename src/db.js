/**
 * The client-side card store: an IndexedDB database of card bodies plus an
 * inverted index over them.
 *
 * The inverted index here is the *fallback* search. When a precompiled index is
 * available (see `search-index.js`) deck searches that instead, and cards are
 * stored without being indexed at all — which matters, because indexing a card
 * writes one row per distinct word in it, and a published deck can hold
 * thousands of cards. In dev there is no precompiled index, so this is the only
 * search there is and every card is indexed as it arrives.
 */

import {tokenize, scoreCard} from './tokenize.js';

const DB_NAME = 'deck-db';
const DB_VERSION = 3;
const CARDS_STORE = 'cards';
const INDEX_STORE = 'searchIndex';

let dbPromise = null;

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Resolves when the transaction commits, rejecting if it aborts.
 *
 * Every write path waits on this rather than on its last request. A request
 * succeeding only means the request succeeded; the transaction can still abort
 * afterwards (quota, a failed constraint elsewhere in the same transaction),
 * and a card reported as stored but rolled back is a card that silently never
 * loads again until the next prune.
 */
function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

function initDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(DB_NAME, DB_VERSION);

    openRequest.onupgradeneeded = event => {
      const db = event.target.result;
      const cardsStore = db.objectStoreNames.contains(CARDS_STORE)
        ? event.target.transaction.objectStore(CARDS_STORE)
        : db.createObjectStore(CARDS_STORE, {keyPath: 'path'});

      if (!cardsStore.indexNames.contains('by-updatedAt')) {
        cardsStore.createIndex('by-updatedAt', 'updatedAt');
      }
      if (!cardsStore.indexNames.contains('by-usedAt')) {
        cardsStore.createIndex('by-usedAt', 'usedAt');
      }

      if (!db.objectStoreNames.contains(INDEX_STORE)) {
        const store = db.createObjectStore(INDEX_STORE, {keyPath: ['word', 'path']});
        store.createIndex('by-word', 'word');
        store.createIndex('by-path', 'path');
      }
    };

    openRequest.onsuccess = event => {
      const db = event.target.result;
      // Another tab bumping the schema would otherwise leave this connection
      // blocking its upgrade forever.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    openRequest.onerror = event => reject(event.target.error);
  });

  return dbPromise;
}

function getTextContent(html) {
  if (!html) return '';
  return new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
}

async function clearIndexFor(indexStore, path) {
  const keys = await promisifyRequest(
    indexStore.index('by-path').getAllKeys(IDBKeyRange.only(path)),
  );
  for (const key of keys) indexStore.delete(key);
}

/**
 * Stores a card, replacing any previous copy.
 *
 * `index` decides whether the card also goes into the inverted index. Pass
 * false when a precompiled index is in play: the rows would never be read, and
 * writing them is the single most expensive thing deck does on a cold load.
 */
async function upsertCard(card, {index = true} = {}) {
  const db = await initDB();
  const tx = db.transaction([CARDS_STORE, INDEX_STORE], 'readwrite');
  const cardsStore = tx.objectStore(CARDS_STORE);
  const indexStore = tx.objectStore(INDEX_STORE);

  const existing = await promisifyRequest(cardsStore.get(card.path));
  if (existing) {
    await clearIndexFor(indexStore, card.path);
  }

  const now = Date.now();
  const newCard = {...card, updatedAt: now, usedAt: existing?.usedAt ?? now};

  if (index) {
    const scores = scoreCard({
      title: newCard.title,
      summary: newCard.summary,
      body: getTextContent(newCard.body),
    });
    for (const [word, score] of scores) {
      indexStore.put({word, path: newCard.path, score});
    }
  }

  cardsStore.put(newCard);
  await transactionDone(tx);
  return newCard;
}

async function removeCard(path) {
  const db = await initDB();
  const tx = db.transaction([CARDS_STORE, INDEX_STORE], 'readwrite');
  await clearIndexFor(tx.objectStore(INDEX_STORE), path);
  tx.objectStore(CARDS_STORE).delete(path);
  await transactionDone(tx);
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Searches the locally indexed cards.
 *
 * Results come back ranked by score, ties broken by how recently the card was
 * opened. Ranking by recency alone — which is what sorting the scored list by
 * `usedAt` amounts to — throws away the ranking the index just computed and
 * makes the best match land wherever it happens to land.
 */
async function findCardsByQuery(query, limit = 100) {
  const db = await initDB();
  const searchTokens = tokenize(query);
  if (searchTokens.length === 0) return [];

  const tx = db.transaction([CARDS_STORE, INDEX_STORE], 'readonly');
  const indexStore = tx.objectStore(INDEX_STORE);
  const cardsStore = tx.objectStore(CARDS_STORE);
  const wordIndex = indexStore.index('by-word');

  const pathScores = new Map();

  await Promise.all(
    searchTokens.map(async word => {
      const results = await promisifyRequest(wordIndex.getAll(IDBKeyRange.only(word)));
      results.forEach(({path, score}) => {
        pathScores.set(path, (pathScores.get(path) || 0) + score);
      });
    }),
  );

  if (pathScores.size > 0) {
    const ranked = [...pathScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const cards = await Promise.all(ranked.map(([path]) => promisifyRequest(cardsStore.get(path))));
    return cards
      .map((card, i) => (card ? {card, score: ranked[i][1]} : null))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || b.card.usedAt - a.card.usedAt)
      .map(item => item.card);
  }

  // Nothing matched a whole word. Fall back to a fuzzy pass over titles and
  // summaries, which is what catches a half-typed or slightly misspelled query.
  const allCards = await promisifyRequest(cardsStore.getAll());
  const cardScores = allCards.map(card => {
    const searchableTokens = [...new Set([...tokenize(card.title), ...tokenize(card.summary)])];
    let totalScore = 0;

    searchTokens.forEach(queryWord => {
      let bestWordScore = 0;
      searchableTokens.forEach(searchableWord => {
        let currentScore = 0;
        if (searchableWord.startsWith(queryWord)) {
          currentScore = 10 + queryWord.length; // High score for prefix
        } else {
          const longWord = queryWord.length > searchableWord.length ? queryWord : searchableWord;
          const shortWord = queryWord.length > searchableWord.length ? searchableWord : queryWord;

          if (longWord.length > 7 && shortWord.length < longWord.length / 2) {
            currentScore = 0; // Too far apart to be a typo; skip.
          } else {
            const distance = levenshtein(queryWord, searchableWord);
            if (distance <= 2) {
              currentScore = 1 / (distance + 1); // Score between 0 and 1
            }
          }
        }
        if (currentScore > bestWordScore) {
          bestWordScore = currentScore;
        }
      });
      totalScore += bestWordScore;
    });

    return {card, score: totalScore};
  });

  return cardScores
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.card.usedAt - a.card.usedAt)
    .slice(0, limit)
    .map(item => item.card);
}

async function getRecentCards(limit = 100) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CARDS_STORE, 'readonly');
    const index = tx.objectStore(CARDS_STORE).index('by-usedAt');
    const request = index.openCursor(null, 'prev');

    const results = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && results.length < limit) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

async function getCard(path) {
  const db = await initDB();
  const tx = db.transaction(CARDS_STORE, 'readonly');
  return await promisifyRequest(tx.objectStore(CARDS_STORE).get(path));
}

/** Bulk `getCard`, in one transaction. Missing paths come back as undefined. */
async function getCards(paths) {
  if (paths.length === 0) return [];
  const db = await initDB();
  const tx = db.transaction(CARDS_STORE, 'readonly');
  const store = tx.objectStore(CARDS_STORE);
  return await Promise.all(paths.map(path => promisifyRequest(store.get(path))));
}

/** The hash of every stored card, so a load can skip cards that are current. */
async function getStoredHashes() {
  const db = await initDB();
  const tx = db.transaction(CARDS_STORE, 'readonly');
  const cards = await promisifyRequest(tx.objectStore(CARDS_STORE).getAll());
  return new Map(cards.map(card => [card.path, card.hash]));
}

async function touchCard(path) {
  const db = await initDB();
  const tx = db.transaction(CARDS_STORE, 'readwrite');
  const store = tx.objectStore(CARDS_STORE);
  const card = await promisifyRequest(store.get(path));
  if (card) {
    card.usedAt = Date.now();
    store.put(card);
  }
  await transactionDone(tx);
}

async function pruneCards(livePaths) {
  const db = await initDB();
  const tx = db.transaction([CARDS_STORE, INDEX_STORE], 'readwrite');
  const cardsStore = tx.objectStore(CARDS_STORE);
  const indexStore = tx.objectStore(INDEX_STORE);

  const dbPaths = await promisifyRequest(cardsStore.getAllKeys());
  const livePathsSet = new Set(livePaths);

  const stalePaths = dbPaths.filter(path => !livePathsSet.has(path));
  if (stalePaths.length === 0) return [];

  for (const path of stalePaths) {
    await clearIndexFor(indexStore, path);
    cardsStore.delete(path);
  }
  await transactionDone(tx);
  return stalePaths;
}

export {
  initDB,
  upsertCard,
  removeCard,
  findCardsByQuery,
  getRecentCards,
  getCard,
  getCards,
  getStoredHashes,
  pruneCards,
  touchCard,
};
