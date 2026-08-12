import { enhancedImages } from '@sveltejs/enhanced-img';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, loadEnv, type ProxyOptions, type UserConfig } from 'vite';
import path from 'node:path';

const criticalCimmichCoverageThresholds = {
  'src/lib/components/cimmich/bulk-photo-sorter.ts': { branches: 80, functions: 90, lines: 80, statements: 80 },
  'src/lib/components/cimmich/cimmich-undo-receipt-context.svelte.ts': {
    branches: 80,
    functions: 100,
    lines: 95,
    statements: 95,
  },
  'src/lib/components/cimmich/entity-media-actions.ts': {
    branches: 85,
    functions: 90,
    lines: 90,
    statements: 90,
  },
  'src/lib/components/cimmich/observation-box-geometry.ts': {
    branches: 95,
    functions: 100,
    lines: 95,
    statements: 95,
  },
  'src/lib/components/cimmich/persisted-undo-receipt.ts': {
    branches: 95,
    functions: 100,
    lines: 90,
    statements: 90,
  },
  'src/lib/components/cimmich/person-workspace-cache.ts': {
    branches: 75,
    functions: 100,
    lines: 90,
    statements: 90,
  },
  'src/lib/components/cimmich/photo-viewer-presentation.ts': {
    branches: 80,
    functions: 90,
    lines: 95,
    statements: 95,
  },
  'src/lib/managers/cimmich-visibility-intent.ts': { branches: 80, functions: 100, lines: 80, statements: 80 },
  'src/lib/managers/cimmich-visibility-manager.svelte.ts': {
    branches: 100,
    functions: 100,
    lines: 100,
    statements: 100,
  },
};

export default defineConfig(({ mode }) => {
  const localEnv = loadEnv(mode, process.cwd(), '');
  const upstream = {
    target: process.env.IMMICH_SERVER_URL || localEnv.IMMICH_SERVER_URL || 'http://immich-server:2283/',
    secure: true,
    changeOrigin: true,
    logLevel: 'info',
    ws: true,
  };
  const proxy: Record<string, string | ProxyOptions> = {
    '/api': upstream,
    '/.well-known/immich': upstream,
    '/custom.css': upstream,
  };

  return {
    build: {
      target: 'es2022',
    },
    resolve: {
      alias: {
        'xmlhttprequest-ssl': './node_modules/engine.io-client/lib/xmlhttprequest.js',
        // eslint-disable-next-line unicorn/prefer-module
        '@test-data': path.resolve(__dirname, './src/test-data'),
        // '@immich/ui': path.resolve(__dirname, '../../ui/packages/ui'),
      },
    },
    server: {
      // connect to a remote backend during web-only development
      proxy,
      allowedHosts: true,
      watch: {
        ignored: ['**/static/cimmich-data/**'],
      },
    },
    preview: {
      proxy,
    },
    plugins: [
      enhancedImages(),
      tailwindcss(),
      sveltekit(),
      process.env.BUILD_STATS === 'true'
        ? visualizer({
            emitFile: true,
            filename: 'stats.html',
          })
        : undefined,
      svelteTesting(),
    ],
    optimizeDeps: {
      entries: ['src/**/*.{svelte,ts,html}'],
    },
    test: {
      name: 'web:unit',
      include: ['src/**/*.{test,spec}.{js,ts}'],
      globals: true,
      environment: 'happy-dom',
      setupFiles: ['./src/test-data/setup.ts'],
      sequence: {
        hooks: 'list',
      },
      coverage: {
        provider: 'v8',
        include: [
          'src/lib/components/cimmich/**/*.{ts,svelte.ts}',
          'src/lib/managers/cimmich*.{ts,svelte.ts}',
          'src/lib/services/cimmich*.ts',
        ],
        reporter: ['text-summary', 'json-summary'],
        thresholds: {
          branches: 45,
          functions: 55,
          lines: 60,
          statements: 60,
          ...criticalCimmichCoverageThresholds,
        },
      },
      env: {
        TZ: 'UTC',
      },
    },
  } as UserConfig;
});
