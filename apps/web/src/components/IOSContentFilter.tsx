'use client';

import { ReactNode, useEffect } from 'react';
import { isIOSApp } from '@/utils/platform';

interface IOSContentFilterProps {
  children: ReactNode;
}

/**
 * Global iOS content filter that removes Android references from the DOM
 * Applied at the root level to catch any missed Android content
 */
export const IOSContentFilter: React.FC<IOSContentFilterProps> = ({ children }) => {
  useEffect(() => {
    if (!isIOSApp()) return;

    // Function to recursively scan and filter text content
    const filterTextNodes = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const textContent = node.textContent || '';
        
        // Check if text contains Android references
        const androidKeywords = ['Android', 'Google Play', 'Play Store'];
        let hasAndroid = false;
        
        for (const keyword of androidKeywords) {
          if (textContent.includes(keyword)) {
            hasAndroid = true;
            break;
          }
        }
        
        if (hasAndroid) {
          // Replace Android references with iOS equivalents
          const filteredText = textContent
            .replace(/Android/gi, 'iOS')
            .replace(/Google Play/gi, 'App Store') 
            .replace(/Play Store/gi, 'App Store');
            
          node.textContent = filteredText;
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        
        // Hide elements that are specifically about Android
        const isAndroidElement = 
          element.textContent?.toLowerCase().includes('android') &&
          (element.textContent.toLowerCase().includes('download') ||
           element.textContent.toLowerCase().includes('available') ||
           element.getAttribute('href')?.includes('play.google.com'));
           
        if (isAndroidElement) {
          (element as HTMLElement).style.display = 'none';
          return;
        }
        
        // Recursively process child nodes
        for (let i = 0; i < node.childNodes.length; i++) {
          filterTextNodes(node.childNodes[i]);
        }
      }
    };

    // Initial scan of the document
    filterTextNodes(document.body);

    // Set up a MutationObserver to catch dynamically added content
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
            filterTextNodes(node);
          }
        });
      });
    });

    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Cleanup
    return () => {
      observer.disconnect();
    };
  }, []);

  return <>{children}</>;
};