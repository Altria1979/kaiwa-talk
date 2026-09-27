export interface ReadingPreferences {
  showKana: boolean;
  showRomaji: boolean;
}

export const DEFAULT_READING_PREFERENCES: ReadingPreferences = { showKana: true, showRomaji: true };
export const READING_PREFERENCES_STORAGE_KEY = 'avatar-a.reading-preferences.v1';

export function parseReadingPreferences(value: string | null): ReadingPreferences {
  try {
    const saved: unknown = JSON.parse(value ?? 'null');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...DEFAULT_READING_PREFERENCES };
    const preferences = saved as Partial<ReadingPreferences>;
    return {
      showKana: typeof preferences.showKana === 'boolean' ? preferences.showKana : true,
      showRomaji: typeof preferences.showRomaji === 'boolean' ? preferences.showRomaji : true,
    };
  } catch {
    return { ...DEFAULT_READING_PREFERENCES };
  }
}

export function loadReadingPreferences(): ReadingPreferences {
  try {
    return parseReadingPreferences(localStorage.getItem(READING_PREFERENCES_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_READING_PREFERENCES };
  }
}

export function saveReadingPreferences(preferences: ReadingPreferences): void {
  try {
    localStorage.setItem(READING_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage is optional; controls retain their state for the current page.
  }
}
