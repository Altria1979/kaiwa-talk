'use client';

import { useI18n } from '../i18n/provider';

export default function ErrorPage({ retry }: { retry: () => void }) {
  const { t } = useI18n();
  return (
    <main className="page-notice" role="alert">
      <h1>{t('common.errorTitle')}</h1>
      <p>{t('common.errorDescription')}</p>
      <button onClick={retry}>{t('common.retry')}</button>
    </main>
  );
}
