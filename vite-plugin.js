import fs from 'fs-extra';
import path from 'path';
import { sha256, loadDeckConfig, getProjectFiles, getCardFiles, getHtmlTemplate } from './src/config.js';

export default function deckPlugin() {
  let resolvedConfig;

  return {
    name: 'vite-plugin-deck',

    resolveId(id) {
      if (id.startsWith('/@deck-dev-esm/') || id.startsWith('/@deck-dev-src/')) {
        return id;
      }
      return null;
    },

    async handleHotUpdate({read, modules, server}) {
      const rawUrls = modules.map(m => m.url).filter(u => u.endsWith('?raw'));
      if (rawUrls.length === 0) {
        return;
      }

      server.ws.send({
        type: 'custom',
        event: 'deck-raw-update',
        data: {urls: rawUrls, text: await read()},
      });
    },

    load(id) {
      if (id.startsWith('/@deck-dev-esm/')) {
        const realPath = decodeURIComponent(id.slice('/@deck-dev-esm/'.length));
        return `
          import realDefault from '${realPath}';

          let lastArgs;
          let abortController = new AbortController();

          if (import.meta.hot?.data.lastArgs) {
            lastArgs = import.meta.hot.data.lastArgs;
          }

          export default (...args) => {
            lastArgs = args;
            const thisContext = { signal: abortController.signal };
            realDefault.call(thisContext, ...args);
          };

          if (import.meta.hot) {
            import.meta.hot.dispose(data => {
              data.lastArgs = lastArgs;
              abortController.abort();
            });

            import.meta.hot.accept(newModule => {
              if (newModule && newModule.default && lastArgs) {
                newModule.default(...lastArgs);
              }
            });
          }
        `;
      } 
      
      if (id.startsWith('/@deck-dev-src/')) {
        let realPath = decodeURIComponent(id.slice('/@deck-dev-src/'.length));
        if (realPath.endsWith('.js')) {
          realPath = realPath.slice(0, -3);
        }
        const rawPath = realPath + '?raw';
        return `
          import moduleText from '${rawPath}';

          const textObservers = import.meta.hot?.data.textObservers ?? [];
          export const moduleText$ = {
            subscribe: observer => {
              const observerObj = typeof observer === 'function' ? {next: observer} : observer;
              observerObj?.next(moduleText);
              textObservers.push(observerObj);

              return {
                unsubscribe: () => {
                  textObservers = textObservers.filter(x => x !== observerObj);
                }
              };
            }
          };

          if (import.meta.hot) {
            import.meta.hot.accept();
            import.meta.hot.dispose(data => {
              data.textObservers = textObservers;
            });

            import.meta.hot.on('deck-raw-update', ({urls, text}) => {
              if (!urls.includes('${rawPath}')) {
                return;
              }

              for (const observer of textObservers) {
                observer?.next(text);
              }
            });
          }
        `;
      }

      return null;
    },

    config(config, {command}) {
      return {optimizeDeps: {include: config.optimizeDeps?.include ?? []}};
    },

    configResolved(config) {
      resolvedConfig = config;
    },

    async configureServer(server) {
      const config = await loadDeckConfig(resolvedConfig.root);
      const devConfig = config.dev;

      server.watcher.on('all', (eventName, eventPath) => {
        const projPath = path.relative(resolvedConfig.root, eventPath);
        const webPath = '/' + projPath.replace(/\\/g, '/');
        const files = getCardFiles(resolvedConfig.root, devConfig).map(p => `/${p}`);
        if (!files.includes(webPath)) return;

        switch (eventName) {
          case 'add':
          case 'change':
            server.ws.send({type: 'custom', event: 'deck:card-changed', data: {path: webPath}});
            break;
          case 'unlink':
            server.ws.send({type: 'custom', event: 'deck:card-removed', data: {path: webPath}});
            break;
        }
      });

      server.middlewares.use(async (req, res, next) => {
        if (new URL(req.url, "https://localhost").pathname === '/') {
          const cardPaths = getCardFiles(resolvedConfig.root, devConfig).map(p => `/${p}`);
          const initialCardsData = await Promise.all(cardPaths.map(async (p) => {
            const content = await fs.readFile(path.join(resolvedConfig.root, p), 'utf-8');
            const hash = await sha256(content);
            return { path: p, hash };
          }));

          const template = getHtmlTemplate({
            title: devConfig.title,
            importMap: devConfig.importMap,
            initialCardsData,
            pinnedCardPaths: devConfig.pinned,
            entryFile: '@3sln/deck'
          });
          const html = await server.transformIndexHtml(req.url, template);
          res.end(html);
          return;
        }
        next();
      });
    },
  };
}
