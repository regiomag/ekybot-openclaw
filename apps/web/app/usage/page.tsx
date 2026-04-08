import { redirect } from 'next/navigation';

// Redirect old /usage to new /costs page
export default function UsagePage() {
  redirect('/costs');
}
