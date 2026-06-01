import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>('dark'); // pitch-black dock by default

  // Load persisted theme on mount
  useEffect(() => {
    window.electron?.getSetting?.('theme').then((saved: string | null) => {
      if (saved === 'light' || saved === 'dark') setThemeState(saved);
    });
  }, []);

  // Sync when another window changes it
  useEffect(() => {
    window.electron?.onSettingChange?.(({ key, value }) => {
      if (key === 'theme' && (value === 'light' || value === 'dark')) setThemeState(value);
    });
  }, []);

  // Apply to <html> so all CSS tokens flip
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    window.electron?.setSetting?.('theme', t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      window.electron?.setSetting?.('theme', next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};
