import type { Metadata, Viewport } from 'next';
import { AppWrapper } from './components/AppWrapper';
import { CalendlyBadge } from './components/CalendlyBadge';
import { getNativeBootstrapScript } from '@/lib/native-runtime';
import './globals.css';

// Force dynamic rendering to avoid Clerk prerender issues
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: {
    default: 'EkyBot — Votre équipe d\'IA sur votre machine | Gratuit',
    template: '%s | EkyBot',
  },
  description: 'Structurez et pilotez vos agents IA en équipe, gérez vos projets et vos coûts — comme une startup, sur votre machine.',
  keywords: ['agent IA', 'multi-agent', 'self-hosted', 'OpenClaw', 'intelligence artificielle', 'productivité', 'privacy', 'RGPD', 'équipe IA'],
  authors: [{ name: 'Ekybot', url: 'https://ekybot.com' }],
  creator: 'Ekybot',
  publisher: 'Ekybot',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    type: 'website',
    locale: 'fr_FR',
    alternateLocale: ['en_US', 'de_DE'],
    url: 'https://ekybot.com',
    siteName: 'Ekybot',
    title: 'EkyBot — Votre équipe d\'IA sur votre machine',
    description: 'Structurez et pilotez vos agents IA en équipe, gérez vos projets et vos coûts — comme une startup, sur votre machine.',
    images: [
      {
        url: 'https://ekybot.com/api/og',
        width: 1200,
        height: 630,
        alt: 'EkyBot — Votre équipe d\'IA sur votre machine',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'EkyBot — Votre équipe d\'IA sur votre machine',
    description: 'Structurez et pilotez vos agents IA en équipe, gérez vos projets et vos coûts — comme une startup, sur votre machine.',
    images: ['https://ekybot.com/api/og'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Ekybot',
  },
  category: 'productivity',
  metadataBase: new URL('https://ekybot.com'),
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover', // Support iPhone notch/safe areas
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="canonical" href="https://ekybot.com" />
        <script
          id="ekybot-native-bootstrap"
          dangerouslySetInnerHTML={{ __html: getNativeBootstrapScript() }}
        />
        {/* JSON-LD Structured Data for SEO */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebApplication',
              name: 'Ekybot',
              alternateName: 'Ekybot AI Assistant',
              description: 'Ton assistant IA personnel, sous ton contrôle total. Connecte ton agent OpenClaw et discute depuis n\'importe où.',
              url: 'https://ekybot.com',
              applicationCategory: 'Productivity',
              operatingSystem: 'Web, iOS',
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'EUR',
                description: 'Gratuit - Utilise ton propre agent OpenClaw',
              },
              aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: '4.8',
                ratingCount: '50',
              },
              author: {
                '@type': 'Organization',
                name: 'Ekybot',
                url: 'https://ekybot.com',
              },
            }),
          }}
        />
      </head>
      <body className="bg-gray-900">
        <AppWrapper>
          {children}
          <CalendlyBadge />
        </AppWrapper>
      </body>
    </html>
  );
}
