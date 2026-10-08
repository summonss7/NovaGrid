/*
 * Единое состояние грида (Zustand, ARCHITECTURE §2): книга с вкладками листов,
 * выделение, редактирование, Alt-лассо, метаданные файла (Этап 2). Undo —
 * delta-стеки core/history, по одному на вкладку. Модуль UI-агностичен:
 * канвас подписывается напрямую на стор, React-панели — селекторами.
 *
 * Инвариант: state.sheet === state.tabs[state.activeTab].sheet — «текущий лист»,
 * чтобы потребители (грид, строка формул, статус-бар) не знали про вкладки.
 */

import { createStore } from 'zustand/vanilla'
import { History, type CellChange } from './history'
import {
  type NormRange,
  type Range,
  type Selection,
  clampRef,
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
  /** количество заполненных ячеек (для будущей карточки метрик Ф4) */
  filled: number
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
}

/** Метрики набора ячеек: Σ/n/x̄ по числовым значениям (Ф4, статус-бар). */
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
  return { total: sum(values), count: values.length, mean: average(values), filled }
}

export function selectionMetrics(sheet: SheetModel, selection: Selection): SelectionMetrics {
  const { rows, cols } = selectedCells(selection)
  return cellsMetrics(sheet, rows, cols)
}

export function rangeMetrics(sheet: SheetModel, n: NormRange): SelectionMetrics {
  const rows: number[] = []
  const cols: number[] = []
  for (let r = n.r1; r <= n.r2; r++) {
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
}

const initialTab = createTab(DEFAULT_SHEET_NAME)

export const gridStore = createStore<GridState>((set, get) => {
  /** Записать новый лист модели в активную вкладку (держит инвариант sheet). */
  const patchSheet = (sheet: SheetModel) => {
    const { tabs, activeTab } = get()
    set({ tabs: tabs.map((t, i) => (i === activeTab ? { ...t, sheet } : t)), sheet })
  }

  return {
    tabs: [initialTab],
    activeTab: 0,
    sheet: initialTab.sheet,
    selection: selectionOf(0, 0),
    edit: null,
    altRange: null,
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
      set({
        activeTab: i,
        sheet: tabs[i].sheet,
        selection: selectionOf(0, 0),
        edit: null,
        altRange: null,
      })
    },

    addTab: () => {
      const { tabs, activeTab } = get()
      const name = uniqueTabName(
        tabs.map((t) => t.name),
        `Лист ${tabs.length + 1}`,
      )
      const tab = createTab(name)
      if (get().edit) get().commitEdit('none')
      set({
        tabs: [...tabs.slice(0, activeTab + 1), tab, ...tabs.slice(activeTab + 1)],
        activeTab: activeTab + 1,
        sheet: tab.sheet,
        selection: selectionOf(0, 0),
        edit: null,
        altRange: null,
        dirty: true,
      })
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
      const nextActive = index < activeTab ? activeTab - 1 : Math.min(activeTab, next.length - 1)
      if (get().edit) get().cancelEdit()
      set({
        tabs: next,
        activeTab: nextActive,
        sheet: next[nextActive].sheet,
        selection: selectionOf(0, 0),
        edit: null,
        altRange: null,
        dirty: true,
      })
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
      set({
        tabs: [...tabs.slice(0, index + 1), copy, ...tabs.slice(index + 1)],
        activeTab: index + 1,
        sheet: copy.sheet,
        selection: selectionOf(0, 0),
        edit: null,
        altRange: null,
        dirty: true,
      })
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
      const { sheet, selection } = get()
      const from = selection.active
      const target = opts?.jump
        ? jumpTarget(sheet, from.row, from.col, dr, dc)
        : clampRef({ row: from.row + dr, col: from.col + dc }, sheet.rows, sheet.cols)
      if (opts?.extend) {
        const ranges = [...selection.ranges]
        ranges[ranges.length - 1] = { ...ranges[ranges.length - 1], tr: target.row, tc: target.col }
        set({ selection: { ...selection, ranges } })
      } else {
        set({ selection: selectionOf(target.row, target.col) })
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
    },

    cancelEdit: () => set({ edit: null }),

    undo: () => {
      const state = get()
      const { sheet, tabs, activeTab } = state
      const entry = historyOf(tabs[activeTab].id).undo()
      if (!entry) return
      patchSheet(applyChanges(sheet, entry.changes, 'before'))
      set({ edit: null, altRange: null, dirty: true })
    },

    redo: () => {
      const state = get()
      const { sheet, tabs, activeTab } = state
      const entry = historyOf(tabs[activeTab].id).redo()
      if (!entry) return
      patchSheet(applyChanges(sheet, entry.changes, 'after'))
      set({ edit: null, altRange: null, dirty: true })
    },

    setAltRange: (r) => set({ altRange: r }),
  }
})

export type GridStore = typeof gridStore
