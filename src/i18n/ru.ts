/**
 * Русский словарь интерфейса (архитектура: src/i18n — ru/en; en появится на Этапе 6).
 * Строки UI не пишутся в компонентах напрямую — только отсюда.
 */
export const ru = {
  appName: 'NovaGrid',
  open: 'Открыть',
  save: 'Сохранить',
  searchPlaceholder: 'Поиск…',
  searchHint: 'Ctrl+F',
  searchLabel: 'Поиск по таблице',
  helpLabel: 'Справка (?)',
  sumLabel: 'СУММА',
  sumTitle: 'Сумма выделенного',
  formulaLabel: 'fx',
  formulaPlaceholder: 'Выберите ячейку — её формула появится здесь (Этап 4)',
  gridTitle: 'Здесь появится таблица',
  gridText: 'Грид с виртуализацией, редактированием и выделением — Этап 1 «Ядро таблицы».',
  sheet: 'Лист 1',
  addSheetLabel: 'Добавить лист',
  sheetsEmpty: 'Файлы .xls/.xlsx/.csv откроются здесь — Этап 2',
  statusPhase: 'Этап 0 · каркас',
} as const

export type RuDict = typeof ru
