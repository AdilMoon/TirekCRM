import type { Metadata } from 'next';
import { PublicQuote } from '../../features/public-quote';

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function QuotePage() {
  return <PublicQuote/>;
}
