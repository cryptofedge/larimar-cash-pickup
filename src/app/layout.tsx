import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getTranslations } from '@/i18n';

export const metadata: Metadata = {
  title: {
    default: 'Larimar — Get Dominican Pesos Without Using Your Card at an ATM',
    template: '%s · Larimar',
  },
  description:
    'Pay securely with your foreign card, receive a pickup code, and collect Dominican pesos at an authorized location. A technical demonstration — not a licensed financial institution.',
  applicationName: 'Larimar',
  robots: {
    // A demo financial product that looks real has no business in search results.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0A1F33',
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
      </body>
    </html>
  );
}
