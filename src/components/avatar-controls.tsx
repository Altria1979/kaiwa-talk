'use client';

import { useId, useState, type KeyboardEvent } from 'react';
import { useI18n } from '../i18n/provider';
import type { ControlsMessageKey } from '../i18n/messages/controls';
import type { AvatarEmotion } from '../../shared/avatar-emotion';
import type { AvatarAction, AvatarCapabilities, AvatarInteraction } from '../lib/avatar-animation';

const tabs = [
  { id: 'actions', label: 'actions' },
  { id: 'emotions', label: 'emotions' },
  { id: 'interactions', label: 'interactions' },
] as const;
const actions: { id: AvatarAction; label: ControlsMessageKey }[] = [
  { id: 'wave', label: 'wave' },
  { id: 'nod', label: 'nod' },
  { id: 'shake', label: 'shake' },
  { id: 'bow', label: 'bow' },
  { id: 'stretch', label: 'stretch' },
];
const emotions: { id: AvatarEmotion | 'auto'; label: ControlsMessageKey }[] = [
  { id: 'auto', label: 'auto' },
  { id: 'neutral', label: 'neutral' },
  { id: 'happy', label: 'happy' },
  { id: 'relaxed', label: 'relaxed' },
  { id: 'sad', label: 'sad' },
  { id: 'angry', label: 'angry' },
  { id: 'surprised', label: 'surprised' },
];
const interactions: { id: AvatarInteraction; label: ControlsMessageKey }[] = [
  { id: 'head', label: 'head' },
  { id: 'body', label: 'body' },
  { id: 'hand', label: 'hand' },
];

export function AvatarControls({ capabilities, emotionMode, onEmotionChange, onAction, onInteraction }: {
  capabilities: AvatarCapabilities;
  emotionMode: AvatarEmotion | 'auto';
  onEmotionChange: (emotion: AvatarEmotion | 'auto') => void;
  onAction: (action: AvatarAction) => void;
  onInteraction: (target: AvatarInteraction) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('actions');
  const unavailable = t('controls.avatarUnavailable');
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setTab(tabs[next].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  const hint = !capabilities.ready ? t('controls.avatarNotReadyHint')
    : tab === 'actions' ? t('controls.actionsHint')
    : tab === 'interactions' ? t('controls.interactionsHint')
    : emotionMode === 'auto' ? t('controls.autoEmotionHint')
    : t('controls.fixedEmotionHint');

  return <section className="avatar-controls" aria-label={t('controls.playWithAvatar')}>
    <div className="avatar-control-tabs" role="tablist" aria-label={t('controls.avatarControls')}>
      {tabs.map((item, index) => <button key={item.id} id={`${id}-${item.id}`} type="button" role="tab"
        aria-selected={tab === item.id} aria-controls={`${id}-panel`} tabIndex={tab === item.id ? 0 : -1}
        onClick={() => setTab(item.id)} onKeyDown={(event) => onTabKey(event, index)}>{t(`controls.${item.label}`)}</button>)}
    </div>
    <div id={`${id}-panel`} className="avatar-control-panel" role="tabpanel" aria-labelledby={`${id}-${tab}`}>
      <div className="avatar-control-options">
        {tab === 'actions' && actions.map(({ id: action, label }) => {
          const supported = capabilities.actions.includes(action);
          return <button key={action} type="button" disabled={!capabilities.ready || !supported}
            title={capabilities.ready && !supported ? unavailable : undefined} onClick={() => onAction(action)}>{t(`controls.${label}`)}</button>;
        })}
        {tab === 'emotions' && emotions.map(({ id: emotion, label }) => {
          const supported = emotion === 'auto' || emotion === 'neutral' || capabilities.emotions.includes(emotion);
          return <button key={emotion} type="button" aria-pressed={emotionMode === emotion}
            disabled={!capabilities.ready || !supported} title={capabilities.ready && !supported ? unavailable : undefined}
            onClick={() => onEmotionChange(emotion)}>{t(`controls.${label}`)}</button>;
        })}
        {tab === 'interactions' && interactions.map(({ id: target, label }) => {
          const supported = capabilities.interactions.includes(target);
          return <button key={target} type="button" disabled={!capabilities.ready || !supported}
            title={capabilities.ready && !supported ? unavailable : undefined} onClick={() => onInteraction(target)}>{t(`controls.${label}`)}</button>;
        })}
      </div>
      <p className="avatar-control-hint">{hint}</p>
    </div>
  </section>;
}
