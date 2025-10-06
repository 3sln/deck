import { marked } from 'marked';
import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';

export default function reelPlugin(options = {}) {
  const { entry, importMap = { imports: {}, scopes: {} } } = options;
  let server;

  function getCards() {
    const files = globSync('**/*.{md,html}', { ignore: 'node_modules/**' });
    return files.map(file => {
      const content = fs.readFileSync(file, 'utf-8');
      const html = file.endsWith('.md') ? marked(content) : content;
      return { path: file, html };
    });
  }

  return {
    name: 'vite-plugin-reel',

    configureServer(viteServer) {
      server = viteServer;

      server.watcher.on('all', (eventName, file) => {
        if (file.endsWith('.md') || file.endsWith('.html')) {
          console.log(`File changed: ${file}, re-calculating cards...`);
          server.ws.send({
            type: 'custom',
            event: 'reel:cards-update',
            data: { cards: getCards() }
          });
        }
      });

      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/') {
          const initialCards = getCards();
          const htmlTemplate = `
            <!doctype html>
            <html lang="en">
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>Reel</title>
                <script type="importmap">
                  ${JSON.stringify(importMap)}
                </script>
                <script>
                  window.__INITIAL_CARDS__ = ${JSON.stringify(initialCards)};
                </script>
              </head>
              <body style="margin: 0; padding: 0;">
                <div id="root"></div>
                <script type="module">
                  import { renderReel } from '@3sln/reel';
                  renderReel({
                    target: document.getElementById('root'),
                    initialCards: window.__INITIAL_CARDS__
                  });
                </script>
              </body>
            </html>
          `;

          const transformedHtml = await server.transformIndexHtml(req.url, htmlTemplate);
          res.end(transformedHtml);
          return;
        }
        next();
      });
    }
  };
}
