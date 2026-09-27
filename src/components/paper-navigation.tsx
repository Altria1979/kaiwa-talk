'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icon';
import { useI18n } from '../i18n/provider';
import { LanguageSwitcher } from './language-switcher';
import styles from './paper-navigation.module.css';

export type Panel = 'settings' | 'history' | 'memories' | null;

export function PaperNavigation({ panel, onChange }: { panel: Panel; onChange: (panel: Panel) => void }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setExpanded(false); toggle.current?.focus(); }
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navigation.current?.contains(event.target)) setExpanded(false);
    };
    const desktop = window.matchMedia('(min-width: 901px)');
    const resize = () => { if (desktop.matches) setExpanded(false); };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', outside);
    desktop.addEventListener('change', resize);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', outside);
      desktop.removeEventListener('change', resize);
    };
  }, [expanded]);

  const select = (next: Panel) => {
    if (expanded) { setExpanded(false); toggle.current?.focus(); }
    onChange(next);
  };

  return <div className={styles.slot}>
    <nav ref={navigation} className={styles.navigation} aria-label={t('controls.navigation')}>
      <Link className={styles.brand} href="/" aria-label={t('controls.home')}><strong>Kaiwa Talk</strong></Link>
      <button ref={toggle} className={styles.toggle} aria-label={t(expanded ? 'controls.closeMenu' : 'controls.openMenu')} aria-expanded={expanded} aria-controls="main-navigation" onClick={() => setExpanded(current => !current)}>{expanded ? <Icon name="close" /> : <span className={styles.menuIcon} aria-hidden="true" />}<span>{t('controls.menu')}</span></button>
      <div id="main-navigation" className={`${styles.links} ${expanded ? styles.expanded : ''}`}>
        <button className={panel === null ? styles.selected : ''} aria-current={panel === null ? 'page' : undefined} aria-label={t('controls.practice')} onClick={() => select(null)}><Icon name="headphones" size={17} />{t('controls.practice')}</button>
        <button className={panel === 'history' ? styles.selected : ''} aria-haspopup="dialog" onClick={() => select('history')}>{t('controls.history')}</button>
        <button className={panel === 'memories' ? styles.selected : ''} aria-haspopup="dialog" onClick={() => select('memories')}>{t('controls.memories')}</button>
        <button className={panel === 'settings' ? styles.selected : ''} aria-haspopup="dialog" onClick={() => select('settings')}>{t('controls.settings')}</button>
        <LanguageSwitcher />
      </div>
    </nav>
  </div>;
}
