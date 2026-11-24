import {SearchIndex, INDEX_VERSION} from './search-index.js';
import {tokenize} from './tokenize.js';

function cardUrl(path, manifestUrl) {
  return new URL(
    './' + path.replace(/^\//, '').split('/').map(encodeURIComponent).join('/'),
    manifestUrl,
  );
}

export function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const labels = new Map();
  for (const value of tags) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const tag = value.trim();
    labels.set(tag.toLowerCase(), labels.get(tag.toLowerCase()) ?? tag);
  }
  return [...labels.values()];
}

async function request(fetcher, url, options) {
  const response = await fetcher(url, options);
  if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  return response;
}

async function withOfflineFallback(load, fallback) {
  try {
    return await load();
  } catch (error) {
    const saved = await fallback?.().catch(() => undefined);
    if (saved != null) return saved;
    throw error;
  }
}

async function readManifest(href, {fetch: fetcher, offlineStore}) {
  const url = new URL(href);
  const key = url.href;
  const savedIndexKey = key + '#deck-search-index';
  return withOfflineFallback(
    async () => {
      const response = await request(fetcher, url, {cache: 'no-store'});
      if (response.redirected) url.href = response.url;
      const data = await response.json();
      if (data.version !== 1 || !Array.isArray(data.cards) || typeof data.index !== 'string') {
        throw new Error(`Invalid Deck manifest at ${key}`);
      }
      const result = {data, base: url.href};
      await offlineStore?.writeMetadata(key, result).catch(() => {});
      return result;
    },
    offlineStore &&
      (async () =>
        (await offlineStore.readMetadata(savedIndexKey))?.manifest ??
        (await offlineStore.readMetadata(key))),
  );
}

function createSnapshot(
  key,
  manifest,
  {fetch: fetcher, offlineStore, id, title, enabled, version},
) {
  const savedIndexKey = key + '#deck-search-index';
  const cards = manifest.data.cards.map(card => ({
    ...card,
    tags: normalizeTags(card.tags),
    deckId: id,
    deckTitle: title ?? manifest.data.title,
    ...(version !== undefined && {version}),
    url: cardUrl(card.path, manifest.base).href,
  }));
  const byPath = new Map(cards.map(card => [card.path, card]));
  const indexUrl = new URL(manifest.data.index, manifest.base);
  const pending = new Map();
  let index;

  function installIndex(raw) {
    if (
      raw?.version !== INDEX_VERSION ||
      !raw.terms ||
      Array.isArray(raw.terms) ||
      (manifest.data.searchRevision && raw.revision !== manifest.data.searchRevision)
    ) {
      throw new Error(`Invalid Deck search index at ${indexUrl}`);
    }
    const search = new SearchIndex();
    search.install(raw);
    return {search, raw};
  }

  function persistIndex(raw) {
    return offlineStore.writeMetadata(savedIndexKey, {url: indexUrl.href, raw, manifest});
  }

  function loadIndex() {
    index ??= withOfflineFallback(
      async () => {
        const result = installIndex(
          await (await request(fetcher, indexUrl, {cache: 'no-store'})).json(),
        );
        if (offlineStore) await persistIndex(result.raw).catch(() => {});
        return result;
      },
      offlineStore &&
        (async () => {
          const saved = await offlineStore.readMetadata(savedIndexKey);
          if (saved?.url === indexUrl.href) return installIndex(saved.raw);
        }),
    ).catch(error => {
      index = undefined;
      throw error;
    });
    return index;
  }

  function download(card) {
    if (pending.has(card.path)) return pending.get(card.path);
    const contentUrl = new URL(card.contentUrl ?? card.url, manifest.base);
    if (card.hash) contentUrl.searchParams.set('deck-v', card.hash);
    const promise = request(fetcher, contentUrl, {cache: 'no-store'})
      .then(response => response.text())
      .finally(() => pending.delete(card.path));
    pending.set(card.path, promise);
    return promise;
  }

  function requireCard(path) {
    const card = byPath.get(path);
    if (!card) throw new Error(`Unknown card ${path}`);
    return card;
  }

  function requireOfflineStore() {
    if (!offlineStore) throw new Error('Offline storage is unavailable');
    return offlineStore;
  }

  async function snapshot(card) {
    const saved = await offlineStore?.readCard(key, card.path, card.hash);
    return {path: card.path, hash: card.hash, content: saved?.content ?? (await download(card))};
  }

  return {
    id,
    title: title ?? manifest.data.title,
    enabled,
    version,
    versions: [],
    manifestUrl: key,
    baseUrl: new URL('.', manifest.base).href,
    dev: Boolean(manifest.data.dev),
    cards,
    pinned: (manifest.data.pinned ?? []).map(path => byPath.get(path)).filter(Boolean),
    suggestedTags: manifest.data.suggestedTags,
    offlineAvailable: Boolean(offlineStore),
    async search({query = '', tags = [], limit = 100} = {}) {
      const filters = normalizeTags(tags).map(tag => tag.toLowerCase());
      const matches = card =>
        card && filters.every(tag => card.tags.some(value => value.toLowerCase() === tag));
      if (!tokenize(query).length) {
        return cards
          .filter(matches)
          .slice(0, limit)
          .map(card => ({card, score: 0}));
      }
      const {search} = await loadIndex();
      return search
        .rank(query, {limit, matches: card => matches(byPath.get(card.path))})
        .map(({card, score}) => ({card: byPath.get(card.path), score}));
    },
    async getCard(path) {
      const card = requireCard(path);
      const exact = await offlineStore?.readCard(key, path, card.hash).catch(() => undefined);
      const content =
        exact?.content ??
        (await withOfflineFallback(
          () => download(card),
          offlineStore && (async () => (await offlineStore.readCard(key, path))?.content),
        ));
      return {...card, content};
    },
    offlineStatus: () => requireOfflineStore().status(key),
    async saveCard(path) {
      const store = requireOfflineStore();
      const card = requireCard(path);
      const [record, {raw}] = await Promise.all([snapshot(card), loadIndex()]);
      await persistIndex(raw);
      await store.writeCard(key, record);
    },
    removeSavedCard: path => requireOfflineStore().deleteCard(key, path),
    async saveProject({concurrency = 6} = {}) {
      const store = requireOfflineStore();
      const records = [];
      let next = 0;
      const workers = Array.from(
        {length: Math.min(cards.length, Math.max(1, concurrency || 1))},
        async () => {
          while (next < cards.length) {
            const index = next++;
            records[index] = await snapshot(cards[index]);
          }
        },
      );
      const [{raw}] = await Promise.all([loadIndex(), ...workers]);
      await persistIndex(raw);
      await store.writeProject(key, records);
    },
    removeSavedProject: () => requireOfflineStore().deleteProject(key),
  };
}

export async function openDeck({
  manifestUrl,
  fetch = globalThis.fetch,
  offlineStore,
  id,
  title,
  enabled = true,
  version,
  versions,
  defaultVersion,
}) {
  const base = globalThis.location?.href;
  const primary = manifestUrl == null ? undefined : new URL(manifestUrl, base).href;
  const storage = {fetch, offlineStore};
  const explicit = versions !== undefined;
  const initial =
    primary && (!explicit || version === undefined)
      ? await readManifest(primary, storage)
      : undefined;
  const catalog = explicit ? versions : (initial?.data.versions ?? []);
  if (!Array.isArray(catalog)) throw new Error('Deck versions must be an array');
  const entries = new Map();
  for (const entry of catalog) {
    if (typeof entry?.id !== 'string' || !entry.id.trim() || !entry.manifestUrl) {
      throw new Error('Each deck version requires an id and manifestUrl');
    }
    if (entries.has(entry.id)) throw new Error(`Duplicate deck version ${entry.id}`);
    const url = new URL(entry.manifestUrl, explicit ? base : initial?.base).href;
    entries.set(entry.id, {id: entry.id, title: entry.title ?? entry.id, manifestUrl: url});
  }

  const current =
    version ??
    initial?.data.versionId ??
    (primary && [...entries.values()].find(entry => entry.manifestUrl === primary)?.id) ??
    (primary && entries.size ? 'current' : undefined);
  if (current !== undefined && (typeof current !== 'string' || !current.trim())) {
    throw new Error('Deck version must be a non-empty string');
  }
  if (primary && current !== undefined) {
    const existing = entries.get(current);
    if (existing && existing.manifestUrl !== primary && existing.manifestUrl !== initial?.base) {
      throw new Error(`Deck version ${current} points to multiple manifests`);
    }
    if (!existing) entries.set(current, {id: current, title: current, manifestUrl: primary});
  }

  const config = {
    fetch,
    offlineStore,
    enabled,
    title,
    id: id ?? primary ?? entries.values().next().value?.manifestUrl,
  };
  if (primary && !entries.size) return createSnapshot(primary, initial, config);
  if (!entries.size) throw new Error('A Deck manifest URL or version catalog is required');

  const start =
    defaultVersion ??
    (!explicit ? initial?.data.defaultVersion : undefined) ??
    current ??
    entries.keys().next().value;
  const snapshots = new Map();
  const listeners = new Set();
  let active;
  let selection = 0;

  function load(versionId) {
    const entry = entries.get(versionId);
    if (!entry) throw new Error(`Unknown deck version ${versionId}`);
    if (!snapshots.has(versionId)) {
      const pending = (async () => {
        const href = entry.manifestUrl;
        const manifest =
          initial && (href === primary || href === initial.base)
            ? initial
            : await readManifest(href, storage);
        return createSnapshot(href, manifest, {...config, version: versionId});
      })().catch(error => {
        snapshots.delete(versionId);
        throw error;
      });
      snapshots.set(versionId, pending);
    }
    return snapshots.get(versionId);
  }

  active = await load(start);
  const deck = {
    id: config.id,
    enabled,
    defaultVersion: start,
    versions: [...entries.values()],
    subscribeVersion(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async setVersion(versionId) {
      if (!entries.has(versionId)) throw new Error(`Unknown deck version ${versionId}`);
      const request = ++selection;
      if (active.version === versionId) return false;
      try {
        const next = await load(versionId);
        if (request !== selection) return false;
        active = next;
      } catch (error) {
        if (request !== selection) return false;
        throw error;
      }
      for (const listener of listeners) listener();
      return true;
    },
  };
  for (const key of Object.keys(active)) {
    if (!Object.hasOwn(deck, key)) {
      Object.defineProperty(deck, key, {enumerable: true, get: () => active[key]});
    }
  }
  return deck;
}

export function composeDecks(decks) {
  const byId = new Map(decks.map(deck => [deck.id, deck]));
  if (byId.size !== decks.length) throw new Error('Deck IDs must be unique');
  const enabled = new Set(decks.filter(deck => deck.enabled).map(deck => deck.id));
  const subscribers = new Set();
  let unsubscribeVersions = [];
  const active = () => decks.filter(deck => enabled.has(deck.id));
  const notify = () => {
    for (const listener of subscribers) listener();
  };

  return {
    decks: [...decks],
    isEnabled: id => enabled.has(id),
    setEnabled(id, value) {
      if (!byId.has(id) || enabled.has(id) === Boolean(value)) return;
      if (value) enabled.add(id);
      else enabled.delete(id);
      notify();
    },
    async setVersion(id, versionId) {
      const deck = byId.get(id);
      if (!deck?.setVersion) throw new Error(`Deck ${id} has no version selector`);
      return deck.setVersion(versionId);
    },
    subscribe(listener) {
      if (!subscribers.size) {
        unsubscribeVersions = decks.flatMap(deck =>
          deck.subscribeVersion ? [deck.subscribeVersion(notify)] : [],
        );
      }
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
        if (!subscribers.size) {
          for (const unsubscribe of unsubscribeVersions) unsubscribe();
          unsubscribeVersions = [];
        }
      };
    },
    listCards: () => active().flatMap(deck => deck.cards),
    listPinned: () => active().flatMap(deck => deck.pinned),
    suggestedTags(limit = 8) {
      const frequencies = new Map();
      const decks = active();
      for (const {tags} of decks
        .filter(deck => deck.suggestedTags === undefined)
        .flatMap(deck => deck.cards)) {
        for (const tag of tags) {
          const key = tag.toLowerCase();
          const entry = frequencies.get(key) ?? {tag, count: 0};
          entry.count++;
          frequencies.set(key, entry);
        }
      }
      const procedural = [...frequencies.values()]
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
        .map(({tag}) => tag);
      const configured = decks.flatMap(deck => deck.suggestedTags ?? []);
      return normalizeTags([...configured, ...procedural]).slice(0, limit);
    },
    async search({limit = 100, onError, ...options} = {}) {
      const results = await Promise.all(
        active().map(async deck => {
          const version = deck.version;
          const isCurrent = () => enabled.has(deck.id) && version === deck.version;
          try {
            const matches = await deck.search({...options, limit});
            return isCurrent() ? matches : [];
          } catch (error) {
            if (!isCurrent()) return [];
            if (!onError) throw error;
            onError(error, deck);
            return [];
          }
        }),
      );
      return results
        .flat()
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(result => result.card);
    },
    getCard({deckId, path, version}) {
      const deck = byId.get(deckId);
      if (!deck || !enabled.has(deckId)) throw new Error(`Deck ${deckId} is unavailable`);
      if (version !== undefined && version !== deck.version) {
        throw new Error(`Deck ${deckId} version ${version} is no longer selected`);
      }
      return deck.getCard(path);
    },
  };
}
