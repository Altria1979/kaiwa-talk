'use client';

import Link from 'next/link';
import { useI18n } from '../i18n/provider';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <main className="page-notice">
      <h1>{t('common.notFoundTitle')}</h1>
      <p>{t('common.notFoundDescription')}</p>
      <Link href="/">{t('common.home')}</Link>
    </main>
  );
}
