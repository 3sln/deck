/**
 * A concurrency-limited fetcher whose queue is ordered by priority, and whose
 * already-queued entries can be re-prioritised after the fact.
 *
 * Deck loads every card in the deck up front, which for a large project is
 * thousands of requests. What the reader actually wants is almost never the
 * order the glob happened to produce:
 *
 *   - the card named by `?c=` should arrive first, so a deep link opens
 *     straight away rather than after the rest of the deck has drained;
 *   - while a search is on screen, the cards that match it should jump the
 *     queue, so clicking a result opens it instead of showing a spinner.
 *
 * Both of those are decided *after* the requests have been queued, which is why
 * `prioritize` exists. Rather than reordering the queue in place — O(n) per
 * move over a queue that can hold thousands of entries — an entry keeps its
 * `priority` field as the single source of truth and is simply pushed into its
 * new bucket. Stale copies left behind in the old bucket are skipped on the way
 * out, so a re-prioritisation costs O(1) and dequeuing stays amortised O(1).
 */

export const PRIORITY = {
  /** The card the URL asks for. Nothing should get in front of this. */
  IMMEDIATE: 0,
  /** Cards matching the search currently on screen. */
  SEARCH: 1,
  /** Everything else: the background sweep that populates the index. */
  NORMAL: 2,
};

const LEVELS = 3;

export class PriorityFetcher {
  #queues = Array.from({length: LEVELS}, () => []);
  #byKey = new Map();
  #active = 0;
  #pumpScheduled = false;
  #concurrency;
  #impl;

  constructor(concurrency = 6, {fetch: fetchImpl} = {}) {
    this.#concurrency = concurrency;
    this.#impl = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  /** Requests still waiting for a slot. */
  get pending() {
    return this.#byKey.size;
  }

  /**
   * `key` names the request for a later `prioritize` call; it defaults to the
   * URL, which is what callers want unless they are fetching the same URL
   * twice.
   */
  fetch(url, {priority = PRIORITY.NORMAL, key = String(url), ...options} = {}) {
    return new Promise((resolve, reject) => {
      const entry = {url, key, options, priority, started: false, resolve, reject};
      this.#byKey.set(key, entry);
      this.#queues[this.#clamp(priority)].push(entry);
      this.#schedulePump();
    });
  }

  /**
   * Starting is deferred to a microtask so that a burst of `fetch` calls is
   * fully queued before any of it runs.
   *
   * Deck queues the whole deck in one synchronous loop. Pumping inside `fetch`
   * would fill every slot from the first handful of cards the loop happened to
   * reach — and the card the reader is waiting for is usually not in the first
   * handful. A priority queue that starts work before it has seen the queue is
   * not a priority queue.
   */
  #schedulePump() {
    if (this.#pumpScheduled) return;
    this.#pumpScheduled = true;
    queueMicrotask(() => {
      this.#pumpScheduled = false;
      this.#pump();
    });
  }

  /**
   * Moves a queued request to a higher priority. A request that has already
   * started, finished, or was never queued is left alone; raising a priority
   * that is already at least as high is a no-op, so this is safe to call
   * repeatedly — every keystroke re-prioritises the whole result set.
   */
  prioritize(key, priority) {
    const entry = this.#byKey.get(key);
    if (!entry || entry.started || entry.priority <= priority) return false;
    entry.priority = priority;
    this.#queues[this.#clamp(priority)].push(entry);
    return true;
  }

  /** Raises a whole result set in one go. Returns how many actually moved. */
  prioritizeAll(keys, priority) {
    let moved = 0;
    for (const key of keys) {
      if (this.prioritize(key, priority)) moved++;
    }
    return moved;
  }

  #clamp(priority) {
    if (!(priority >= 0)) return 0;
    return priority >= LEVELS ? LEVELS - 1 : priority | 0;
  }

  #next() {
    for (let level = 0; level < LEVELS; level++) {
      const queue = this.#queues[level];
      while (queue.length > 0) {
        const entry = queue.shift();
        // A re-prioritised entry leaves a stale copy behind in the bucket it
        // came from; `priority` is what says where it really belongs now.
        if (entry.started || entry.priority !== level) continue;
        return entry;
      }
    }
    return null;
  }

  #pump() {
    while (this.#active < this.#concurrency) {
      const entry = this.#next();
      if (!entry) return;

      entry.started = true;
      this.#byKey.delete(entry.key);
      this.#active++;

      Promise.resolve()
        .then(() => this.#impl(entry.url, entry.options))
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.#active--;
          this.#pump();
        });
    }
  }
}
