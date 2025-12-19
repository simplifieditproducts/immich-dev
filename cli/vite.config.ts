import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  resolve: { alias: { src: '/src' } },
  build: {
    rollupOptions: {
      input: 'src/index.ts',
      output: {
        dir: 'dist',
      },
    },
    ssr: true,
  },
  ssr: {
    // bundle everything except for Node built-ins and native modules
    noExternal: /^(?!node:).*$/,
    external: ['@node-rs/xxhash'],
  },
  plugins: [tsconfigPaths()],
});
