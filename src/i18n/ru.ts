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
  formulaPlaceholder: 'Значение выбранной ячейки (формулы — Этап 4)',
  gridArea: 'Таблица',
  cellEditorLabel: 'Редактор ячейки',
  altSum: 'Σ',
  sheet: 'Лист 1',
  addSheetLabel: 'Добавить лист',
  sheetsEmpty: 'Файлы .xls/.xlsx/.csv откроются здесь — Этап 2',
  statusPhase: 'Этап 1 · ядро таблицы',
} as const

export type RuDict = typeof ru
