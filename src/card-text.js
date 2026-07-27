/**
 * Reading a card's title, summary and plain text on the *server*.
 *
 * The browser does this with `DOMParser` (see `transformCard` in `state.js`);
 * the build cannot, so this arrives at the same three answers from marked's
 * token stream instead. They have to agree — the precompiled index is built
 * here and searched against titles the browser derived there — so the rules are
 * stated once, in both places, in the same words:
 *
 *   - the title is the first level-one heading, falling back to the file name;
 *   - the summary is the first paragraph;
 *   - the text is everything, with the markup taken out.
 *
 * Inline tokens are concatenated and blocks are separated, because that is what
 * `textContent` does. Joining everything with spaces instead is close enough to
 * look right and wrong where it counts: it turns a heading like
 * ``The `<deck-demo>` Element`` into `The  <deck-demo>  Element`, and a title
 * the build agrees with the browser about becomes a title it does not.
 */

import path from 'node:path';
import {marked} from 'marked';

const stripTags = html =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Inline content, concatenated exactly as the DOM would concatenate it. */
function inlineText(tokens) {
  let out = '';
  for (const token of tokens ?? []) {
    if (token.type === 'html') {
      out += stripTags(token.raw ?? token.text ?? '');
    } else if (token.tokens?.length) {
      out += inlineText(token.tokens);
    } else if (typeof token.text === 'string') {
      out += token.text;
    }
  }
  return out;
}

/** Block content, one entry per block. */
function blockText(tokens, out = []) {
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'space':
        break;
      case 'code':
        out.push(token.text ?? '');
        break;
      case 'html':
        out.push(stripTags(token.raw ?? token.text ?? ''));
        break;
      case 'list':
        for (const item of token.items ?? []) blockText(item.tokens, out);
        break;
      case 'blockquote':
        blockText(token.tokens, out);
        break;
      case 'table':
        for (const cell of token.header ?? []) out.push(inlineText(cell.tokens));
        for (const row of token.rows ?? []) {
          for (const cell of row) out.push(inlineText(cell.tokens));
        }
        break;
      default:
        out.push(token.tokens?.length ? inlineText(token.tokens) : (token.text ?? ''));
    }
  }
  return out;
}

function fromHtml(file, source) {
  const heading = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const paragraph = source.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  return {
    title: heading ? stripTags(heading[1]) : path.basename(file, path.extname(file)),
    summary: paragraph ? stripTags(paragraph[1]) : '',
    text: stripTags(source),
  };
}

export function extractCard(file, source) {
  if (file.endsWith('.html')) return fromHtml(file, source);

  const tokens = marked.lexer(source);
  const heading = tokens.find(token => token.type === 'heading' && token.depth === 1);
  const paragraph = tokens.find(token => token.type === 'paragraph');

  return {
    title: heading ? inlineText(heading.tokens).trim() : path.basename(file, path.extname(file)),
    summary: paragraph ? inlineText(paragraph.tokens).trim() : '',
    text: blockText(tokens)
      .join('\n')
      .replace(/[ \t]+/g, ' ')
      .trim(),
  };
}
