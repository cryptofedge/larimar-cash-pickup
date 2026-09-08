'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Register the service worker.
 *
 * Its only jobs are installability (so the app can be wrapped in a Trusted Web
 * Activity for Google Play) and a graceful offline notice. It caches no personal
 * data by design — see the header comment in `public/sw.js`.
 *
 * Registration is skipped in development, where an installed worker serving a
 * stale shell is a persistent source of confusing behaviour.
 */
export function ServiceWorkerRegistrar() {
  const params = useSearchParams();
  const signedOut = params.get('signedout') === '1';

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // A failed registration costs installability, not function. The app
        // works identically without it, so there is nothing to surface.
      });
    };

    // Wait for load so registration never competes with the first paint.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  useEffect(() => {
    if (!signedOut || !('serviceWorker' in navigator)) return;

    // Belt and braces on a shared device. Nothing personal should be in the
    // cache, and after sign-out there is definitively nothing worth keeping.
    void navigator.serviceWorker.ready
      .then((registration) => registration.active?.postMessage('larimar:purge'))
      .catch(() => undefined);
  }, [signedOut]);

  return null;
}
