import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'next/index': 'src/next/index.ts',
    'react/index': 'src/react/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  external: ['next', 'next/server', 'next/headers', 'react', 'react-dom'],
});
