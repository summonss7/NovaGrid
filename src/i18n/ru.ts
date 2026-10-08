/**
 * Русский словарь интерфейса (архитектура: src/i18n — ru/en; en появится на Этапе 6).
 * Строки UI не пишутся в компонентах напрямую — только отсюда.
 */
export const ru = {
  appName: 'NovaGrid',
  open: 'Открыть',
  save: 'Сохранить',
  saveAs: 'Сохранить как…',
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
  sheetsEmpty: 'Файлы .xlsx/.xls/.csv откроются здесь',
  statusPhase: 'Этап 2 · файлы',

  // файлы (Этап 2)
  fileOpenTitle: 'Открыть файл',
  openFileLabel: 'Открыть файл…',
  fileInputLabel: 'Выбор файла таблицы',
  newBook: 'Новая таблица',
  unsavedBook: 'Несохранённая книга',
  dirtyMark: '●',
  dirtyTitle: 'Есть несохранённые изменения',
  recentTitle: 'Недавние',
  recentEmpty: 'Здесь появятся книги, с которыми вы работали',
  recentForgetTime: 'Забыть',
  recentCells: (n: number) => `${n.toLocaleString('ru-RU')} яч.`,
  recentSavedAt: (d: Date) => `сохранено ${formatRelative(d)}`,
  restoreSession: 'Продолжить',
  demoBookTitle: 'Демо-книга сценария ТЗ',
  demoBookHint: 'Фамилии и суммы · xlsx · 2 листа',
  stressBookTitle: 'Стресс 100 000 строк',
  stressBookHint: 'Проверка скорости · csv',
  demoSectionTitle: 'Попробовать',
  startTagline: 'Простые таблицы без изучения Excel',
  startPrivacy: 'Всё считается локально в вашем браузере — файлы никуда не загружаются',
  openingFile: 'Открываем файл…',
  savingFile: 'Сохраняем…',
  savedToast: (name: string) => `Сохранено: ${name}`,
  openErrorTitle: 'Не удалось открыть файл',
  saveErrorTitle: 'Не удалось сохранить',
  dropHere: 'Отпустите, чтобы открыть',
  saveAsTitle: 'Сохранить как',
  saveAsNameLabel: 'Имя файла',
  saveAsFormatLabel: 'Формат',
  saveAsDelimiterLabel: 'Разделитель CSV',
  semicolon: '; точка с запятой',
  comma: ', запятая',
  tab: 'таб',
  saveAction: 'Сохранить',
  cancelAction: 'Отмена',
  sheetRowsCols: (rows: number, cols: number) =>
    `${rows.toLocaleString('ru-RU')} строк · колонок ${cols.toLocaleString('ru-RU')}`,
  tabRename: 'Переименовать',
  tabDuplicate: 'Дублировать',
  tabDelete: 'Удалить',
  tabDeleteConfirm: (name: string) => `Удалить лист «${name}»? Отменить будет нельзя.`,
  tabMenuLabel: 'Меню листа',
  xlsSaveNote: 'Файл .xls сохранится как .xlsx (современный формат)',
} as const

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} ч назад`
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export type RuDict = typeof ru
