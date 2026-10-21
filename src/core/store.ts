/*
 * Единое состояние грида (Zustand, ARCHITECTURE §2): книга с вкладками листов,
 * выделение, редактирование, Alt-лассо, метаданные файла (Этап 2). Этап 3
 * добавляет фильтры колонок (объединение по «И», список видимых строк —
 * производный), инкрементальный поиск и сортировку видимых строк.
 * Undo — delta-стеки core/history, по одному на вкладку. Модуль UI-агностичен:
 * канвас подписывается напрямую на стор, React-панели — селекторами.
 *
 * Инвариант: state.sheet === state.tabs[state.activeTab].sheet — «текущий лист»,
 * чтобы потребители (грид, строка формул, статус-бар) не знали про вкладки.
 */

import { createStore } from 'zustand/vanilla'
import {
  type ColumnFilter,
  columnValueCounts,
  compareCellValues,
  isActiveFilter,
  nearestVisibleRow,
  visibleIndexOf,
  visibleRowsOf,
} from './filter'
import { History, type CellChange, type HistoryEntry } from './history'
import {
  type NormRange,
  type Range,
  type Selection,
  clampRef,
  normalize,
  range,
  selectedCells,
  selectionOf,
} from './selection'
import {
  MAX_COLS,
  MAX_ROWS,
  MIN_COLS,
  MIN_ROWS,
  type SheetModel,
  cellKey,
  createSheet,
  getCell,
  parseNumber,
  withCellList,
  withSpace,
} from './sheet'
import { applyFormulaChanges, cellNumber, recalcSheet } from '../formula/engine'
import { parseClipboardTsv } from './copy'
import { BASE_COL_W, COL_W_MAX, COL_W_MIN, cellRefName } from '../grid/geometry'
// метрики выделения (6.1) агрегируются потоком; sum/average из ./stats
// остаются для движка формул и юнит-тестов
import { type SearchHit, type SearchOptions, searchBook, searchSheet } from './search'
import {
  type ReplaceOptions,
  replaceAllInSheet,
  replaceCellRaw,
  replaceHitsInBook,
  replaceHitsInSheet,
} from './replace'
import {
  type BookWire,
  type SheetTab,
  DEFAULT_SHEET_NAME,
  createTab,
  newTabId,
  sanitizeSheetName,
  tabsFromWire,
  uniqueTabName,
} from './workbook'

export type EditMove = 'down' | 'up' | 'right' | 'left' | 'none'

/** Формат файла на диске — определяет поведение «Сохранить». */
export type FileFormat = 'xlsx' | 'csv' | 'xls' | 'ods'

const MOVE_DELTA: Record<EditMove, [number, number]> = {
  down: [1, 0],
  up: [-1, 0],
  right: [0, 1],
  left: [0, -1],
  none: [0, 0],
}

export interface EditState {
  row: number
  col: number
  value: string
  /** replace — ввод с заменой (выделить всё); append — F2 (каретка в конец) */
  mode: 'replace' | 'append'
  /** 'bar' — правка из строки формул: редактор ячейки не показывается (4.3) */
  source?: 'cell' | 'bar'
  /** позиция каретки в value (для вставки ссылок кликом); null — считать конец */
  caret?: number
  /** диапазон текста последней вставленной кликом ссылки (для протягивания в A1:B3) */
  pointSpan?: { start: number; end: number }
  /** якорь жеста указания: первая ячейка выбранного диапазона */
  pointAnchor?: { row: number; col: number }
}

/**
 * Автосумма (novagrid-020): Σ запоминает ячейку, где стояли, следующее
 * выделение (клик/протяжка) превращается в =SUM(…) в этой ячейке.
 */
export interface SumPickState {
  row: number
  col: number
}

export interface SelectionMetrics {
  /** Σ — сумма числовых ячеек выделения */
  total: number
  /** n — количество числовых ячеек */
  count: number
  /** x̄ — среднее по числовым ячейкам (0 при пустом выделении) */
  mean: number
  /** количество заполненных ячеек (карточка метрик Ф4) */
  filled: number
  /** мин/макс числовых ячеек; null — чисел нет */
  min: number | null
  max: number | null
}

export type SearchScope = 'sheet' | 'book'

/** Состояние поиска (Ф2): инкрементальный, пересчитывается на каждую правку. */
export interface SearchState {
  open: boolean
  query: string
  scope: SearchScope
  caseSensitive: boolean
  wholeCell: boolean
  /** все совпадения в рамках scope; текущее — index */
  hits: SearchHit[]
  /** ключи «row:col» совпадений активного листа — подсветка канвасом */
  hitSet: Set<string>
  index: number
}

/**
 * Состояние «Найти и заменить» (Этап 7): диалог Ctrl+H. Совпадения
 * считаются движком core/replace (режим значений/формул), счётчик «Найдено»
 * живой; lastCount — сколько ячеек заменило последнее действие.
 */
export interface ReplaceState {
  open: boolean
  query: string
  replacement: string
  scope: SearchScope
  caseSensitive: boolean
  wholeCell: boolean
  /** искать в тексте формул (после «=») вместо вычисленных значений */
  inFormulas: boolean
  /** совпадения в рамках scope; текущее — index */
  hits: SearchHit[]
  index: number
  /** результат последнего «Заменить»/«Заменить все»; null — действия не было */
  lastCount: number | null
  /** ячейки, заменённые в текущей серии «Заменить»: их пропускает указатель */
  replacedKeys: Set<string>
}

export interface GridState {
  /** вкладки книги; sheet ниже — всегда активная из них */
  tabs: SheetTab[]
  activeTab: number
  sheet: SheetModel
  selection: Selection
  edit: EditState | null
  /** Alt-лассо быстрой суммы (Ф4) — временный оранжевый диапазон */
  altRange: Range | null

  /** фильтры активной вкладки (Ф3); хранение по вкладкам — как история */
  filters: ColumnFilter[]
  /**
   * Ячейка, где стоял курсор до первого фильтра (novagrid-034): снятие
   * последнего фильтра возвращает курсор сюда — «программа помнит, где я
   * был». null — фильтров нет и якорь не сохранён. По вкладкам, как фильтры.
   */
  filterAnchor: { row: number; col: number } | null
  /** состояние поиска (Ф2) */
  search: SearchState
  /** состояние «Найти и заменить» (Этап 7) */
  replace: ReplaceState

  /**
   * Переопределённые ширины колонок активной вкладки (novagrid-020) —
   * перетаскивание границ в шапке; ключ — индекс колонки, значение — ширина
   * в базовых единицах (зум 100 %). null — все колонки стандартные.
   */
  colWidths: ReadonlyMap<number, number> | null
  /** автосумма: ячейка-приёмник =SUM, ожидает выбор диапазона; null — выключена */
  sumPick: SumPickState | null

  /** имя файла на диске (null — новая несохранённая книга) */
  fileName: string | null
  /** формат открытого файла; xlsx — формат сохранения по умолчанию */
  fileFormat: FileFormat | null
  /** разделитель CSV — детектируется при открытии, используется при записи */
  csvDelimiter: string
  /** есть правки, не сохранённые в файл (● у имени) */
  dirty: boolean
  /** хэндл прямой записи (File System Access, Chromium-десктоп) — не сериализуется */
  fileHandle: FileSystemFileHandle | null
  /** путь прямой записи в обёртке Tauri (Этап 7.5) — аналог fileHandle */
  desktopPath: string | null

  /** Загрузить книгу из IO (файл/фикстура/сессия) — полный сброс состояния. */
  loadBook: (
    wire: BookWire,
    meta?: { fileName?: string | null; fileFormat?: FileFormat | null; csvDelimiter?: string },
  ) => void
  newBook: () => void
  /** фиксация сохранения: dirty снят, имя/формат/разделитель запомнены */
  markSaved: (
    fileName?: string,
    meta?: { fileFormat?: FileFormat | null; csvDelimiter?: string },
  ) => void
  setFileHandle: (handle: FileSystemFileHandle | null) => void
  setDesktopPath: (path: string | null) => void
  /** стартовый разделитель CSV из настроек (6.3); при открытии файла замещается детектом */
  setCsvDelimiter: (d: string) => void

  activateTab: (index: number) => void
  addTab: () => void
  renameTab: (index: number, name: string) => void
  /** удаление возможно при ≥2 вкладках; возвращает true, если удалила */
  removeTab: (index: number) => boolean
  duplicateTab: (index: number) => void

  seedDemo: () => void
  seedStress: (rows: number, cols: number) => void
  clickCell: (row: number, col: number, opts?: { shift?: boolean; ctrl?: boolean }) => void
  /** перетаскивание расширяет последнюю область от её якоря */
  dragTo: (row: number, col: number) => void
  moveActive: (dr: number, dc: number, opts?: { extend?: boolean; jump?: boolean }) => void
  pageMove: (rowsPerPage: number, dir: 1 | -1, extend?: boolean) => void
  goTo: (row: number, col: number, opts?: { extend?: boolean }) => void
  selectAll: () => void
  /** Esc — снять выделение до активной ячейки (Ф5) */
  escape: () => void
  /** клик по шапке — выделить колонку/строку целиком */
  selectCol: (col: number) => void
  selectRow: (row: number) => void
  /** Delete/Backspace — очистить ячейки выделения (одна транзакция истории) */
  deleteSelection: () => void
  /**
   * Вставка TSV из системного буфера (novagrid-025): блок пишется от активной
   * ячейки, границы листа растут, одна транзакция истории; выделение
   * накрывает вставленный блок.
   */
  pasteText: (text: string) => void
  /**
   * Расширить логические границы активного листа до rows×cols (novagrid-032):
   * «бесконечное» пустое место вправо/вниз при прокрутке к краю. Не правка
   * данных — без истории и флага dirty; экспорт не меняется (он по maxRow/maxCol).
   */
  growSheet: (rows: number, cols: number) => void
  beginEdit: (initial?: string) => void
  /** правка активной ячейки из строки формул (4.3) */
  beginBarEdit: () => void
  setEditValue: (value: string) => void
  /** позиция каретки редактора — для вставки ссылок кликом (novagrid-020) */
  setEditCaret: (caret: number) => void
  /**
   * Режим указания формулы: клик/протяжка по ячейке вставляет её адрес
   * (=A1, при протяжке =A1:B3) в редактируемую формулу на месте каретки.
   */
  pointCell: (row: number, col: number, extend: boolean) => void
  commitEdit: (move: EditMove) => void
  cancelEdit: () => void
  undo: () => void
  redo: () => void
  setAltRange: (r: Range | null) => void

  // ── ширины колонок / автосумма (novagrid-020) ─────────────────────────
  /** ширина колонки в базовых единицах; стандартная — сброс переопределения */
  setColWidth: (col: number, width: number) => void
  /** Σ: запомнить активную ячейку-приёмник и ждать выбора диапазона */
  startSumPick: () => void
  /** Σ: собрать =SUM из текущего выделения и записать в ячейку-приёмник */
  applySumPick: () => void
  cancelSumPick: () => void

  // ── фильтры (Ф3) ──────────────────────────────────────────────────────
  /** установить/заменить фильтр колонки; include, покрывающий все значения, снимается */
  setColumnFilter: (filter: ColumnFilter) => void
  filterByValue: (col: number, value: string) => void
  excludeByValue: (col: number, value: string) => void
  /** добавить значение к существующему include-фильтру колонки (ПКМ, Ф3.2) */
  addValueToFilter: (col: number, value: string) => void
  clearColumnFilter: (col: number) => void
  clearAllFilters: () => void
  /** сортировка видимых строк по колонке (Ф8): значения переставляются в тех же позициях */
  sortColumn: (col: number, dir: 'asc' | 'desc') => void

  // ── поиск (Ф2) ────────────────────────────────────────────────────────
  openSearch: () => void
  closeSearch: () => void
  setSearchQuery: (query: string) => void
  setSearchScope: (scope: SearchScope) => void
  setSearchOptions: (opts: Partial<Pick<SearchOptions, 'caseSensitive' | 'wholeCell'>>) => void
  /** шаг навигации по совпадениям (Enter/Shift+Enter/F3/▲▼), циклично */
  searchStep: (dir: 1 | -1) => void
  /** переход на конкретное совпадение (клик в списке «все листы») */
  gotoHit: (hit: SearchHit) => void

  // ── найти и заменить (Этап 7) ─────────────────────────────────────────
  /** открыть диалог Ctrl+H; запрос наследуется из открытой панели поиска */
  openReplace: () => void
  closeReplace: () => void
  setReplaceQuery: (query: string) => void
  setReplaceField: (
    patch: Partial<
      Pick<ReplaceState, 'replacement' | 'scope' | 'caseSensitive' | 'wholeCell' | 'inFormulas'>
    >,
  ) => void
  /** шаг по совпадениям замены (Enter/Shift+Enter), циклично */
  replaceStep: (dir: 1 | -1) => void
  /** «Заменить»: текущее совпадение → шаг к следующему */
  replaceCurrent: () => void
  /** «Заменить все» в рамках scope; батч по книге — одна Ctrl+Z-транзакция */
  replaceAll: () => void
}

/** Метрики набора ячеек: Σ/n/x̄/мин/макс по числовым значениям (Ф4). */
export function cellsMetrics(
  sheet: SheetModel,
  rows: readonly number[],
  cols: readonly number[],
): SelectionMetrics {
  let total = 0
  let count = 0
  let filled = 0
  let min = null as number | null
  let max = null as number | null
  for (let i = 0; i < rows.length; i++) {
    const raw = getCell(sheet, rows[i], cols[i])
    if (raw !== '') filled++
    // формулы дают результат движка: Sigma в статус-баре видит вычисленное (Этап 4)
    const n = raw.startsWith('=') ? cellNumber(sheet, rows[i], cols[i]) : parseNumber(raw)
    if (n !== null) {
      total += n
      count++
      if (min === null || n < min) min = n
      if (max === null || n > max) max = n
    }
  }
  return { total, count, mean: count > 0 ? total / count : 0, filled, min, max }
}

/**
 * Метрики выделения. Строки, скрытые фильтром, не считаются — как в Excel,
 * Σ в статус-баре агрегирует видимое (КТ-3: «видно 132 строки → Σ показывает
 * сумму»). visible = null — фильтров нет, считаем всё.
 */
export function selectionMetrics(
  sheet: SheetModel,
  selection: Selection,
  visible: readonly number[] | null = null,
): SelectionMetrics {
  // однопроходная агрегация без промежуточных массивов: выделение колонки
  // на 100k строк не должно материализовать 200k координат (Этап 6.1)
  const agg = newMetricsAgg()
  // несмежные Ctrl-области могут пересекаться — ячейка считается один раз
  const dedup = selection.ranges.length > 1 ? new Set<string>() : null
  for (const rg of selection.ranges) {
    const n = normalize(rg)
    for (let r = n.r1; r <= n.r2; r++) {
      if (visible && visibleIndexOf(visible, r) < 0) continue
      for (let c = n.c1; c <= n.c2; c++) {
        if (dedup) {
          const key = `${r}:${c}`
          if (dedup.has(key)) continue
          dedup.add(key)
        }
        aggCell(agg, sheet, r, c)
      }
    }
  }
  return finishMetrics(agg)
}

/** Агрегатор метрик: накапливает Σ/n/x̄/мин/макс потоком, без массива значений. */
interface MetricsAgg {
  total: number
  count: number
  filled: number
  min: number | null
  max: number | null
}

function newMetricsAgg(): MetricsAgg {
  return { total: 0, count: 0, filled: 0, min: null, max: null }
}

function aggCell(agg: MetricsAgg, sheet: SheetModel, row: number, col: number): void {
  const raw = getCell(sheet, row, col)
  if (raw !== '') agg.filled++
  // формулы дают результат движка: Σ в статус-баре видит вычисленное (Этап 4)
  const n = raw.startsWith('=') ? cellNumber(sheet, row, col) : parseNumber(raw)
  if (n !== null) {
    agg.total += n
    agg.count++
    if (agg.min === null || n < agg.min) agg.min = n
    if (agg.max === null || n > agg.max) agg.max = n
  }
}

function finishMetrics(agg: MetricsAgg): SelectionMetrics {
  return {
    total: agg.total,
    count: agg.count,
    mean: agg.count > 0 ? agg.total / agg.count : 0,
    filled: agg.filled,
    min: agg.min,
    max: agg.max,
  }
}

export function rangeMetrics(
  sheet: SheetModel,
  n: NormRange,
  visible: readonly number[] | null = null,
): SelectionMetrics {
  const agg = newMetricsAgg()
  for (let r = n.r1; r <= n.r2; r++) {
    if (visible && visibleIndexOf(visible, r) < 0) continue
    for (let c = n.c1; c <= n.c2; c++) aggCell(agg, sheet, r, c)
  }
  return finishMetrics(agg)
}

/** Демо-данные в духе сценария ТЗ (фамилии + суммы) — чтобы грид жил с первого запуска. */
const DEMO_ROWS: readonly (readonly string[])[] = [
  ['Фамилия', 'Отдел', 'Сумма'],
  ['Иванов', 'Продажи', '10000'],
  ['Петров', 'Логистика', '12500'],
  ['Сидоров', 'Продажи', '8000'],
  ['Кузнецова', 'Бухгалтерия', '15300'],
  ['Смирнов', 'Логистика', '4200'],
  ['Волкова', 'Продажи', '9800'],
]

function sheetFromRows(rows: readonly (readonly string[])[]): SheetModel {
  const cells = new Map<string, string>()
  let maxRow = -1
  let maxCol = -1
  rows.forEach((cellsRow, r) =>
    cellsRow.forEach((v, c) => {
      if (v !== '') {
        cells.set(cellKey(r, c), v)
        maxRow = Math.max(maxRow, r)
        maxCol = Math.max(maxCol, c)
      }
    }),
  )
  return {
    cells,
    styles: new Map(),
    rows: Math.max(MIN_ROWS, rows.length),
    cols: Math.max(MIN_COLS, maxCol + 1, 1),
    maxRow,
    maxCol,
  }
}

/** Ctrl+стрелка: прыжок к краю серии данных (как в Excel). */
function jumpTarget(
  sheet: SheetModel,
  row: number,
  col: number,
  dr: number,
  dc: number,
): { row: number; col: number } {
  const at = (r: number, c: number) => getCell(sheet, r, c) !== ''
  const lastR = sheet.rows - 1
  const lastC = sheet.cols - 1
  let r = row
  let c = col
  const inData = at(r, c)
  for (;;) {
    const nr = Math.min(Math.max(r + dr, 0), lastR)
    const nc = Math.min(Math.max(c + dc, 0), lastC)
    if (nr === r && nc === c) return { row: r, col: c }
    const nextHas = at(nr, nc)
    if (inData && !nextHas) return { row: r, col: c }
    if (!inData && nextHas) return { row: nr, col: nc }
    r = nr
    c = nc
  }
}

function applyChanges(
  sheet: SheetModel,
  changes: readonly CellChange[],
  direction: 'before' | 'after',
): SheetModel {
  // одним клоном Map на весь батч: цепочка withCell была O(n²) и замораживала
  // интерфейс на больших вставках/удалениях (novagrid-035)
  return withCellList(
    sheet,
    changes.map((ch) => ({
      row: ch.row,
      col: ch.col,
      value: direction === 'before' ? ch.before : ch.after,
    })),
  )
}

/** История правок — по вкладкам (delta-стек экономен: клонируются только изменения). */
const histories = new Map<string, History>()

/** Фильтры — тоже по вкладкам (id), но живут в state для активной (как sheet). */
const tabFilters = new Map<string, ColumnFilter[]>()

/** Якорь курсора фильтра — по вкладкам (id), как фильтры (novagrid-034). */
const tabFilterAnchors = new Map<string, { row: number; col: number } | null>()

/** Ширины колонок — по вкладкам (id), как фильтры (novagrid-020). */
const tabColWidths = new Map<string, ReadonlyMap<number, number>>()

function historyOf(tabId: string): History {
  let h = histories.get(tabId)
  if (!h) {
    h = new History()
    histories.set(tabId, h)
  }
  return h
}

function clearHistories(): void {
  histories.clear()
  tabFilters.clear()
  tabFilterAnchors.clear()
  tabColWidths.clear()
}

const initialTab = createTab(DEFAULT_SHEET_NAME)

const EMPTY_SEARCH: SearchState = {
  open: false,
  query: '',
  scope: 'sheet',
  caseSensitive: false,
  wholeCell: false,
  hits: [],
  hitSet: new Set(),
  index: 0,
}

const EMPTY_REPLACE: ReplaceState = {
  open: false,
  query: '',
  replacement: '',
  scope: 'sheet',
  caseSensitive: false,
  wholeCell: false,
  inFormulas: false,
  hits: [],
  index: 0,
  lastCount: null,
  replacedKeys: new Set(),
}

/** Счётчик меток сквозных транзакций («заменить все» по книге, Этап 7). */
let replaceGroupSeq = 0

export const gridStore = createStore<GridState>((set, get) => {
  /** Записать новый лист модели в активную вкладку (держит инвариант sheet). */
  const patchSheet = (sheet: SheetModel) => {
    const { tabs, activeTab } = get()
    set({ tabs: tabs.map((t, i) => (i === activeTab ? { ...t, sheet } : t)), sheet })
  }

  /**
   * Правка листа с пересчётом формул (4.2): значения вычисляются ДО set —
   * канвас и панели читают готовое; инкрементально, по зависимостям.
   */
  const commitSheet = (prev: SheetModel, next: SheetModel, changes: readonly CellChange[]) => {
    applyFormulaChanges(prev, next, changes)
    patchSheet(next)
  }

  /** Сохранить фильтры и ширины колонок активной вкладки (перед сменой). */
  const saveFilters = () => {
    const { tabs, activeTab, filters, colWidths, filterAnchor } = get()
    tabFilters.set(tabs[activeTab].id, filters)
    tabFilterAnchors.set(tabs[activeTab].id, filterAnchor)
    tabColWidths.set(tabs[activeTab].id, colWidths ?? new Map())
  }

  /**
   * Переходы «без фильтров ↔ с фильтрами» (novagrid-034): первый фильтр
   * запоминает активную ячейку (якорь «где я был»), снятие последнего —
   * возвращает на неё курсор. Дальнейшие фильтры якорь не трогают: якорь —
   * именно место до фильтрации. Возвращает патч для set (selection/якорь).
   */
  const applyFilterAnchor = (
    prevFilters: readonly ColumnFilter[],
    nextFilters: readonly ColumnFilter[],
  ): Partial<GridState> => {
    const { selection, sheet, tabs, activeTab } = get()
    const had = prevFilters.some(isActiveFilter)
    const has = nextFilters.some(isActiveFilter)
    if (!had && has) {
      const anchor = selection.active
      tabFilterAnchors.set(tabs[activeTab].id, anchor)
      return { filterAnchor: anchor }
    }
    if (had && !has) {
      const anchor = tabFilterAnchors.get(tabs[activeTab].id) ?? null
      tabFilterAnchors.delete(tabs[activeTab].id)
      if (!anchor) return { filterAnchor: null }
      // границы листа за время фильтра могли измениться (growSheet при
      // прокрутке) — якорь клампится, но не теряется
      const target = clampRef(anchor, sheet.rows, sheet.cols)
      return { filterAnchor: null, selection: selectionOf(target.row, target.col) }
    }
    return {}
  }

  /**
   * Пересчёт совпадений поиска — инкрементальность Ф2: после каждой правки,
   * смены листа, фильтра и параметров. Скрытые фильтром строки не ищутся.
   */
  const refreshSearch = () => {
    const st = get()
    const { open, query, scope, caseSensitive, wholeCell, index } = st.search
    if (!open || query === '') {
      if (st.search.hits.length > 0)
        set({ search: { ...st.search, hits: [], hitSet: new Set(), index: 0 } })
      return
    }
    const opts: SearchOptions = { caseSensitive, wholeCell }
    const hits =
      scope === 'book'
        ? searchBook(
            st.tabs.map((t) => ({ sheet: t.sheet, filters: tabFilters.get(t.id) })),
            query,
            opts,
          )
        : searchSheet(st.sheet, query, opts, visibleRowsOf(st.sheet, st.filters)).map((h) => ({
            ...h,
            tab: st.activeTab,
          }))
    const hitSet = new Set<string>()
    for (const h of hits) if (h.tab === st.activeTab) hitSet.add(`${h.row}:${h.col}`)
    set({
      search: {
        ...st.search,
        hits,
        hitSet,
        index: Math.min(index, Math.max(hits.length - 1, 0)),
      },
    })
  }

  /** Показать совпадение: перейти на его лист (если другой) и выбрать ячейку. */
  const focusHit = (hit: SearchHit) => {
    if (hit.tab !== get().activeTab) get().activateTab(hit.tab)
    get().goTo(hit.row, hit.col)
  }

  /**
   * Пересчёт совпадений «Найти и заменить» — как у поиска, после каждой
   * правки/смены листа/фильтра/параметров. Режим формул ищет по тексту
   * формулы (core/replace), поэтому свой проход, а не searchBook.
   */
  const refreshReplace = () => {
    const st = get()
    const r = st.replace
    if (!r.open || r.query === '') {
      if (r.hits.length > 0) set({ replace: { ...r, hits: [], index: 0 } })
      return
    }
    const opts: ReplaceOptions = {
      caseSensitive: r.caseSensitive,
      wholeCell: r.wholeCell,
      inFormulas: r.inFormulas,
    }
    const hits =
      r.scope === 'book'
        ? replaceHitsInBook(
            st.tabs.map((t) => ({ sheet: t.sheet, filters: tabFilters.get(t.id) })),
            r.query,
            opts,
          )
        : replaceHitsInSheet(st.sheet, r.query, opts, visibleRowsOf(st.sheet, st.filters)).map(
            (h) => ({ ...h, tab: st.activeTab }),
          )
    set({
      replace: { ...r, hits, index: Math.min(r.index, Math.max(hits.length - 1, 0)) },
    })
  }

  /** Записать новый лист модели в произвольную вкладку (инвариант sheet). */
  const patchTab = (tabIndex: number, sheet: SheetModel) => {
    const { tabs, activeTab } = get()
    set({
      tabs: tabs.map((t, i) => (i === tabIndex ? { ...t, sheet } : t)),
      ...(tabIndex === activeTab ? { sheet } : {}),
    })
  }

  /**
   * Применить записи истории к вкладкам в направлении before/after
   * (undo/redo): пересчёт формул инкрементальный, вкладки могут быть
   * неактивными. Одна сквозная транзакция снимается целиком (Этап 7).
   */
  const applyHistoryEntries = (
    targets: readonly { index: number; entry: HistoryEntry }[],
    direction: 'before' | 'after',
  ) => {
    if (targets.length === 0) return
    const activeTab = get().activeTab
    let tabsArr = get().tabs
    let activeSheet: SheetModel | null = null
    for (const { index, entry } of targets) {
      const prev = tabsArr[index].sheet
      const next = applyChanges(prev, entry.changes, direction)
      applyFormulaChanges(prev, next, entry.changes)
      tabsArr = tabsArr.map((t, i) => (i === index ? { ...t, sheet: next } : t))
      if (index === activeTab) activeSheet = next
    }
    set({
      tabs: tabsArr,
      ...(activeSheet ? { sheet: activeSheet } : {}),
      edit: null,
      altRange: null,
      dirty: true,
    })
    refreshSearch()
    refreshReplace()
  }

  /**
   * «Заменить все» в рамках scope: общий путь для листа и книги. По книге —
   * по записи в историю каждой затронутой вкладки с общей меткой group,
   * чтобы один Ctrl+Z откатил весь батч (applyHistoryEntries).
   */
  const runReplaceAll = () => {
    const st = get()
    const r = st.replace
    const done = (count: number) =>
      set({ replace: { ...get().replace, lastCount: count, replacedKeys: new Set() } })
    if (r.query === '') {
      done(0)
      return
    }
    const opts: ReplaceOptions = {
      caseSensitive: r.caseSensitive,
      wholeCell: r.wholeCell,
      inFormulas: r.inFormulas,
    }
    if (r.scope === 'sheet') {
      const prev = st.sheet
      const changes = replaceAllInSheet(
        prev,
        r.query,
        r.replacement,
        opts,
        visibleRowsOf(prev, st.filters),
      )
      if (changes.length > 0) {
        historyOf(st.tabs[st.activeTab].id).push({ label: 'replace-all', changes })
        commitSheet(prev, applyChanges(prev, changes, 'after'), changes)
        set({ dirty: true })
      }
      done(changes.length)
      refreshReplace()
      refreshSearch()
      return
    }
    const group = `replace-all-${++replaceGroupSeq}`
    let total = 0
    let tabsArr = st.tabs
    let activeSheet: SheetModel | null = null
    tabsArr.forEach((tab, i) => {
      const changes = replaceAllInSheet(
        tab.sheet,
        r.query,
        r.replacement,
        opts,
        visibleRowsOf(tab.sheet, tabFilters.get(tab.id) ?? []),
      )
      if (changes.length === 0) return
      total += changes.length
      historyOf(tab.id).push({ label: 'replace-all', changes, group })
      const prev = tab.sheet
      const next = applyChanges(prev, changes, 'after')
      applyFormulaChanges(prev, next, changes)
      tabsArr = tabsArr.map((t, j) => (j === i ? { ...t, sheet: next } : t))
      if (i === st.activeTab) activeSheet = next
    })
    if (total > 0) {
      set({
        tabs: tabsArr,
        ...(activeSheet ? { sheet: activeSheet } : {}),
        dirty: true,
      })
    }
    done(total)
    refreshReplace()
    refreshSearch()
  }

  return {
    tabs: [initialTab],
    activeTab: 0,
    sheet: initialTab.sheet,
    selection: selectionOf(0, 0),
    edit: null,
    altRange: null,
    filters: [],
    filterAnchor: null,
    colWidths: null,
    sumPick: null,
    search: EMPTY_SEARCH,
    replace: EMPTY_REPLACE,
    fileName: null,
    fileFormat: null,
    csvDelimiter: ';',
    dirty: false,
    fileHandle: null,
    desktopPath: null,

    loadBook: (wire, meta) => {
      const tabs = tabsFromWire(wire)
      // запас пустого места за контентом (novagrid-032): открытая таблица
      // всегда продолжается пустыми ячейками вправо и вниз
      tabs.forEach((t) => {
        t.sheet = withSpace(t.sheet)
      })
      const sheets = tabs.length > 0 ? tabs : [createTab(DEFAULT_SHEET_NAME)]
      sheets.forEach((t) => recalcSheet(t.sheet))
      clearHistories()
      set({
        tabs: sheets,
        activeTab: 0,
        sheet: sheets[0].sheet,
        selection: selectionOf(0, 0),
        edit: null,
        altRange: null,
        filters: [],
        filterAnchor: null,
        colWidths: null,
        sumPick: null,
        search: EMPTY_SEARCH,
        replace: EMPTY_REPLACE,
        fileName: meta?.fileName ?? null,
        fileFormat: meta?.fileFormat ?? null,
        csvDelimiter: meta?.csvDelimiter ?? ';',
        dirty: false,
        fileHandle: null,
        desktopPath: null,
      })
    },

    newBook: () => {
      get().loadBook({ sheets: [{ name: DEFAULT_SHEET_NAME, sheet: createSheet() }] })
    },

    markSaved: (fileName, meta) => {
      set({
        dirty: false,
        fileName: fileName ?? get().fileName,
        ...(meta?.fileFormat !== undefined ? { fileFormat: meta.fileFormat } : {}),
        ...(meta?.csvDelimiter !== undefined ? { csvDelimiter: meta.csvDelimiter } : {}),
      })
    },

    setFileHandle: (handle) => set({ fileHandle: handle }),
    setDesktopPath: (path) => set({ desktopPath: path }),
    setCsvDelimiter: (d) => set({ csvDelimiter: d }),

    activateTab: (index) => {
      const { tabs } = get()
      const i = Math.min(Math.max(index, 0), tabs.length - 1)
      if (get().edit) get().commitEdit('none')
      saveFilters()
      const savedWidths = tabColWidths.get(tabs[i].id)
      set({
        activeTab: i,
        sheet: tabs[i].sheet,
        selection: selectionOf(0, 0),
        edit: null,
        altRange: null,
        filters: tabFilters.get(tabs[i].id) ?? [],
        filterAnchor: tabFilterAnchors.get(tabs[i].id) ?? null,
        colWidths: savedWidths && savedWidths.size > 0 ? savedWidths : null,
        sumPick: null,
      })
      refreshSearch()
    },

    addTab: () => {
      const { tabs, activeTab } = get()
      const name = uniqueTabName(
        tabs.map((t) => t.name),
        `Лист ${tabs.length + 1}`,
      )
      const tab = createTab(name)
      if (get().edit) get().commitEdit('none')
      saveFilters()
      set({
        tabs: [...tabs.slice(0, activeTab + 1), tab, ...tabs.slice(activeTab + 1)],
        activeTab: activeTab + 1,
        sheet: tab.sheet,
        selection: selectionOf(0, 0),
        edit: null,
        altRange: null,
        filters: [],
        filterAnchor: null,
        colWidths: null,
        sumPick: null,
        dirty: true,
      })
      refreshSearch()
    },

    renameTab: (index, name) => {
      const { tabs } = get()
      const clean = sanitizeSheetName(name)
      if (!clean) return
      const others = tabs.filter((_, i) => i !== index).map((t) => t.name)
      const finalName = uniqueTabName(others, clean)
      set({ tabs: tabs.map((t, i) => (i === index ? { ...t, name: finalName } : t)), dirty: true })
    },

    removeTab: (index) => {
      const { tabs, activeTab } = get()
      if (tabs.length <= 1) return false
      const removed = tabs[index]
      const next = tabs.filter((_, i) => i !== index)
      histories.delete(removed.id)
      tabFilters.delete(removed.id)
      tabFilterAnchors.delete(removed.id)
      tabColWidths.delete(removed.id)
      const nextActive = index < activeTab ? activeTab - 1 : Math.min(activeTab, next.length - 1)
      if (get().edit) get().cancelEdit()
      const savedWidths = tabColWidths.get(next[nextActive].id)
      set({
        tabs: next,
        activeTab: nextActive,
        sheet: next[nextActive].sheet,
        selection: selectionOf(0, 0),
        edit: null,
        altRange: null,
        filters: tabFilters.get(next[nextActive].id) ?? [],
        filterAnchor: tabFilterAnchors.get(next[nextActive].id) ?? null,
        colWidths: savedWidths && savedWidths.size > 0 ? savedWidths : null,
        sumPick: null,
        dirty: true,
      })
      refreshSearch()
      return true
    },

    duplicateTab: (index) => {
      const { tabs } = get()
      const src = tabs[index]
      const copy: SheetTab = {
        id: newTabId(),
        name: uniqueTabName(
          tabs.map((t) => t.name),
          src.name,
        ),
        sheet: {
          cells: new Map(src.sheet.cells),
          styles: new Map(src.sheet.styles),
          formulaCache: src.sheet.formulaCache
            ? new Map(src.sheet.formulaCache)
            : undefined,
          rows: src.sheet.rows,
          cols: src.sheet.cols,
          maxRow: src.sheet.maxRow,
          maxCol: src.sheet.maxCol,
        },
      }
      recalcSheet(copy.sheet)
      if (get().edit) get().commitEdit('none')
      saveFilters()
      const copyWidths = new Map(tabColWidths.get(src.id) ?? [])
      tabColWidths.set(copy.id, copyWidths)
      set({
        tabs: [...tabs.slice(0, index + 1), copy, ...tabs.slice(index + 1)],
        activeTab: index + 1,
        sheet: copy.sheet,
        selection: selectionOf(0, 0),
        edit: null,
        altRange: null,
        filters: [],
        filterAnchor: null,
        colWidths: copyWidths.size > 0 ? copyWidths : null,
        sumPick: null,
        dirty: true,
      })
      refreshSearch()
    },

    seedDemo: () => {
      get().loadBook({
        sheets: [{ name: DEFAULT_SHEET_NAME, sheet: sheetFromRows(DEMO_ROWS) }],
      })
    },

    seedStress: (rows, cols) => {
      // стресс-режим проверки виртуализации: числовая колонка A на всю глубину.
      // Map строится за один проход — иммутабельный withCell на 100k ячеек дал бы O(n²)
      const cells = new Map<string, string>()
      for (let r = 0; r < rows; r++) cells.set(cellKey(r, 0), String(r + 1))
      get().loadBook({
        sheets: [
          {
            name: DEFAULT_SHEET_NAME,
            sheet: {
              cells,
              styles: new Map(),
              rows: Math.max(rows, 1),
              cols: Math.max(cols, 1),
              maxRow: rows - 1,
              maxCol: 0,
            },
          },
        ],
      })
    },

    clickCell: (row, col, opts) => {
      const { selection } = get()
      // клик во время правки фиксирует её (как в Excel), а не отбрасывает
      if (get().edit) get().commitEdit('none')
      if (opts?.shift) {
        // расширение от якоря последней области
        const ranges = [...selection.ranges]
        ranges[ranges.length - 1] = { ...ranges[ranges.length - 1], tr: row, tc: col }
        set({ selection: { ...selection, ranges } })
        return
      }
      if (opts?.ctrl) {
        // Ctrl-клик: несмежная область (Ф5); повторный клик по одиночной области снимает её
        const hit = selection.ranges.findIndex(
          (rg) => rg.fr === rg.tr && rg.fc === rg.tc && rg.fr === row && rg.fc === col,
        )
        if (hit >= 0 && selection.ranges.length > 1) {
          set({ selection: { ...selection, ranges: selection.ranges.filter((_, i) => i !== hit) } })
          return
        }
        if (hit >= 0) {
          set({ selection: selectionOf(row, col) })
          return
        }
        set({
          selection: {
            ...selection,
            active: { row, col },
            ranges: [...selection.ranges, range(row, col)],
          },
        })
        return
      }
      set({ selection: selectionOf(row, col) })
    },

    selectCol: (col) => {
      const { sheet } = get()
      if (get().edit) get().commitEdit('none')
      set({
        selection: {
          active: { row: 0, col },
          ranges: [{ fr: 0, fc: col, tr: sheet.rows - 1, tc: col }],
        },
      })
    },

    selectRow: (row) => {
      const { sheet } = get()
      if (get().edit) get().commitEdit('none')
      set({
        selection: {
          active: { row, col: 0 },
          ranges: [{ fr: row, fc: 0, tr: row, tc: sheet.cols - 1 }],
        },
      })
    },

    dragTo: (row, col) => {
      const { selection } = get()
      const ranges = [...selection.ranges]
      ranges[ranges.length - 1] = { ...ranges[ranges.length - 1], tr: row, tc: col }
      set({ selection: { ...selection, ranges } })
    },

    moveActive: (dr, dc, opts) => {
      const state = get()
      const { sheet, selection } = state
      // Shift-растяжение идёт от движущегося конца последней области, а не от
      // активной ячейки-якоря: иначе каждый Shift-стрелка пересчитывает конец
      // от того же якоря и диапазон не растёт дальше двух ячеек (novagrid-024)
      const last = selection.ranges[selection.ranges.length - 1]
      const from = opts?.extend ? { row: last.tr, col: last.tc } : selection.active
      const target = opts?.jump
        ? jumpTarget(sheet, from.row, from.col, dr, dc)
        : clampRef({ row: from.row + dr, col: from.col + dc }, sheet.rows, sheet.cols)
      // скрытые фильтром строки навигация пропускает — активная ячейка видима
      const visible = visibleRowsOf(sheet, state.filters)
      const row = visible ? nearestVisibleRow(visible, target.row, dr !== 0 ? dr : 1) : target.row
      if (opts?.extend) {
        const ranges = [...selection.ranges]
        ranges[ranges.length - 1] = { ...last, tr: row, tc: target.col }
        set({ selection: { ...selection, ranges } })
      } else {
        set({ selection: selectionOf(row, target.col) })
      }
    },

    pageMove: (rowsPerPage, dir, extend) => {
      get().moveActive(dir * rowsPerPage, 0, { extend })
    },

    goTo: (row, col, opts) => {
      const { sheet, selection } = get()
      const target = clampRef({ row, col }, sheet.rows, sheet.cols)
      if (opts?.extend) {
        const ranges = [...selection.ranges]
        ranges[ranges.length - 1] = { ...ranges[ranges.length - 1], tr: target.row, tc: target.col }
        set({ selection: { ...selection, ranges } })
      } else {
        set({ selection: selectionOf(target.row, target.col) })
      }
    },

    selectAll: () => {
      const { sheet, selection } = get()
      set({
        selection: {
          active: selection.active,
          ranges: [{ fr: 0, fc: 0, tr: Math.max(sheet.maxRow, 0), tc: Math.max(sheet.maxCol, 0) }],
        },
      })
    },

    escape: () => {
      const { selection } = get()
      set({
        selection: selectionOf(selection.active.row, selection.active.col),
        altRange: null,
        sumPick: null,
      })
    },

    deleteSelection: () => {
      const state = get()
      const { sheet, selection, activeTab, tabs } = state
      const { rows, cols } = selectedCells(selection)
      const changes: CellChange[] = []
      for (let i = 0; i < rows.length; i++) {
        const before = getCell(sheet, rows[i], cols[i])
        if (before !== '') changes.push({ row: rows[i], col: cols[i], before, after: '' })
      }
      if (changes.length === 0) return
      historyOf(tabs[activeTab].id).push({ label: 'clear', changes })
      commitSheet(sheet, applyChanges(sheet, changes, 'after'), changes)
      set({ dirty: true })
      refreshSearch()
    },

    pasteText: (text) => {
      const grid = parseClipboardTsv(text)
      if (grid.length === 0) return
      const state = get()
      const { sheet, selection, activeTab, tabs } = state
      const { row, col } = selection.active
      const changes: CellChange[] = []
      grid.forEach((cells, dr) =>
        cells.forEach((v, dc) => {
          const r = row + dr
          const c = col + dc
          const before = getCell(sheet, r, c)
          if (before !== v) changes.push({ row: r, col: c, before, after: v })
        }),
      )
      if (changes.length > 0) {
        historyOf(tabs[activeTab].id).push({ label: 'paste', changes })
        // withSpace: вставленный блок не упирается в край — за ним снова
        // пустое место (novagrid-032)
        commitSheet(sheet, withSpace(applyChanges(sheet, changes, 'after')), changes)
        set({ dirty: true })
      }
      // выделение накрывает вставленный блок — видно, что и куда легло (как Excel)
      const lastRow = row + grid.length - 1
      const lastCol = col + Math.max(...grid.map((cells) => cells.length)) - 1
      set({
        selection: { active: { row, col }, ranges: [{ fr: row, fc: col, tr: lastRow, tc: lastCol }] },
      })
      refreshSearch()
    },

    growSheet: (rows, cols) => {
      const { sheet } = get()
      const next = {
        ...sheet,
        rows: Math.min(MAX_ROWS, Math.max(sheet.rows, Math.round(rows))),
        cols: Math.min(MAX_COLS, Math.max(sheet.cols, Math.round(cols))),
      }
      if (next.rows === sheet.rows && next.cols === sheet.cols) return
      patchSheet(next)
    },

    beginEdit: (initial) => {
      const { sheet, selection } = get()
      const { row, col } = selection.active
      const given = initial !== undefined
      set({
        edit: {
          row,
          col,
          value: given ? initial : getCell(sheet, row, col),
          mode: given ? 'replace' : 'append',
        },
      })
    },

    beginBarEdit: () => {
      const state = get()
      if (state.edit) {
        if (state.edit.source === 'bar') return
        state.commitEdit('none') // правка ячейки фиксируется, как в Excel
      }
      const st = get()
      const { row, col } = st.selection.active
      set({
        edit: {
          row,
          col,
          value: getCell(st.sheet, row, col),
          mode: 'append',
          source: 'bar',
        },
      })
    },

    setEditValue: (value) => {
      const { edit } = get()
      // ручной ввод сбрасывает жест указания — протяжка больше не заменит текст
      if (edit) set({ edit: { ...edit, value, pointSpan: undefined, pointAnchor: undefined } })
    },

    setEditCaret: (caret) => {
      const { edit } = get()
      if (edit && edit.caret !== caret) set({ edit: { ...edit, caret } })
    },

    pointCell: (row, col, extend) => {
      const { edit, selection } = get()
      if (!edit) return
      const name = cellRefName(row, col)
      if (!extend) {
        const caret = edit.caret ?? edit.value.length
        const value = edit.value.slice(0, caret) + name + edit.value.slice(caret)
        set({
          edit: {
            ...edit,
            value,
            caret: caret + name.length,
            pointSpan: { start: caret, end: caret + name.length },
            pointAnchor: { row, col },
          },
          selection: { active: selection.active, ranges: [{ fr: row, fc: col, tr: row, tc: col }] },
        })
        return
      }
      const span = edit.pointSpan
      const anchor = edit.pointAnchor
      if (!span || !anchor) return
      const text =
        anchor.row === row && anchor.col === col
          ? name
          : `${cellRefName(anchor.row, anchor.col)}:${name}`
      const value = edit.value.slice(0, span.start) + text + edit.value.slice(span.end)
      set({
        edit: {
          ...edit,
          value,
          caret: span.start + text.length,
          pointSpan: { start: span.start, end: span.start + text.length },
        },
        selection: {
          active: selection.active,
          ranges: [{ fr: anchor.row, fc: anchor.col, tr: row, tc: col }],
        },
      })
    },

    commitEdit: (move) => {
      const state = get()
      const { edit, sheet, tabs, activeTab } = state
      if (!edit) return
      const before = getCell(sheet, edit.row, edit.col)
      let next = sheet
      if (edit.value !== before) {
        const changes: CellChange[] = [{ row: edit.row, col: edit.col, before, after: edit.value }]
        historyOf(tabs[activeTab].id).push({ label: 'edit', changes })
        next = applyChanges(sheet, changes, 'after')
        commitSheet(sheet, next, changes)
        set({ dirty: true })
      }
      const [dr, dc] = MOVE_DELTA[move]
      const target = clampRef({ row: edit.row + dr, col: edit.col + dc }, next.rows, next.cols)
      set({ edit: null, selection: selectionOf(target.row, target.col) })
      refreshSearch()
    },

    cancelEdit: () => {
      const { edit, selection } = get()
      // после указания ссылок выделение-подсказка сворачивается к активной
      set({
        edit: null,
        ...(edit ? { selection: selectionOf(selection.active.row, selection.active.col) } : {}),
      })
    },

    undo: () => {
      const state = get()
      const { tabs, activeTab } = state
      const history = historyOf(tabs[activeTab].id)
      const top = history.peek()
      if (!top) return
      // сквозная транзакция (Этап 7): снимаем со всех вкладок с этой меткой —
      // батч «заменить все» по книге откатывается одним Ctrl+Z
      const targets: { index: number; entry: HistoryEntry }[] = []
      if (top.group) {
        tabs.forEach((tab, i) => {
          const h = historyOf(tab.id)
          if (h.peek()?.group === top.group) {
            const entry = h.undo()
            if (entry) targets.push({ index: i, entry })
          }
        })
      } else {
        const entry = history.undo()
        if (entry) targets.push({ index: activeTab, entry })
      }
      applyHistoryEntries(targets, 'before')
    },

    redo: () => {
      const state = get()
      const { tabs, activeTab } = state
      const history = historyOf(tabs[activeTab].id)
      const top = history.peekRedo()
      if (!top) return
      const targets: { index: number; entry: HistoryEntry }[] = []
      if (top.group) {
        tabs.forEach((tab, i) => {
          const h = historyOf(tab.id)
          if (h.peekRedo()?.group === top.group) {
            const entry = h.redo()
            if (entry) targets.push({ index: i, entry })
          }
        })
      } else {
        const entry = history.redo()
        if (entry) targets.push({ index: activeTab, entry })
      }
      applyHistoryEntries(targets, 'after')
    },

    setAltRange: (r) => set({ altRange: r }),

    // ── ширины колонок / автосумма (novagrid-020) ────────────────────────
    setColWidth: (col, width) => {
      if (col < 0) return
      const next = new Map(get().colWidths ?? [])
      const clamped = Math.min(COL_W_MAX, Math.max(COL_W_MIN, Math.round(width)))
      if (clamped === BASE_COL_W) next.delete(col)
      else next.set(col, clamped)
      set({ colWidths: next.size > 0 ? next : null })
    },

    startSumPick: () => {
      if (get().edit) get().commitEdit('none')
      const { selection } = get()
      set({ sumPick: { row: selection.active.row, col: selection.active.col } })
    },

    applySumPick: () => {
      const st = get()
      if (!st.sumPick) return
      const target = st.sumPick
      const parts = st.selection.ranges
        .map((rg) => normalize(rg))
        // одиночную область «сам на себя» пропускаем — не даём =SUM(D1) в D1
        .filter((n) => !(n.r1 === target.row && n.c1 === target.col && n.r2 === n.r1 && n.c2 === n.c1))
        .map((n) =>
          n.r1 === n.r2 && n.c1 === n.c2
            ? cellRefName(n.r1, n.c1)
            : `${cellRefName(n.r1, n.c1)}:${cellRefName(n.r2, n.c2)}`,
        )
      if (parts.length === 0) return // клик по самой ячейке-приёмнику — режим ждёт дальше
      const formula = `=SUM(${parts.join(';')})`
      const before = getCell(st.sheet, target.row, target.col)
      if (before !== formula) {
        const changes: CellChange[] = [{ row: target.row, col: target.col, before, after: formula }]
        historyOf(st.tabs[st.activeTab].id).push({ label: 'autosum', changes })
        commitSheet(st.sheet, applyChanges(st.sheet, changes, 'after'), changes)
        set({ dirty: true })
      }
      set({ sumPick: null, selection: selectionOf(target.row, target.col) })
      refreshSearch()
    },

    cancelSumPick: () => {
      if (get().sumPick) set({ sumPick: null })
    },

    // ── фильтры (Ф3) ────────────────────────────────────────────────────
    setColumnFilter: (filter) => {
      const { sheet, filters } = get()
      let next = filters.filter((f) => f.col !== filter.col)
      // «выбраны все значения» == фильтра нет: иначе новые значения скроются
      if (filter.mode === 'include') {
        const distinct = new Set(columnValueCounts(sheet, filter.col).map((v) => v.value))
        const covers =
          filter.values.length >= distinct.size && filter.values.every((v) => distinct.has(v))
        if (covers) {
          set({ filters: next, ...applyFilterAnchor(filters, next) })
          refreshSearch()
          return
        }
      }
      next = [...next, filter].sort((a, b) => a.col - b.col)
      set({ filters: next, ...applyFilterAnchor(filters, next) })
      refreshSearch()
    },

    filterByValue: (col, value) => {
      get().setColumnFilter({ col, mode: 'include', values: [value] })
    },

    excludeByValue: (col, value) => {
      get().setColumnFilter({ col, mode: 'exclude', values: [value] })
    },

    addValueToFilter: (col, value) => {
      const ex = get().filters.find((f) => f.col === col && f.mode === 'include')
      if (!ex) {
        get().filterByValue(col, value)
        return
      }
      if (!ex.values.includes(value)) {
        get().setColumnFilter({ ...ex, values: [...ex.values, value] })
      }
    },

    clearColumnFilter: (col) => {
      const { filters } = get()
      if (!filters.some((f) => f.col === col)) return
      const next = filters.filter((f) => f.col !== col)
      set({ filters: next, ...applyFilterAnchor(filters, next) })
      refreshSearch()
    },

    clearAllFilters: () => {
      const { filters } = get()
      if (filters.length === 0) return
      set({ filters: [], ...applyFilterAnchor(filters, []) })
      refreshSearch()
    },

    sortColumn: (col, dir) => {
      const state = get()
      const { sheet, filters, tabs, activeTab } = state
      const visible = visibleRowsOf(sheet, filters)
      const rows = visible ?? Array.from({ length: sheet.maxRow + 1 }, (_, r) => r)
      // пустые остаются на местах (Excel держит их в конце при любом направлении);
      // стили не переставляются — в этой модели стиль привязан к позиции (шапка),
      // зато undo честно возвращает всё
      const filled = rows.map((r) => ({ r, v: getCell(sheet, r, col) })).filter((x) => x.v !== '')
      const sorted = [...filled].sort((a, b) =>
        dir === 'asc' ? compareCellValues(a.v, b.v) : -compareCellValues(a.v, b.v),
      )
      const changes: CellChange[] = []
      for (let i = 0; i < filled.length; i++) {
        if (filled[i].v !== sorted[i].v) {
          changes.push({ row: filled[i].r, col, before: filled[i].v, after: sorted[i].v })
        }
      }
      if (changes.length === 0) return
      historyOf(tabs[activeTab].id).push({ label: 'sort', changes })
      commitSheet(sheet, applyChanges(sheet, changes, 'after'), changes)
      set({ dirty: true })
      refreshSearch()
    },

    // ── поиск (Ф2) ──────────────────────────────────────────────────────
    openSearch: () => {
      const { search } = get()
      if (!search.open) set({ search: { ...search, open: true } })
      refreshSearch()
    },

    closeSearch: () => {
      const { search } = get()
      set({ search: { ...search, open: false, hits: [], hitSet: new Set(), index: 0 } })
    },

    setSearchQuery: (query) => {
      set({ search: { ...get().search, query, index: 0 } })
      refreshSearch()
    },

    setSearchScope: (scope) => {
      set({ search: { ...get().search, scope, index: 0 } })
      refreshSearch()
    },

    setSearchOptions: (opts) => {
      set({ search: { ...get().search, ...opts, index: 0 } })
      refreshSearch()
    },

    searchStep: (dir) => {
      const { search } = get()
      if (search.hits.length === 0) return
      const next = (search.index + dir + search.hits.length) % search.hits.length
      set({ search: { ...search, index: next } })
      focusHit(search.hits[next])
    },

    gotoHit: (hit) => {
      const { search } = get()
      const idx = search.hits.findIndex(
        (h) => h.tab === hit.tab && h.row === hit.row && h.col === hit.col,
      )
      set({ search: { ...search, index: idx >= 0 ? idx : search.index } })
      focusHit(hit)
    },

    // ── найти и заменить (Этап 7) ───────────────────────────────────────
    openReplace: () => {
      const st = get()
      // один поисковый UI за раз: панель поиска закрывается, её запрос
      // наследуется диалогом (Ctrl+F → Ctrl+H — продолжить тем же словом)
      if (st.search.open) st.closeSearch()
      const query = st.search.query !== '' ? st.search.query : st.replace.query
      set({
        replace: {
          ...st.replace,
          open: true,
          query,
          hits: [],
          index: 0,
          lastCount: null,
          replacedKeys: new Set(),
        },
      })
      refreshReplace()
    },

    closeReplace: () => {
      const r = get().replace
      set({ replace: { ...r, open: false, hits: [], index: 0, lastCount: null } })
    },

    setReplaceQuery: (query) => {
      set({
        replace: { ...get().replace, query, index: 0, lastCount: null, replacedKeys: new Set() },
      })
      refreshReplace()
    },

    setReplaceField: (patch) => {
      set({
        replace: { ...get().replace, ...patch, index: 0, lastCount: null, replacedKeys: new Set() },
      })
      refreshReplace()
    },

    replaceStep: (dir) => {
      const r = get().replace
      if (r.hits.length === 0) return
      const next = (r.index + dir + r.hits.length) % r.hits.length
      set({ replace: { ...r, index: next } })
      focusHit(r.hits[next])
    },

    replaceCurrent: () => {
      const st = get()
      const r = st.replace
      const hit = r.hits[r.index]
      if (!hit || r.query === '') return
      const tab = st.tabs[hit.tab]
      const prev = tab.sheet
      const opts: ReplaceOptions = {
        caseSensitive: r.caseSensitive,
        wholeCell: r.wholeCell,
        inFormulas: r.inFormulas,
      }
      const hitKey = `${hit.tab}:${hit.row}:${hit.col}`
      const replaced = new Set(r.replacedKeys)
      replaced.add(hitKey)
      const after = replaceCellRaw(prev, hit.row, hit.col, r.query, r.replacement, opts)
      if (after !== null && after !== getCell(prev, hit.row, hit.col)) {
        const changes: CellChange[] = [
          { row: hit.row, col: hit.col, before: getCell(prev, hit.row, hit.col), after },
        ]
        historyOf(tab.id).push({ label: 'replace', changes })
        const next = applyChanges(prev, changes, 'after')
        applyFormulaChanges(prev, next, changes)
        patchTab(hit.tab, next)
        set({ dirty: true, replace: { ...get().replace, lastCount: 1, replacedKeys: replaced } })
      } else {
        set({ replace: { ...get().replace, replacedKeys: replaced } })
      }
      // совпадения пересчитать и шагнуть к следующему: заменённая ячейка
      // исчезает из списка, а если замена снова совпала (Иван → Иванов) —
      // серия «Заменить» обходит её по replacedKeys и не зацикливается
      const wasIndex = r.index
      refreshReplace()
      const next = get().replace
      if (next.hits.length > 0) {
        let idx = Math.min(wasIndex, next.hits.length - 1)
        for (let step = 0; step < next.hits.length; step++) {
          const h = next.hits[idx]
          if (!replaced.has(`${h.tab}:${h.row}:${h.col}`)) break
          idx = (idx + 1) % next.hits.length
        }
        set({ replace: { ...next, index: idx } })
        focusHit(next.hits[idx])
      }
      refreshSearch()
    },

    replaceAll: () => runReplaceAll(),
  }
})

export type GridStore = typeof gridStore
