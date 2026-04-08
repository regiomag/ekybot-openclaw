/**
 * Platform detection utilities for iOS/Android specific content filtering
 */

/**
 * Detect if the app is running on iOS (native app via Capacitor)
 * Returns true for both iOS device and iOS simulator
 */
export const isIOSApp = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  // Check if running in Capacitor (native app)
  const isCapacitor = !!(window as any).Capacitor;
  
  // Check user agent for iOS
  const isIOSUserAgent = /iPhone|iPad|iPod|iOS/i.test(navigator.userAgent);
  
  // Check for specific iOS WebView indicators
  const isIOSWebView = !!(window as any).webkit?.messageHandlers;
  
  return isCapacitor && (isIOSUserAgent || isIOSWebView);
};

/**
 * Detect if the app is running on Android (native app via Capacitor)
 */
export const isAndroidApp = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  const isCapacitor = !!(window as any).Capacitor;
  const isAndroidUserAgent = /Android/i.test(navigator.userAgent);
  
  return isCapacitor && isAndroidUserAgent;
};

/**
 * Detect if running in web browser (not native app)
 */
export const isWebApp = (): boolean => {
  return !isIOSApp() && !isAndroidApp();
};

/**
 * Filter content to hide Android-specific references when on iOS
 */
export const filterPlatformContent = <T extends { platform?: string[] | string }>(
  items: T[]
): T[] => {
  if (!isIOSApp()) return items;
  
  return items.filter(item => {
    if (!item.platform) return true;
    
    const platforms = Array.isArray(item.platform) ? item.platform : [item.platform];
    return !platforms.includes('android');
  });
};

/**
 * Check if a string should be hidden on iOS (contains Android references)
 */
export const shouldHideOnIOS = (text: string): boolean => {
  if (!isIOSApp()) return false;
  
  const androidKeywords = [
    'android',
    'google play',
    'play store',
    'apk',
    '.apk'
  ];
  
  const lowerText = text.toLowerCase();
  return androidKeywords.some(keyword => lowerText.includes(keyword));
};

/**
 * Replace Android references with iOS-appropriate text when on iOS
 */
export const platformAwareText = (text: string): string => {
  if (!isIOSApp()) return text;
  
  return text
    .replace(/Android/gi, 'iOS')
    .replace(/Google Play/gi, 'App Store')
    .replace(/Play Store/gi, 'App Store')
    .replace(/\.apk/gi, '.ipa');
};