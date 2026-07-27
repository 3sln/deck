import {test, expect} from 'bun:test';
import {demoTagsIn, attributesOf, withAttribute} from '../src/demo-tags.js';

test('attributes are read by name, not by pattern', () => {
  // `canonical-src` ends in `src="`. A greedy match for `src="([^"]+)"` picks
  // it up instead of the real src, and the build then treats a demo's
  // ClojureScript source as the module to bundle.
  const attributes = attributesOf('id="cljs" src="/demos/c.js" canonical-src="/demos/c.cljs"');
  expect(attributes.src).toBe('/demos/c.js');
  expect(attributes['canonical-src']).toBe('/demos/c.cljs');
  expect(attributes.id).toBe('cljs');
});

test('attribute order does not matter', () => {
  const attributes = attributesOf('canonical-src="/demos/d.cljs" id="x" src="/demos/d.js"');
  expect(attributes.src).toBe('/demos/d.js');
  expect(attributes['canonical-src']).toBe('/demos/d.cljs');
});

test('tags in a fenced code block are examples, not embeds', () => {
  const card = [
    '# Using it',
    '',
    '<deck-demo id="real" src="/demos/a.js"></deck-demo>',
    '',
    '```markdown',
    '<deck-demo id="example" src="/demos/my-awesome-demo.js"></deck-demo>',
    '```',
    '',
    '~~~html',
    '<deck-demo id="tilde" src="/demos/also-not-real.js"></deck-demo>',
    '~~~',
  ].join('\n');

  const found = demoTagsIn(card);
  expect(found).toHaveLength(1);
  expect(found[0].attributes.id).toBe('real');
});

test('a tag reports where it is, so it can be replaced in place', () => {
  const card = 'before\n<deck-demo id="a" src="/demos/a.js"></deck-demo>\nafter';
  const [found] = demoTagsIn(card);
  expect(card.slice(found.index, found.index + found.tag.length)).toBe(found.tag);
});

test('rewriting src leaves canonical-src alone, whichever order they are in', () => {
  const after = withAttribute(
    '<deck-demo id="x" src="/demos/c.js" canonical-src="/demos/c.cljs"></deck-demo>',
    'src',
    '/assets/demos/c.js',
  );
  expect(after).toBe(
    '<deck-demo id="x" src="/assets/demos/c.js" canonical-src="/demos/c.cljs"></deck-demo>',
  );

  const before = withAttribute(
    '<deck-demo canonical-src="/demos/d.cljs" id="x" src="/demos/d.js"></deck-demo>',
    'src',
    '/assets/demos/d.js',
  );
  expect(before).toBe(
    '<deck-demo canonical-src="/demos/d.cljs" id="x" src="/assets/demos/d.js"></deck-demo>',
  );
});

test('an attribute that is not there yet is appended', () => {
  expect(
    withAttribute(
      '<deck-demo id="a" src="/demos/a.js"></deck-demo>',
      'canonical-src',
      '/demos/a.js',
    ),
  ).toBe('<deck-demo id="a" src="/demos/a.js" canonical-src="/demos/a.js"></deck-demo>');
});

test('several demos on one card are all found', () => {
  const card = [
    '<deck-demo id="one" src="/demos/one.js"></deck-demo>',
    'prose in between',
    '<deck-demo id="two" src="/demos/two.js" canonical-src="/demos/two.cljs"></deck-demo>',
  ].join('\n\n');
  expect(demoTagsIn(card).map(t => t.attributes.id)).toEqual(['one', 'two']);
});
