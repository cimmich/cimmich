import staticAdapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

process.env.PUBLIC_IMMICH_BUY_HOST = process.env.PUBLIC_IMMICH_BUY_HOST || 'https://buy.immich.app';
process.env.PUBLIC_IMMICH_PAY_HOST = process.env.PUBLIC_IMMICH_PAY_HOST || 'https://pay.futo.org';

const adapter =
  process.env.CIMMICH_NODE_RUNTIME === 'true'
    ? (await import('@sveltejs/adapter-node')).default({ out: 'build' })
    : staticAdapter({
        fallback: 'index.html',
        precompress: true,
      });

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: {
    // TODO pending `@immich/ui` to enable it
    // runes: true,
  },
  preprocess: vitePreprocess(),
  kit: {
    version: {
      name: process.env.IMMICH_BUILD || process.env.npm_package_version || 'local',
    },
    paths: {
      relative: false,
    },
    adapter,
    alias: {
      $lib: 'src/lib',
      '$lib/*': 'src/lib/*',
      $tests: 'src/../tests',
      '$tests/*': 'src/../tests/*',
      '@test-data': 'src/test-data',
      $i18n: '../i18n',
      'chromecast-caf-sender': './node_modules/@types/chromecast-caf-sender/index.d.ts',
    },
  },
  onwarn: (warning, handler) => {
    if (warning.code === 'state_referenced_locally') {
      return;
    }
    handler(warning);
  },
};

export default config;
