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
  nearestVisibleRow,
  visibleIndexOf,
  visibleRowsOf,
} from './filter'
import { History, type CellChange } from './history'
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
  MIN_COLS,
  MIN_ROWS,
  type SheetModel,
  cellKey,
  createSheet,
  getCell,
  parseNumber,
  withCell,
} from './sheet'
import { average, sum } from './stats'
import { type SearchHit, type SearchOptions, searchBook, searchSheet } from './search'
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
export type FileFormat = 'xlsx' | 'csv' | 'xls'

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
  /** состояние поиска (Ф2) */
  search: SearchState

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
  beginEdit: (initial?: string) => void
  setEditValue: (value: string) => void
  commitEdit: (move: EditMove) => void
  cancelEdit: () => void
  undo: () => void
  redo: () => void
  setAltRange: (r: Range | null) => void

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
}

/** Метрики набора ячеек: Σ/n/x̄/мин/макс по числовым значениям (Ф4). */
export function cellsMetrics(
  sheet: SheetModel,
  rows: readonly number[],
  cols: readonly number[],
): SelectionMetrics {
  const values: number[] = []
  let filled = 0
  for (let i = 0; i < rows.length; i++) {
    const raw = getCell(sheet, rows[i], cols[i])
    if (raw !== '') filled++
    const n = parseNumber(raw)
    if (n !== null) values.push(n)
  }
  let min = null as number | null
  let max = null as number | null
  for (const v of values) {
    if (min === null || v < min) min = v
    if (max === null || v > max) max = v
  }
  return { total: sum(values), count: values.length, mean: average(values), filled, min, max }
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
  // несмежные Ctrl-области могут пересекаться — ячейка считается один раз
  const dedup = selection.ranges.length > 1 ? new Set<string>() : null
  const rows: number[] = []
  const cols: number[] = []
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
        rows.push(r)
        cols.push(c)
      }
    }
  }
  return cellsMetrics(sheet, rows, cols)
}

export function rangeMetrics(
  sheet: SheetModel,
  n: NormRange,
  visible: readonly number[] | null = null,
): SelectionMetrics {
  const rows: number[] = []
  const cols: number[] = []
  for (let r = n.r1; r <= n.r2; r++) {
    if (visible && visibleIndexOf(visible, r) < 0) continue
    for (let c = n.c1; c <= n.c2; c++) {
      rows.push(r)
      cols.push(c)
    }
  }
  return cellsMetrics(sheet, rows, cols)
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
  let next = sheet
  for (const ch of changes)
    next = withCell(next, ch.row, ch.col, direction === 'before' ? ch.before : ch.after)
  return next
}

/** История правок — по вкладкам (delta-стек экономен: клонируются только изменения). */
const histories = new Map<string, History>()

/** Фильтры — тоже по вкладкам (id), но живут в state для активной (как sheet). */
const tabFilters = new Map<string, ColumnFilter[]>()

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

export const gridStore = createStore<GridState>((set, get) => {
  /** Записать новый лист модели в активную вкладку (держит инвариант sheet). */
  const patchSheet = (sheet: SheetModel) => {
    const { tabs, activeTab } = get()
    set({ tabs: tabs.map((t, i) => (i === activeTab ? { ...t, sheet } : t)), sheet })
  }

  /** Сохранить фильтры активной вкладки в её ячейку хранилища (перед сменой). */
  const saveFilters = () => {
    const { tabs, activeTab, filters } = get()
    tabFilters.set(tabs[activeTab].id, filters)
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

  return {
    tabs: [initialTab],
    activeTab: 0,
    sheet: initialTab.sheet,
    selection: selectionOf(0, 0),
    edit: null,
    altRange: null,
    filters: [],
    search: EMPTY_SEARCH,
    fileName: null,
    fileFormat: null,
    csvDelimiter: ';',
    dirty: false,
    fileHandle: null,

    loadBook: (wire, meta) => {
      const tabs = tabsFromWire(wire)
      const sheets = tabs.length > 0 ? tabs : [createTab(DEFAULT_SHEET_NAME)]
      clearHistories()
      set({
        tabs: sheets,
        activeTab: 0,
        sheet: sheets[0].sheet,
        selection: selectionOf(0, 0),
        edit: null,
        altRange: null,
        filters: [],
        search: EMPTY_SEARCH,
        fileName: meta?.fileName ?? null,
        fileFormat: meta?.fileFormat ?? null,
        csvDelimiter: meta?.csvDelimiter ?? ';',
        dirty: false,
        fileHandle: null,
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

    activateTab: (index) => {
      const { tabs } = get()
      const i = Math.min(Math.max(index, 0), tabs.length - 1)
      if (get().edit) get().commitEdit('none')
      saveFilters()
      set({
        activeTab: i,
        sheet: tabs[i].sheet,
        selection: selectionOf(0, 0),
        edit: null,
        altRange: null,
        filters: tabFilters.get(tabs[i].id) ?? [],
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
      const nextActive = index < activeTab ? activeTab - 1 : Math.min(activeTab, next.length - 1)
      if (get().edit) get().cancelEdit()
      set({
        tabs: next,
        activeTab: nextActive,
        sheet: next[nextActive].sheet,
        selection: selectionOf(0, 0),
        edit: null,
        altRange: null,
        filters: tabFilters.get(next[nextActive].id) ?? [],
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
          rows: src.sheet.rows,
          cols: src.sheet.cols,
          maxRow: src.sheet.maxRow,
          maxCol: src.sheet.maxCol,
        },
      }
      if (get().edit) get().commitEdit('none')
      saveFilters()
      set({
        tabs: [...tabs.slice(0, index + 1), copy, ...tabs.slice(index + 1)],
        activeTab: index + 1,
        sheet: copy.sheet,
        selection: selectionOf(0, 0),
        edit: null,
        altRange: null,
        filters: [],
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
      const from = selection.active
      const target = opts?.jump
        ? jumpTarget(sheet, from.row, from.col, dr, dc)
        : clampRef({ row: from.row + dr, col: from.col + dc }, sheet.rows, sheet.cols)
      // скрытые фильтром строки навигация пропускает — активная ячейка видима
      const visible = visibleRowsOf(sheet, state.filters)
      const row = visible ? nearestVisibleRow(visible, target.row, dr !== 0 ? dr : 1) : target.row
      if (opts?.extend) {
        const ranges = [...selection.ranges]
        ranges[ranges.length - 1] = { ...ranges[ranges.length - 1], tr: row, tc: target.col }
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
      set({ selection: selectionOf(selection.active.row, selection.active.col), altRange: null })
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
      patchSheet(applyChanges(sheet, changes, 'after'))
      set({ dirty: true })
      refreshSearch()
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

    setEditValue: (value) => {
      const { edit } = get()
      if (edit) set({ edit: { ...edit, value } })
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
        patchSheet(next)
        set({ dirty: true })
      }
      const [dr, dc] = MOVE_DELTA[move]
      const target = clampRef({ row: edit.row + dr, col: edit.col + dc }, next.rows, next.cols)
      set({ edit: null, selection: selectionOf(target.row, target.col) })
      refreshSearch()
    },

    cancelEdit: () => set({ edit: null }),

    undo: () => {
      const state = get()
      const { sheet, tabs, activeTab } = state
      const entry = historyOf(tabs[activeTab].id).undo()
      if (!entry) return
      patchSheet(applyChanges(sheet, entry.changes, 'before'))
      set({ edit: null, altRange: null, dirty: true })
      refreshSearch()
    },

    redo: () => {
      const state = get()
      const { sheet, tabs, activeTab } = state
      const entry = historyOf(tabs[activeTab].id).redo()
      if (!entry) return
      patchSheet(applyChanges(sheet, entry.changes, 'after'))
      set({ edit: null, altRange: null, dirty: true })
      refreshSearch()
    },

    setAltRange: (r) => set({ altRange: r }),

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
          set({ filters: next })
          refreshSearch()
          return
        }
      }
      next = [...next, filter].sort((a, b) => a.col - b.col)
      set({ filters: next })
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
      set({ filters: filters.filter((f) => f.col !== col) })
      refreshSearch()
    },

    clearAllFilters: () => {
      if (get().filters.length === 0) return
      set({ filters: [] })
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
      patchSheet(applyChanges(sheet, changes, 'after'))
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
  }
})

export type GridStore = typeof gridStore
