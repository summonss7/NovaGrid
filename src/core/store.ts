/*
 * Единое состояние грида (Zustand, ARCHITECTURE §2): лист, выделение,
 * редактирование, Alt-лассо. Undo — delta-стек core/history (решение спайка).
 * Модуль UI-агностичен: канвас подписывается напрямую на стор, React-панели
 * (строка формул, статус-бар) — селекторами.
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
import { type SheetModel, cellKey, createSheet, getCell, parseNumber, withCell } from './sheet'
import { average, sum } from './stats'

export type EditMove = 'down' | 'up' | 'right' | 'left' | 'none'

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
  sheet: SheetModel
  selection: Selection
  edit: EditState | null
  /** Alt-лассо быстрой суммы (Ф4) — временный оранжевый диапазон */
  altRange: Range | null

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

function buildSheet(rows: readonly (readonly string[])[]): SheetModel {
  let sheet = createSheet()
  rows.forEach((cells, r) => cells.forEach((v, c) => (sheet = withCell(sheet, r, c, v))))
  return sheet
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

const history = new History()

export const gridStore = createStore<GridState>((set, get) => ({
  sheet: buildSheet(DEMO_ROWS),
  selection: selectionOf(0, 0),
  edit: null,
  altRange: null,

  seedDemo: () => {
    history.clear()
    set({ sheet: buildSheet(DEMO_ROWS), selection: selectionOf(0, 0), edit: null, altRange: null })
  },

  seedStress: (rows, cols) => {
    // стресс-режим проверки виртуализации: числовая колонка A на всю глубину.
    // Map строется за один проход — иммутабельный withCell на 100k ячеек дал бы O(n²)
    const cells = new Map<string, string>()
    for (let r = 0; r < rows; r++) cells.set(cellKey(r, 0), String(r + 1))
    history.clear()
    set({
      sheet: {
        cells,
        rows: Math.max(rows, 1),
        cols: Math.max(cols, 1),
        maxRow: rows - 1,
        maxCol: 0,
      },
      selection: selectionOf(0, 0),
      edit: null,
      altRange: null,
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
      set({ selection: { active: { row, col }, ranges: [...selection.ranges, range(row, col)] } })
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
    const { sheet, selection } = get()
    const { rows, cols } = selectedCells(selection)
    const changes: CellChange[] = []
    for (let i = 0; i < rows.length; i++) {
      const before = getCell(sheet, rows[i], cols[i])
      if (before !== '') changes.push({ row: rows[i], col: cols[i], before, after: '' })
    }
    if (changes.length === 0) return
    history.push({ label: 'clear', changes })
    set({ sheet: applyChanges(sheet, changes, 'after') })
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
    const { edit } = state
    if (!edit) return
    const before = getCell(state.sheet, edit.row, edit.col)
    let sheet = state.sheet
    if (edit.value !== before) {
      const changes: CellChange[] = [{ row: edit.row, col: edit.col, before, after: edit.value }]
      history.push({ label: 'edit', changes })
      sheet = applyChanges(sheet, changes, 'after')
    }
    const [dr, dc] = MOVE_DELTA[move]
    const target = clampRef({ row: edit.row + dr, col: edit.col + dc }, sheet.rows, sheet.cols)
    set({ sheet, edit: null, selection: selectionOf(target.row, target.col) })
  },

  cancelEdit: () => set({ edit: null }),

  undo: () => {
    const entry = history.undo()
    if (!entry) return
    set({ sheet: applyChanges(get().sheet, entry.changes, 'before'), edit: null, altRange: null })
  },

  redo: () => {
    const entry = history.redo()
    if (!entry) return
    set({ sheet: applyChanges(get().sheet, entry.changes, 'after'), edit: null, altRange: null })
  },

  setAltRange: (r) => set({ altRange: r }),
}))

export type GridStore = typeof gridStore
