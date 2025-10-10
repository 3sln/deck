import {defineConfig} from 'vite';
import reelPlugin from '@3sln/reel/vite-plugin';

export default defineConfig({
  plugins: [reelPlugin()],
});
