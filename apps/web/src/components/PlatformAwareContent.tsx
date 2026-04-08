'use client';

import { ReactNode, useMemo } from 'react';
import { isIOSApp, shouldHideOnIOS, platformAwareText } from '@/utils/platform';

interface PlatformAwareContentProps {
  children: ReactNode;
  hideOnIOS?: boolean;
  replaceAndroidText?: boolean;
}

/**
 * Component that conditionally renders content based on platform
 * Automatically hides Android-specific content when running on iOS
 */
export const PlatformAwareContent: React.FC<PlatformAwareContentProps> = ({
  children,
  hideOnIOS = false,
  replaceAndroidText = false
}) => {
  const shouldHide = useMemo(() => {
    if (!hideOnIOS) return false;
    return isIOSApp();
  }, [hideOnIOS]);

  if (shouldHide) return null;

  // If replaceAndroidText is enabled and we have a string child, replace Android references
  if (replaceAndroidText && typeof children === 'string') {
    const processedText = platformAwareText(children);
    return <>{processedText}</>;
  }

  return <>{children}</>;
};

interface PlatformButtonProps {
  platform: 'ios' | 'android' | 'web';
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

/**
 * Platform-specific button that automatically hides on incompatible platforms
 */
export const PlatformButton: React.FC<PlatformButtonProps> = ({
  platform,
  children,
  className = '',
  onClick
}) => {
  const shouldShow = useMemo(() => {
    // Hide Android button when on iOS
    if (platform === 'android' && isIOSApp()) return false;
    
    // Show all other combinations
    return true;
  }, [platform]);

  if (!shouldShow) return null;

  return (
    <button className={className} onClick={onClick}>
      {children}
    </button>
  );
};

/**
 * Text component that automatically replaces Android references on iOS
 */
export const PlatformText: React.FC<{ children: string; className?: string }> = ({
  children,
  className
}) => {
  const processedText = useMemo(() => platformAwareText(children), [children]);
  
  return <span className={className}>{processedText}</span>;
};

/**
 * Hook to get platform-aware text
 */
export const usePlatformText = (text: string): string => {
  return useMemo(() => platformAwareText(text), [text]);
};