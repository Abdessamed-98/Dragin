import { ar, TranslationKey } from './translations/ar';
import { en } from './translations/en';

export type Lang = 'ar' | 'en';
export type { TranslationKey };

export const translations: Record<Lang, Record<TranslationKey, string>> = { ar, en };
