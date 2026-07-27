import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import xml from 'highlight.js/lib/languages/xml';
import clojure from 'highlight.js/lib/languages/clojure';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';
import {css as createSheet} from '@3sln/dodo/style';
import {githubLight, githubDark} from './highlight-theme.js';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('xml', xml); // For HTML
hljs.registerLanguage('css', css);
hljs.registerLanguage('clojure', clojure);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('markdown', markdown);

export const stylesheet = createSheet`
  /* Light Theme */
  ${githubLight}

  /* Dark Theme */
  @media (prefers-color-scheme: dark) {
    ${githubDark}
  }

  .hljs {
    background: transparent;
  }

  pre {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 1em;
    overflow-x: auto;
  }
`;

function highlightBlock(block) {
  // hljs refuses to re-highlight an element it has already marked, and warns
  // about it. Card bodies are re-rendered in place, so clearing the mark is the
  // difference between highlighted code and a console full of warnings.
  delete block.dataset.highlighted;
  hljs.highlightElement(block);
}

export function highlight(element) {
  // Case 1: The element itself is a <code> block that needs highlighting.
  if (element.matches?.('pre > code')) {
    highlightBlock(element);
  }

  // Case 2: The element is a container for <pre><code> blocks.
  element.querySelectorAll('pre > code').forEach(highlightBlock);
}
