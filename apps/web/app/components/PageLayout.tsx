'use client';

import { AppLayout } from '@/components/AppLayout';

interface PageLayoutProps {
  children: React.ReactNode;
  showNavbar?: boolean;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '6xl' | '7xl' | 'full';
  padding?: boolean;
}

export default function PageLayout({ 
  children, 
  showNavbar = true,
  maxWidth = '4xl',
  padding = true 
}: PageLayoutProps) {
  const maxWidthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '4xl': 'max-w-4xl',
    '6xl': 'max-w-6xl',
    '7xl': 'max-w-7xl',
    full: 'max-w-full',
  };
  
  return (
    <AppLayout showNav={showNavbar}>
      <div className={`mx-auto ${maxWidthClasses[maxWidth]} ${padding ? 'px-4 py-8' : ''}`}>
        {children}
      </div>
    </AppLayout>
  );
}
