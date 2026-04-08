'use client';

import { useEffect } from 'react';
import { logCollector } from '@/lib/logCollector';

export function LogCollectorInit() {
  useEffect(() => {
    logCollector.init();
  }, []);

  return null;
}
