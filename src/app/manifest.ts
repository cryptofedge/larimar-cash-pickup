import type { MetadataRoute } from 'next';

/**
 * Web app manifest.
 *
 * Served at `/manifest.webmanifest`. This is what makes the app installable, and
 * what a Trusted Web Activity wraps when packaging for Google Play — see
 * docs/MOBILE_AND_PLAY_STORE.md.
 *
 * `display: 'standalone'` rather than `fullscreen`: the traveler is standing at a
 * bank counter reading a code aloud, and hiding the status bar takes away the
 * clock and battery indicator for no benefit.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Larimar — Dominican Peso Cash Pickup (Demo)',
    short_name: 'Larimar',
    description:
      'Pay securely with your foreign card, receive a pickup code, and collect Dominican pesos at an authorized location. A technical demonstration — not a licensed financial institution.',

    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',

    background_color: '#0A1F33',
    theme_color: '#0A1F33',

    lang: 'en',
    dir: 'ltr',
    categories: ['finance', 'travel', 'utilities'],

    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-256.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops maskable icons to the launcher's shape, so the artwork is
      // inset into the safe zone in these two.
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],

    shortcuts: [
      {
        name: 'New cash pickup',
        short_name: 'New pickup',
        description: 'Request Dominican pesos',
        url: '/new',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Find a pickup location',
        short_name: 'Locations',
        description: 'Authorized collection points',
        url: '/locations',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}
