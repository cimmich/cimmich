/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { handleCancel } from './request';

const sw = globalThis as unknown as ServiceWorkerGlobalScope;

export const installMessageListener = () => {
  sw.addEventListener('message', (event) => {
    if (event.origin !== sw.location.origin || !event.data?.type) {
      return;
    }

    const client = event.source;
    if (!client || !('url' in client) || new URL(client.url).origin !== sw.location.origin) {
      return;
    }

    switch (event.data.type) {
      case 'cancel': {
        const url = event.data.url ? new URL(event.data.url, sw.location.origin) : undefined;
        if (!url || url.origin !== sw.location.origin) {
          return;
        }

        handleCancel(url);
        break;
      }
    }
  });
};
