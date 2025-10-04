import { defineConfig } from 'vite';
import { marked } from 'marked';
import fs from 'fs';

function externalPlugin() {
    return {
        name: 'vite-plugin-external',
        resolveId(source) {
            if (source.startsWith('@3sln/')) {
                return { id: source, external: true };
            }
            return null;
        }
    };
}

function markdownPlugin() {
  return {
    name: 'vite-plugin-markdown-transform',
    transform(src, id) {
      if (id.endsWith('.md')) {
        const html = marked(src);
        return {
          code: `export default ${JSON.stringify(html)};`,
          map: null
        };
      }
    },
    handleHotUpdate(ctx) {
      if (ctx.file.endsWith('.md')) {
        const content = fs.readFileSync(ctx.file, 'utf-8');
        const html = marked(content);
        ctx.server.ws.send({
          type: 'custom',
          event: 'markdown-update',
          data: { file: ctx.file, html }
        });
        return [];
      }
    }
  };
}

export default defineConfig({
  plugins: [externalPlugin(), markdownPlugin()],
});
