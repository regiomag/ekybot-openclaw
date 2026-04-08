'use client';

import { AppLayout } from '@/components/AppLayout';
import { SupabaseAuthCard } from '../../components/SupabaseAuthCard';

export default function SignInPage() {
  return (
    <AppLayout showNav={true} showBottomNav={false}>
      <div className="flex-1 flex flex-col items-center justify-center p-4 min-h-[70vh]">
        <SupabaseAuthCard mode="sign-in" />
      </div>
    </AppLayout>
  );
}
