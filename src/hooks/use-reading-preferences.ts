'use client';

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_READING_PREFERENCES, loadReadingPreferences, saveReadingPreferences, type ReadingPreferences } from '../lib/reading-preferences';

export interface ReadingPreferencesControls extends ReadingPreferences {
  setShowKana: (value: boolean) => void;
}

export function useReadingPreferences(): ReadingPreferencesControls {
  const [preferences, setPreferences] = useState(DEFAULT_READING_PREFERENCES);
  const restored = useRef(false);

  useEffect(() => {
    let disposed = false;
    // Match the server render, then restore the browser's saved choices.
    queueMicrotask(() => {
      if (disposed || restored.current) return;
      restored.current = true;
      setPreferences(loadReadingPreferences());
    });
    return () => { disposed = true; };
  }, []);

  const setShowKana = (value: boolean) => {
    const next = { showKana: value };
    restored.current = true;
    setPreferences(next);
    saveReadingPreferences(next);
  };

  return {
    ...preferences,
    setShowKana,
  };
}
