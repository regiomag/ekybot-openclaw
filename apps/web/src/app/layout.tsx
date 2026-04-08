import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { PWAInitializer } from '@/components/PWAInitializer';
import { UpdateNotification } from '@/components/UpdateNotification';
import { LogCollectorInit } from '@/components/LogCollectorInit';
import { Providers } from '@/components/Providers';
import { IOSContentFilter } from '@/components/IOSContentFilter';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ekybot - AI Assistant Platform',
  description: 'Ton conseiller personnel IA - L\'IA personnelle, enfin compréhensible, contrôlable et responsable.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Ekybot',
  },
};

export const viewport: Viewport = {
  themeColor: '#1f2937',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="fr">
        <head>
          <link rel="icon" href="/icon.svg" type="image/svg+xml" />
          <link rel="icon" href="/favicon.ico" sizes="32x32" />
          <link rel="apple-touch-icon" href="/icon-192.png" />
        </head>
        <body className="bg-gray-900 text-white">
          <Providers>
            <IOSContentFilter>
              <LogCollectorInit />
              <PWAInitializer />
              <UpdateNotification />
              {children}
            </IOSContentFilter>
          </Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
