'use client';

import { useState, useSyncExternalStore, type FormEvent } from 'react';
import type { BrowserBailianCredentials, ServiceStatus } from '../../shared/protocol';
import { api } from '../lib/api';
import { clearBrowserCredentials, getBrowserCredentialsSnapshot, parseBrowserCredentials, saveBrowserCredentials, subscribeBrowserCredentials } from '../lib/bailian-credentials';
import { Icon } from './icon';
import { useI18n } from '../i18n/provider';
import type { ControlsMessageKey } from '../i18n/messages/controls';

const missingSettingLabels = new Map<string, ControlsMessageKey>([
  ['BAILIAN_API_KEY', 'apiKey'],
  ['有効な会話エンドポイント', 'validChatEndpoint'],
  ['有効な ASR inference エンドポイント', 'validAsrEndpoint'],
  ['有効な TTS realtime エンドポイント', 'validTtsEndpoint'],
]);

export function BailianSettings({ status, active, onRefresh }: { status: ServiceStatus | null; active: boolean; onRefresh: () => Promise<void> }) {
  const { t, formatError, locale } = useI18n();
  const snapshot = useSyncExternalStore(subscribeBrowserCredentials, getBrowserCredentialsSnapshot, () => null);
  let stored: BrowserBailianCredentials | undefined;
  let storageError: unknown = null;
  try { stored = parseBrowserCredentials(snapshot); }
  catch (cause) { storageError = cause; }
  const [draft, setDraft] = useState<{ apiKey: string; apiHost: string } | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ControlsMessageKey | null>(null);
  const [error, setError] = useState<unknown>(null);
  const values = draft ?? { apiKey: stored?.apiKey ?? '', apiHost: stored?.apiHost ?? '' };
  const update = (field: 'apiKey' | 'apiHost', value: string) => {
    setDraft({ ...values, [field]: value });
    setMessage(null); setError(null);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (active || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const apiKey = values.apiKey.trim();
      const apiHost = values.apiHost.trim();
      if (!/^[\x21-\x7e]{1,512}$/.test(apiKey)) { setError({ errorCode: 'controls.keyInvalid' }); return; }
      if (apiHost && !/^[\x21-\x7e]{1,253}$/.test(apiHost)) { setError({ errorCode: 'controls.hostInvalid' }); return; }
      const credentials = { apiKey, ...(apiHost ? { apiHost } : {}) };
      // This checks local configuration only; saving never invokes a paid model.
      const result = await api.status(credentials);
      if (!result.ready) { setError({ errorCode: 'controls.configIncomplete' }); return; }
      saveBrowserCredentials(credentials);
      setDraft(null); setVisible(false);
      setMessage('keySaved');
    } catch (cause) {
      setError(cause);
    } finally { setBusy(false); }
  };
  const clear = () => {
    if (active || busy) return;
    setError(null); setMessage(null);
    try {
      clearBrowserCredentials();
      setDraft(null); setVisible(false);
      setMessage('keyDeleted');
    } catch (cause) { setError(cause); }
  };
  const sourceLabel = t(!status ? 'controls.loadingSettings' : status.credentialSource === 'browser' ? 'controls.browserKey' : 'controls.enterApiKey');
  const missingSettings = status?.missing.map(value => {
    const key = missingSettingLabels.get(value);
    return key ? t(`controls.${key}`) : value;
  }).join(locale === 'en' ? ', ' : '、');

  return <section className="bailian-settings" aria-labelledby="bailian-title">
    <div className="bailian-heading"><h3 id="bailian-title">{t('controls.bailianTitle')}</h3><a className="text-button" href="https://help.aliyun.com/zh/model-studio/get-api-key" target="_blank" rel="noreferrer">{t('controls.getApiKey')}<Icon name="arrow" size={14} /></a></div>
    <p id="bailian-storage-help" className="field-help">{t('controls.storageHelp')}</p>
    <p className="field-help">{t('controls.browserPrivacy')}</p>
    <form className="bailian-form" onSubmit={(event) => void save(event)}>
      <div className="field"><label htmlFor="bailian-api-key">{t('controls.apiKey')}</label><div className="secret-input"><input id="bailian-api-key" type={visible ? 'text' : 'password'} value={values.apiKey} onChange={(event) => update('apiKey', event.target.value)} placeholder={t('controls.apiKeyPlaceholder')} autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={512} disabled={active || busy} aria-describedby="bailian-storage-help" /><button type="button" className="text-button" aria-label={t(visible ? 'controls.hideApiKey' : 'controls.showApiKey')} aria-pressed={visible} onClick={() => setVisible(value => !value)} disabled={!values.apiKey}>{t(visible ? 'controls.hide' : 'controls.show')}</button></div></div>
      <details className="bailian-advanced"><summary>{t('controls.endpoint')}</summary><label className="field" htmlFor="bailian-api-host">{t('controls.apiHost')}<input id="bailian-api-host" value={values.apiHost} onChange={(event) => update('apiHost', event.target.value)} placeholder="dashscope.aliyuncs.com" autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={253} disabled={active || busy} /><span className="field-help">{t('controls.hostHelp')}</span></label></details>
      <div className="bailian-actions"><button className="secondary-button" type="submit" disabled={active || busy || !values.apiKey.trim()}><Icon name="check" size={16} />{t(busy ? 'controls.saving' : stored ? 'controls.updateApiKey' : 'controls.saveApiKey')}</button><button className="text-button" type="button" disabled={active || busy || snapshot === null} onClick={clear}>{t('controls.deleteApiKey')}</button></div>
      {Boolean(error || storageError) && <p className="form-error" role="alert">{formatError(error || storageError)}</p>}
      {message && <p className="bailian-feedback" role="status">{t(`controls.${message}`)}</p>}
      {active && <p className="field-help">{t('controls.endBeforeKeyChange')}</p>}
    </form>
    <div className={`connection-card ${status?.ready ? 'is-ready' : ''}`}><div className="connection-heading"><span className="connection-dot" /><strong>{sourceLabel}</strong><button type="button" className="text-button" onClick={() => void onRefresh()}>{t('controls.refreshStatus')}</button></div><p>{t(status?.ready ? 'controls.configured' : status ? 'controls.saveToStart' : 'controls.connecting')}</p>{status && <details className="bailian-models"><summary>{t('controls.connectionDetails')}</summary><div className="config-details"><span>{t('controls.region')} <b>{status.region || t('controls.unset')}</b></span>{status.missing.length > 0 && <span>{t('controls.missingItems')} <b>{missingSettings}</b></span>}<span>{t('controls.chat')} <b>{status.models.chat}</b></span><span>{t('controls.asr')} <b>{status.models.asr}</b></span><span>{t('controls.tts')} <b>{status.models.tts}</b></span></div></details>}</div>
  </section>;
}
