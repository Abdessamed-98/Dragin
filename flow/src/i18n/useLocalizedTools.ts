import { useMemo } from 'react';
import { useI18n } from './I18nContext';
import { ALL_TOOLS_RAW } from '../data/tools';
import { ToolDefinition } from '../types';

export function useLocalizedTools(): ToolDefinition[] {
  const { t } = useI18n();

  return useMemo(() =>
    ALL_TOOLS_RAW.map(raw => ({
      id: raw.id,
      title: t(raw.titleKey),
      description: t(raw.descriptionKey),
      icon: raw.icon,
      colorClass: raw.colorClass,
      emptyHint: t(raw.emptyHintKey),
      emptySubHint: t(raw.emptySubHintKey),
      formatLines: raw.formatLinesKeys.map(k => t(k)),
    })),
    [t]
  );
}
