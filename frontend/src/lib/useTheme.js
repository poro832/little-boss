import { useState, useEffect } from 'react';
import { readStoredTheme, writeStoredTheme, applyTheme } from './theme';

export function useTheme() {
  const [theme, setThemeState] = useState(readStoredTheme);

  useEffect(() => { applyTheme(theme); }, [theme]);

  const setTheme = (next) => {
    writeStoredTheme(next);
    setThemeState(next);
  };

  return { theme, setTheme };
}
