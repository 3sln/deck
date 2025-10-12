import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import xml from 'highlight.js/lib/languages/xml';
import clojure from 'highlight.js/lib/languages/clojure';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import githubStyle from 'highlight.js/styles/github.css?inline';
import githubDarkStyle from 'highlight.js/styles/github-dark.css?inline';
import {css as createSheet} from '@3sln/bones/style';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('xml', xml); // For HTML
hljs.registerLanguage('css', css);
hljs.registerLanguage('clojure', clojure);
hljs.registerLanguage('json', json);

export const stylesheet = createSheet`
  /* Light Theme */
  ${githubStyle}

  /* Dark Theme */
  @media (prefers-color-scheme: dark) {
    ${githubDarkStyle}
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

export function highlight(element) {
  // Case 1: The element itself is a <code> block that needs highlighting.
  if (element.matches('pre > code')) {
    hljs.highlightElement(element);
  }

  // Case 2: The element is a container for <pre><code> blocks.
  const blocks = element.querySelectorAll('pre > code');
  blocks.forEach(block => {
    hljs.highlightElement(block);
  });
}
