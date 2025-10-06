const DB_NAME = 'reel-db';
const DB_VERSION = 2; // Bump version for schema change
const CARDS_STORE = 'cards';
const INDEX_STORE = 'searchIndex';

let dbPromise = null;

function promisifyRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function initDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const openRequest = indexedDB.open(DB_NAME, DB_VERSION);

        openRequest.onupgradeneeded = (event) => {
            const db = event.target.result;
            let cardsStore;
            if (!db.objectStoreNames.contains(CARDS_STORE)) {
                cardsStore = db.createObjectStore(CARDS_STORE, { keyPath: 'path' });
            } else {
                cardsStore = event.target.transaction.objectStore(CARDS_STORE);
            }

            if (!cardsStore.indexNames.contains('by-updatedAt')) {
                cardsStore.createIndex('by-updatedAt', 'updatedAt');
            }

            if (!db.objectStoreNames.contains(INDEX_STORE)) {
                const store = db.createObjectStore(INDEX_STORE, { keyPath: ['word', 'path'] });
                store.createIndex('by-word', 'word');
                store.createIndex('by-path', 'path');
            }
        };

        openRequest.onsuccess = (event) => resolve(event.target.result);
        openRequest.onerror = (event) => reject(event.target.error);
    });

    return dbPromise;
}

function tokenize(text) {
    if (!text) return [];
    return text.toLowerCase().match(/\w+/g) || [];
}

function getTextContent(html) {
    if (!html) return '';
    return new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
}

async function upsertCard(card, fetchTime) {
    const db = await initDB();
    const tx = db.transaction([CARDS_STORE, INDEX_STORE], 'readwrite');
    const cardsStore = tx.objectStore(CARDS_STORE);
    const indexStore = tx.objectStore(INDEX_STORE);

    const existing = await promisifyRequest(cardsStore.get(card.path));
    if (existing && existing.updatedAt >= fetchTime) {
        tx.abort();
        return;
    }

    if (existing) {
        const pathIndex = indexStore.index('by-path');
        const oldIndexKeys = await promisifyRequest(pathIndex.getAllKeys(IDBKeyRange.only(card.path)));
        await Promise.all(oldIndexKeys.map(key => promisifyRequest(indexStore.delete(key))));
    }

    const newCard = { ...card, updatedAt: Date.now() };
    const titleTokens = tokenize(newCard.title);
    const summaryTokens = tokenize(newCard.summary);
    const bodyText = getTextContent(newCard.body);
    const bodyTokens = tokenize(bodyText);

    const wordScores = new Map();
    const uniqueBodyWords = new Set(bodyTokens);
    const uniqueTitleWords = new Set(titleTokens);
    const uniqueSummaryWords = new Set(summaryTokens);

    uniqueBodyWords.forEach(word => {
        const tf = bodyTokens.filter(t => t === word).length;
        let score = tf;
        if (uniqueTitleWords.has(word)) score += 1;
        if (uniqueSummaryWords.has(word)) score += 1;
        wordScores.set(word, score);
    });

    await Promise.all(Array.from(wordScores.entries()).map(([word, score]) => {
        return promisifyRequest(indexStore.put({ word, path: newCard.path, score }));
    }));

    await promisifyRequest(cardsStore.put(newCard));
    return newCard;
}

async function removeCard(path) {
    const db = await initDB();
    const tx = db.transaction([CARDS_STORE, INDEX_STORE], 'readwrite');
    const cardsStore = tx.objectStore(CARDS_STORE);
    const indexStore = tx.objectStore(INDEX_STORE);

    const pathIndex = indexStore.index('by-path');
    const indexKeysToDelete = await promisifyRequest(pathIndex.getAllKeys(IDBKeyRange.only(path)));
    await Promise.all(indexKeysToDelete.map(key => promisifyRequest(indexStore.delete(key))));

    await promisifyRequest(cardsStore.delete(path));
}

function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];

    for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
    for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

async function findCardsByQuery(query, limit = 100) {
    const db = await initDB();
    const searchTokens = tokenize(query);
    if (searchTokens.length === 0) return [];

    const tx = db.transaction([CARDS_STORE, INDEX_STORE], 'readonly');
    const indexStore = tx.objectStore(INDEX_STORE);
    const cardsStore = tx.objectStore(CARDS_STORE);
    const wordIndex = indexStore.index('by-word');

    const pathScores = new Map();

    await Promise.all(searchTokens.map(async (word) => {
        const request = wordIndex.getAll(IDBKeyRange.only(word));
        const results = await promisifyRequest(request);
        results.forEach(({ path, score }) => {
            pathScores.set(path, (pathScores.get(path) || 0) + score);
        });
    }));

    if (pathScores.size > 0) {
        const sortedPaths = Array.from(pathScores.entries())
            .sort((a, b) => b[1] - a[1])
            .map(entry => entry[0])
            .slice(0, limit);
        
        const cards = await Promise.all(sortedPaths.map(path => promisifyRequest(cardsStore.get(path))));
        return cards.filter(Boolean);
    }

    // Fallback to aggregated word-by-word distance search
    console.log('No index match, falling back to word-distance search...');
    const allCards = await promisifyRequest(cardsStore.getAll());
    const cardScores = allCards.map(card => {
        const titleTokens = tokenize(card.title);
        const summaryTokens = tokenize(card.summary);
        const searchableTokens = [...new Set([...titleTokens, ...summaryTokens])];
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
                        currentScore = 0; // Skip this match
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

        return { card, score: totalScore };
    });

    return cardScores
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map(item => item.card);
}

async function getRecentCards(limit = 100) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CARDS_STORE, 'readonly');
        const index = tx.objectStore(CARDS_STORE).index('by-updatedAt');
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
    return await promisifyRequest(db.transaction(CARDS_STORE).objectStore(CARDS_STORE).get(path));
}

export { initDB, upsertCard, removeCard, findCardsByQuery, getRecentCards, getCard };