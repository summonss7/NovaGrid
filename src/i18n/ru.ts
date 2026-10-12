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
  sumAutosum: 'Автосумма',
  sumAutosumTitle: 'Автосумма: встаньте на ячейку, нажмите Σ и выберите ячейки — в ячейку вставится =СУММ',
  sumPickHint: (ref: string) => `Выберите ячейки для суммы — она вставится в ${ref} · Esc — отмена`,
  formulaLabel: 'fx',
  formulaBarLabel: 'Строка формул',
  formulaPlaceholder: 'Значение или формула — начните с =',
  gridArea: 'Таблица',
  cellEditorLabel: 'Редактор ячейки',
  altSum: 'Σ',
  sheet: 'Лист 1',
  addSheetLabel: 'Добавить лист',
  sheetsEmpty: 'Файлы .xlsx/.xls/.ods/.csv откроются здесь',
  statusPhase: 'v1.0',
  /** число в текущей локали словаря (Этап 6.3) */
  num: (n: number) => n.toLocaleString('ru-RU'),
  /** BCP-47 тег локали словаря — печать чисел/дат (Этап 7.4) */
  localeTag: 'ru-RU',

  // поиск (Ф2, Этап 3)
  searchScopeSheet: 'Этот лист',
  searchScopeBook: 'Все листы',
  searchScopeLabel: 'Область поиска',
  searchNext: 'Следующее совпадение',
  searchPrev: 'Предыдущее совпадение',
  searchOptions: 'Параметры поиска',
  searchCaseSensitive: 'Учитывать регистр',
  searchWholeCell: 'Ячейка целиком',
  searchClose: 'Закрыть поиск',
  searchNoMatches: 'Совпадений нет',
  searchResultsLabel: 'Результаты поиска',
  searchMoreResults: (n: number) => `… ещё ${n.toLocaleString('ru-RU')}`,
  searchHitContext: (ref: string, text: string) => `${ref} · ${text}`,

  // найти и заменить (Этап 7)
  replaceTitle: 'Найти и заменить',
  replaceHint: 'Ctrl+H',
  replaceOpenAction: 'Найти и заменить',
  replaceFindLabel: 'Найти',
  replaceWithLabel: 'Заменить на',
  replaceAction: 'Заменить',
  replaceAllAction: 'Заменить все',
  replaceFound: (n: number) => `Найдено: ${n.toLocaleString('ru-RU')}`,
  replaceDone: (n: number) => `Заменено: ${n.toLocaleString('ru-RU')}`,
  replaceInFormulas: 'Искать в формулах',
  replaceClose: 'Закрыть',
  replaceFormulasNote:
    'По умолчанию заменяется значение ячейки (формула станет числом/текстом); «искать в формулах» меняет текст формулы с пересчётом',

  // фильтры (Ф3)
  filterBarLabel: 'Фильтры:',
  filterChipMore: (n: number) => `+${n.toLocaleString('ru-RU')}`,
  filterResetAll: 'Сбросить всё',
  filterBlanks: '(пустые)',
  filterShownOf: (shown: number, total: number) =>
    `Показано ${shown.toLocaleString('ru-RU')} из ${total.toLocaleString('ru-RU')}`,
  ctxMenuLabel: 'Меню ячейки',
  ctxFilterEqual: (col: string, value: string) => `Фильтровать: ${col} = «${value}»`,
  ctxFilterNotEqual: (col: string, value: string) => `Исключить: ${col} ≠ «${value}»`,
  ctxAddValue: (value: string) => `Добавить «${value}» к фильтру`,
  ctxClearColumn: (col: string) => `Снять фильтр с колонки ${col}`,
  ctxClearAll: 'Сбросить все фильтры',
  ctxCopyCell: 'Копировать ячейку',
  ctxCopyRow: 'Копировать строку',
  copiedToast: 'Скопировано',

  // меню колонки (Ф3.7 + Ф8)
  columnMenuLabel: (col: string) => `Меню колонки ${col}`,
  sortGroupLabel: 'Сортировка',
  sortAsc: 'По возрастанию',
  sortDesc: 'По убыванию',
  sortConfirm: 'Строки перемешаются. Отменить можно будет Ctrl+Z. Продолжить?',
  columnValuesLabel: 'Значения',
  columnValuesSearch: 'Поиск по значениям…',
  columnValuesShown: (shown: number, total: number) =>
    `Показаны первые ${shown.toLocaleString('ru-RU')} из ${total.toLocaleString('ru-RU')}`,
  columnSelectAll: 'Выбрать все',
  columnResetFilter: 'Сбросить фильтр колонки',

  // Σ и метрики (Ф4)
  metricSum: 'Сумма',
  metricCount: 'Кол-во чисел',
  metricFilled: 'Кол-во заполненных',
  metricMean: 'Среднее',
  metricMin: 'Минимум',
  metricMax: 'Максимум',
  metricCopyHint: 'Клик по строке копирует значение',
  metricCopied: 'Скопировано ✓',
  sumLiveLabel: 'Σ выделения',

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
  demoOdsTitle: 'Книга ODS (LibreOffice)',
  demoOdsHint: 'Числа, текст, даты · ods · 2 листа',
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
  saveAsFormatXlsx: '.xlsx (Excel, со стилями)',
  saveAsFormatCsv: '.csv (активный лист)',
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
  odsSaveNote: 'Файл .ods сохранится как .xlsx — прямой записи .ods в NovaGrid нет',

  // печать (Этап 7.4)
  printOpenAction: 'Печать',
  printTitle: 'Печать',
  printWhatLabel: 'Что печатать',
  printScopeVisible: (shown: number, total: number) =>
    `Видимые строки (${shown.toLocaleString('ru-RU')} из ${total.toLocaleString('ru-RU')})`,
  printScopeAll: (total: number) => `Весь лист (${total.toLocaleString('ru-RU')})`,
  printOrientationLabel: 'Ориентация',
  printLandscape: 'Альбомная',
  printPortrait: 'Книжная',
  printPaperLabel: 'Формат бумаги',
  printA4: 'A4',
  printLetter: 'Letter',
  printAction: 'Печать…',
  printTruncated: (n: number) =>
    `Печать ограничена первыми ${n.toLocaleString('ru-RU')} строками`,

  // формулы (Ф6, Этап 4)
  formulaFrozen: '∛ не пересчитывается',
  formulaFrozenHint:
    'Формула вне списка поддерживаемых: показано последнее значение из файла, сама формула сохранится как есть',
  assistLabel: 'Подсказки формул',

  // справочник «?» (4.5)
  helpTitle: 'Справка NovaGrid',
  helpTabFunctions: 'Формулы',
  helpTabKeys: 'Горячие клавиши',
  helpTabHow: 'Приёмы',
  helpSearchPlaceholder: 'Найти функцию…',
  helpExampleLabel: 'Например',
  helpClose: 'Закрыть справку',
  helpKeysColAction: 'Действие',
  helpKeysColKey: 'Клавиши',
  helpFunctionsHint:
    'Примеры считаются на вашей таблице — откройте файл или начните с новой',

  // PWA и мобильные (Этап 5)
  pwaUpdateTitle: 'Доступна новая версия NovaGrid',
  pwaUpdateAction: 'Обновить',
  pwaUpdateDismiss: 'Позже',
  mobileBarLabel: 'Действия',
  mobileOpen: 'Открыть',
  mobileSearch: 'Поиск',
  mobileSum: 'Сумма',
  mobileHelp: 'Справка',
  moreMenuLabel: 'Ещё',
  zoomLabel: 'Масштаб таблицы',
  zoomIn: 'Увеличить масштаб',
  zoomOut: 'Уменьшить масштаб',
  zoomReset: 'Сбросить масштаб к 100 %',
  formulaExpand: 'Развернуть строку формул',
  formulaCollapse: 'Свернуть строку формул',

  // настройки (Этап 6.3)
  settingsLabel: 'Настройки',
  fileGroupLabel: 'Файл',
  sheetsTabsLabel: 'Листы книги',
  cellRefLabel: 'Адрес активной ячейки',
  settingsTitle: 'Настройки',
  settingsLang: 'Язык',
  settingsTheme: 'Тема',
  settingsThemeSystem: 'Система',
  settingsThemeLight: 'Светлая',
  settingsThemeDark: 'Тёмная',
  settingsTableSize: 'Размер таблицы',
  settingsCsvDelimiter: 'Разделитель CSV по умолчанию',
  settingsSizeS: 'Мелкий',
  settingsSizeM: 'Обычный',
  settingsSizeL: 'Крупный',
  settingsSizeXL: 'Огромный',
  settingsClose: 'Закрыть настройки',
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

/** Строки широкой строкой (не литералы `as const`) — en-словарь присваивается. */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => R
    : T

export type RuDict = { [K in keyof typeof ru]: Widen<(typeof ru)[K]> }
