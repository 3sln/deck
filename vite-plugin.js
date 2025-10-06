import { marked } from 'marked';
import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';

export default function reelPlugin(options = {}) {
  const { entry, importMap = { imports: {}, scopes: {} } } = options;
  let server;

  function getCardPaths() {
    return globSync('**/*.{md,html}', { ignore: 'node_modules/**' });
  }

  return {
    name: 'vite-plugin-reel',

    configureServer(viteServer) {
      server = viteServer;

      server.watcher.on('all', (eventName, eventPath) => {
        if (!eventPath.endsWith('.md') && !eventPath.endsWith('.html')) return;

        const root = server.config.root;
        const webPath = path.relative(root, eventPath).replace(/\\/g, '/');

        switch (eventName) {
            case 'add':
            case 'change':
                console.log(`Card changed: ${webPath}`);
                server.ws.send({
                    type: 'custom',
                    event: 'reel:card-changed',
                    data: { path: webPath }
                });
                break;
            case 'unlink':
                console.log(`Card removed: ${webPath}`);
                server.ws.send({
                    type: 'custom',
                    event: 'reel:card-removed',
                    data: { path: webPath }
                });
                break;
        }
      });

      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/') {
          const initialCardPaths = getCardPaths();
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
                  window.__INITIAL_CARD_PATHS__ = ${JSON.stringify(initialCardPaths)};
                </script>
              </head>
              <body style="margin: 0; padding: 0;">
                <div id="root"></div>
                <script type="module">
                  import { renderReel } from '@3sln/reel';
                  renderReel({
                    target: document.getElementById('root'),
                    initialCardPaths: window.__INITIAL_CARD_PATHS__
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
