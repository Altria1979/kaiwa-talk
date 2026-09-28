import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { getRequestLocale } from '../i18n/request';
import { translate } from '../i18n/messages';
import { I18nProvider } from '../i18n/provider';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: translate(locale, 'common.title'), description: translate(locale, 'common.description') };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();
  return <html lang={locale}><body><I18nProvider initialLocale={locale}>{children}</I18nProvider><Analytics /></body></html>;
}
