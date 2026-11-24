import {marked} from 'marked';
import {stripFrontMatter} from './frontmatter.js';

export function parseCardContent({content, format}) {
  const template = document.createElement('template');
  template.innerHTML = format === 'html' ? content : marked.parse(stripFrontMatter(content));
  template.content
    .querySelectorAll('base, title, meta[http-equiv], script')
    .forEach(node => node.remove());
  return template.content;
}

function resolveUrl(value, card, deckBase, keepFragment = false) {
  if (!value || (keepFragment && value.startsWith('#'))) return value;
  try {
    return value.startsWith('/') && !value.startsWith('//')
      ? new URL('.' + value, deckBase).href
      : new URL(value, card.url).href;
  } catch {
    return value;
  }
}

function resolveSrcset(input, resolve) {
  const candidates = [];
  let rest = input.trim();

  while (rest) {
    const [url] = rest.match(/^\S+/);
    rest = rest.slice(url.length).trimStart();
    if (url.endsWith(',')) {
      candidates.push(resolve(url.replace(/,+$/, '')));
      continue;
    }
    const comma = rest.indexOf(',');
    const descriptor = (comma < 0 ? rest : rest.slice(0, comma)).trim();
    candidates.push([resolve(url), descriptor].filter(Boolean).join(' '));
    rest = comma < 0 ? '' : rest.slice(comma + 1).trimStart();
  }

  return candidates.join(', ');
}

export function prepareCardContent(card, deckBase, devBase) {
  const content = parseCardContent(card);
  content.querySelector('h1')?.remove();

  const attributes = ['src', 'href', 'poster', 'canonical-src', 'action', 'data'];
  for (const element of content.querySelectorAll(
    '[src], [href], [poster], deck-demo, form[action], object[data], [srcset]',
  )) {
    for (const attribute of attributes) {
      if (!element.hasAttribute(attribute)) continue;
      if (attribute === 'data' && !element.matches('object')) continue;
      const value = element.getAttribute(attribute);
      element.setAttribute(attribute, resolveUrl(value, card, deckBase, attribute === 'href'));
    }
    if (element.hasAttribute('srcset')) {
      const srcset = resolveSrcset(element.getAttribute('srcset'), value =>
        resolveUrl(value, card, deckBase),
      );
      element.setAttribute('srcset', srcset);
    }
  }
  for (const demo of content.querySelectorAll('deck-demo')) {
    demo.dataset.deckDevBase = devBase ?? '';
  }

  return content;
}
