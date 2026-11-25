import type { Metadata } from 'next';
import './globals.css';
import './order-attention.css';
import './service-objects.css';
import './employee-workflow.css';
import './workspace-refinement.css';
import './mobile.css';
import './smart-orders.css';
import './scheduling.css';
import './telegram.css';
import './work-time.css';
import './order-effort.css';
import './quotes.css';
import { LanguageProvider } from '../i18n/provider';
export const metadata: Metadata = { title: 'Tirek — рабочее пространство бизнеса', description: 'Клиенты, заказы, документы и финансы малого бизнеса в одном месте.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body><LanguageProvider>{children}</LanguageProvider></body></html>;
}
