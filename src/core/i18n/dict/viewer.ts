// Labels of the viewer (src/assets/viewer, src/core/viewer).
import { translator, type Dictionary } from '../index.ts';

const en = {
  commandQuickLook: 'Quick look',
  fitToScreen: 'Fit to screen',
  previousFile: 'Previous file',
  nextFile: 'Next file',
  noPreview: 'No preview',
  open: 'Open',
  share: 'Share',
  openInDefaultApp: 'Open in default app',
};

export const strings: Dictionary<typeof en> = {
  en,
  ru: {
    commandQuickLook: 'Быстрый просмотр',
    fitToScreen: 'Вписать в экран',
    previousFile: 'Предыдущий файл',
    nextFile: 'Следующий файл',
    noPreview: 'Просмотра нет',
    open: 'Открыть',
    share: 'Поделиться',
    openInDefaultApp: 'Открыть в приложении по умолчанию',
  },
};

export const t = translator(strings);
