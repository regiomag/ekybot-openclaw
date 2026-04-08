'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Floating Calendly badge widget — only shows on public pages (/, /openclaw-install)
 */
export function CalendlyBadge() {
  const pathname = usePathname();
  const isPublicPage = pathname === '/' || pathname === '/openclaw-install';

  useEffect(() => {
    if (!isPublicPage) return;

    // Load CSS
    const link = document.createElement('link');
    link.href = 'https://assets.calendly.com/assets/external/widget.css';
    link.rel = 'stylesheet';
    document.head.appendChild(link);

    // Load JS
    const script = document.createElement('script');
    script.src = 'https://assets.calendly.com/assets/external/widget.js';
    script.async = true;
    script.onload = () => {
      (window as any).Calendly?.initBadgeWidget({
        url: 'https://calendly.com/michael-13arty/30-minute-meeting-clone-1',
        text: 'Prendre un RDV 📅',
        color: '#0069ff',
        textColor: '#ffffff',
        branding: false,
      });
    };
    document.body.appendChild(script);

    return () => {
      // Cleanup on unmount
      link.remove();
      script.remove();
      document.querySelector('.calendly-badge-widget')?.remove();
    };
  }, [isPublicPage]);

  if (!isPublicPage) return null;
  return (
    <style jsx global>{`
      @media (max-width: 640px) {
        .calendly-badge-widget {
          bottom: 80px !important;
        }
      }
    `}</style>
  );
}
