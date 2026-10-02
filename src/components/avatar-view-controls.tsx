'use client';

import { useId, type KeyboardEvent } from 'react';
import { useI18n } from '../i18n/provider';
import { Icon } from './icon';

export type AvatarViewCommand = 'reset' | 'zoomIn' | 'zoomOut' | 'rotateLeft' | 'rotateRight';

export function AvatarViewControls({ disabled, onCommand }: {
  disabled: boolean;
  onCommand: (command: AvatarViewCommand) => void;
}) {
  const { t } = useI18n();
  const hintId = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const command = event.key === 'ArrowLeft' ? 'rotateLeft'
      : event.key === 'ArrowRight' ? 'rotateRight'
      : event.key === '+' || event.key === '=' ? 'zoomIn'
      : event.key === '-' ? 'zoomOut'
      : event.key === 'Home' ? 'reset' : null;
    if (!command) return;
    event.preventDefault();
    onCommand(command);
  };

  return <div className="avatar-view-controls" role="group" aria-label={t('controls.viewControls')}
    aria-describedby={hintId} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
    aria-keyshortcuts="ArrowLeft ArrowRight + - Home" onKeyDown={onKeyDown}>
    <div className="avatar-view-buttons">
      <button type="button" disabled={disabled} aria-label={t('controls.zoomOut')} title={t('controls.zoomOut')} onClick={() => onCommand('zoomOut')}><Icon name="zoom-out" size={18} /></button>
      <button type="button" disabled={disabled} aria-label={t('controls.zoomIn')} title={t('controls.zoomIn')} onClick={() => onCommand('zoomIn')}><Icon name="zoom-in" size={18} /></button>
      <button type="button" disabled={disabled} aria-label={t('controls.resetView')} title={t('controls.resetView')} onClick={() => onCommand('reset')}><Icon name="reset-view" size={18} /></button>
    </div>
    <p className="avatar-view-hint"><span className="avatar-view-desktop-hint">{t('controls.viewMouseHint')}</span><span className="avatar-view-touch-hint">{t('controls.viewTouchHint')}</span></p>
    <span id={hintId} className="sr-only">{t('controls.viewKeyboardHint')}</span>
  </div>;
}
