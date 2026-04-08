import { redirect } from 'next/navigation';

// V2 is deprecated - redirect to V3
export default function V2Redirect() {
  redirect('/v3');
}
