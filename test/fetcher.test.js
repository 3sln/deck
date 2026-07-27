import {test, expect} from 'bun:test';
import {PriorityFetcher, PRIORITY} from '../src/fetcher.js';

/** A fetch stand-in that resolves only when the test says so. */
function controllable() {
  const started = [];
  const pending = [];
  const impl = url => {
    started.push(String(url));
    return new Promise(resolve => pending.push(resolve));
  };
  return {
    impl,
    started,
    releaseAll() {
      const waiting = pending.splice(0);
      waiting.forEach(resolve => resolve({ok: true}));
      return Promise.resolve();
    },
  };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('a burst is fully queued before any of it starts', async () => {
  const {impl, started} = controllable();
  const fetcher = new PriorityFetcher(2, {fetch: impl});

  // The high-priority request is queued last, exactly as a deep-linked card is
  // when it sits at the end of the glob.
  for (let i = 0; i < 10; i++) fetcher.fetch(`/n${i}`, {key: `n${i}`});
  fetcher.fetch('/urgent', {key: 'urgent', priority: PRIORITY.IMMEDIATE});

  await tick();
  expect(started[0]).toBe('/urgent');
});

test('priority order is respected across levels', async () => {
  const {impl, started, releaseAll} = controllable();
  const fetcher = new PriorityFetcher(1, {fetch: impl});

  fetcher.fetch('/a', {key: 'a', priority: PRIORITY.NORMAL});
  fetcher.fetch('/b', {key: 'b', priority: PRIORITY.SEARCH});
  fetcher.fetch('/c', {key: 'c', priority: PRIORITY.IMMEDIATE});
  fetcher.fetch('/d', {key: 'd', priority: PRIORITY.SEARCH});

  await tick();
  for (let i = 0; i < 4; i++) {
    await releaseAll();
    await tick();
  }
  expect(started).toEqual(['/c', '/b', '/d', '/a']);
});

test('queued requests can be re-prioritised after the fact', async () => {
  const {impl, started, releaseAll} = controllable();
  const fetcher = new PriorityFetcher(1, {fetch: impl});

  for (let i = 0; i < 6; i++) fetcher.fetch(`/n${i}`, {key: `n${i}`});
  await tick();
  expect(started).toEqual(['/n0']);

  // Everything except n0 is still queued; move three of them up.
  const moved = fetcher.prioritizeAll(['n5', 'n3', 'n1'], PRIORITY.SEARCH);
  expect(moved).toBe(3);

  for (let i = 0; i < 6; i++) {
    await releaseAll();
    await tick();
  }
  expect(started).toEqual(['/n0', '/n5', '/n3', '/n1', '/n2', '/n4']);
});

test('re-prioritising an in-flight or unknown request is a no-op', async () => {
  const {impl, releaseAll} = controllable();
  const fetcher = new PriorityFetcher(1, {fetch: impl});

  fetcher.fetch('/a', {key: 'a'});
  await tick();
  expect(fetcher.prioritize('a', PRIORITY.IMMEDIATE)).toBe(false);
  expect(fetcher.prioritize('never-queued', PRIORITY.IMMEDIATE)).toBe(false);
  await releaseAll();
});

test('lowering a priority is refused', async () => {
  const {impl, started, releaseAll} = controllable();
  const fetcher = new PriorityFetcher(1, {fetch: impl});

  fetcher.fetch('/blocker', {key: 'blocker'});
  fetcher.fetch('/urgent', {key: 'urgent', priority: PRIORITY.IMMEDIATE});
  fetcher.fetch('/last', {key: 'last'});
  await tick();
  // The urgent one overtook both, which is what leaves the other two queued.
  expect(started).toEqual(['/urgent']);

  expect(fetcher.prioritize('blocker', PRIORITY.NORMAL)).toBe(false);
  for (let i = 0; i < 3; i++) {
    await releaseAll();
    await tick();
  }
  expect(started).toEqual(['/urgent', '/blocker', '/last']);
});

test('concurrency is capped and refilled as requests settle', async () => {
  const {impl, started, releaseAll} = controllable();
  const fetcher = new PriorityFetcher(3, {fetch: impl});

  for (let i = 0; i < 9; i++) fetcher.fetch(`/n${i}`, {key: `n${i}`});
  await tick();
  expect(started.length).toBe(3);

  await releaseAll();
  await tick();
  expect(started.length).toBe(6);
});

test('a rejected request still frees its slot', async () => {
  const fetcher = new PriorityFetcher(1, {fetch: () => Promise.reject(new Error('nope'))});
  await expect(fetcher.fetch('/a', {key: 'a'})).rejects.toThrow('nope');
  await expect(fetcher.fetch('/b', {key: 'b'})).rejects.toThrow('nope');
});
