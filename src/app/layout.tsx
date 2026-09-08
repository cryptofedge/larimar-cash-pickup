import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getTranslations } from '@/i18n';
import { ServiceWorkerRegistrar } from '@/components/layout/ServiceWorkerRegistrar';

export const metadata: Metadata = {
  title: {
    default: 'Larimar — Get Dominican Pesos Without Using Your Card at an ATM',
    template: '%s · Larimar',
  },
  description:
    'Pay securely with your foreign card, receive a pickup code, and collect Dominican pesos at an authorized location. A technical demonstration — not a licensed financial institution.',
  applicationName: 'Larimar',
  manifest: '/manifest.webmanifest',

  icons: {
    icon: [
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-180.png', sizes: '180x180', type: 'image/png' }],
  },

  // Installed-app presentation on iOS, which ignores the web app manifest.
  appleWebApp: {
    capable: true,
    title: 'Larimar',
    statusBarStyle: 'black-translucent',
  },

  // Telephone auto-linking mangles reference codes like LRM-7F3K2Q8M on iOS.
  formatDetection: { telephone: false },

  robots: {
    // A demo financial product that looks real has no business in search results.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The pickup code screen is read aloud at a counter; pinch-zoom must work.
  maximumScale: 5,
  userScalable: true,
  themeColor: '#0A1F33',
  // Keep content clear of a notch when running as an installed app.
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getTranslations();

  return (
    <html lang={locale}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-navy-900 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        {children}
        <Suspense fallback={null}>
          <ServiceWorkerRegistrar />
        </Suspense>
      </body>
    </html>
  );
}
