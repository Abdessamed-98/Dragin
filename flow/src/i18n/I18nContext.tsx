import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translations, Lang, TranslationKey } from './index';

interface I18nContextValue {
  lang: Lang;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  setLang: (lang: Lang) => void;
  dir: 'rtl' | 'ltr';
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>('ar');

  // Load persisted language on mount
  useEffect(() => {
    window.electron?.getSetting?.('language').then((saved: string | null) => {
      if (saved === 'en' || saved === 'ar') setLangState(saved);
    });
  }, []);

  // Listen for language changes from other windows
  useEffect(() => {
    window.electron?.onLanguageChange?.((newLang: string) => {
      if (newLang === 'en' || newLang === 'ar') setLangState(newLang);
    });
  }, []);

  // Update HTML attributes + font when language changes
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('lang', lang);

    // Gallery: switch dir. Dock: leave alone (SideDock has dir="ltr" hardcoded).
    const isGallery = new URLSearchParams(window.location.search).get('window') === 'gallery';
    if (isGallery) {
      html.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    }

    // Font: Tajawal for Arabic, Inter/system for English
    document.body.style.fontFamily = lang === 'ar'
      ? "'Tajawal', sans-serif"
      : "'Inter', system-ui, -apple-system, sans-serif";
  }, [lang]);

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    window.electron?.setSetting?.('language', newLang);
  }, []);

  const t = useCallback((key: TranslationKey, vars?: Record<string, string | number>): string => {
    let text = translations[lang][key] || translations['ar'][key] || key;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        text = text.replace(`{{${k}}}`, String(v));
      });
    }
    return text;
  }, [lang]);

  const dir = lang === 'ar' ? 'rtl' as const : 'ltr' as const;

  return (
    <I18nContext.Provider value={{ lang, t, setLang, dir }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): I18nContextValue => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
};
