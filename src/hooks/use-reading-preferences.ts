'use client';

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_READING_PREFERENCES, loadReadingPreferences, saveReadingPreferences, type ReadingPreferences } from '../lib/reading-preferences';

export interface ReadingPreferencesControls extends ReadingPreferences {
  setShowKana: (value: boolean) => void;
  setShowRomaji: (value: boolean) => void;
}

export function useReadingPreferences(): ReadingPreferencesControls {
  const [preferences, setPreferences] = useState(DEFAULT_READING_PREFERENCES);
  const current = useRef(DEFAULT_READING_PREFERENCES);
  const restored = useRef(false);

  useEffect(() => {
    let disposed = false;
    // Match the server render, then restore the browser's saved choices.
    queueMicrotask(() => {
      if (disposed || restored.current) return;
      current.current = loadReadingPreferences();
      restored.current = true;
      setPreferences(current.current);
    });
    return () => { disposed = true; };
  }, []);

  const updatePreference = (key: keyof ReadingPreferences, value: boolean) => {
    const previous = restored.current ? current.current : loadReadingPreferences();
    restored.current = true;
    current.current = { ...previous, [key]: value };
    setPreferences(current.current);
    saveReadingPreferences(current.current);
  };

  return {
    ...preferences,
    setShowKana: value => updatePreference('showKana', value),
    setShowRomaji: value => updatePreference('showRomaji', value),
  };
}
