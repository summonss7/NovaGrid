/*
 * Тест-хук e2e: устанавливается только при ?test=1 / ?testui=1 — в обычном
 * режиме в приложении его нет. Даёт Playwright доступ к состоянию грида
 * (значения ячеек канваса недоступны DOM-локаторам) и к статистике кадров.
 * Этап 3: координаты ячеек идут через раскладку строк (фильтры скрывают
 * строки), добавлены доступы к фильтрам/поиску для сценариев КТ-3.
 */

import { normalize } from '../core/selection'
import type { ColumnFilter } from '../core/filter'
import { visibleRowsOf } from '../core/filter'
import { getCell } from '../core/sheet'
import { gridStore, selectionMetrics, type EditState } from '../core/store'
import { cellRefName, cellRect, type RowLayout } from './geometry'
import { drawStats, type VisibleRegion } from './renderer'

export interface NvBookInfo {
  fileName: string | null
  dirty: boolean
  tabs: string[]
  activeTab: number
  rows: number
  cols: number
}

export interface NvSearchInfo {
  open: boolean
  query: string
  scope: 'sheet' | 'book'
  count: number
  index: number
}

export interface NvTestApi {
  cell: (row: number, col: number) => string
  /** ячейка произвольного листа по индексу вкладки (многолистовые проверки) */
  cellIn: (tab: number, row: number, col: number) => string
  activeRef: () => string
  metrics: () => { total: number; count: number; mean: number; filled: number }
  ranges: () => string[]
  visible: () => VisibleRegion | null
  draw: () => { frames: number; avgMs: number; lastMs: number }
  resetDrawStats: () => void
  scrollTo: (x: number, y: number) => void
  cellCenter: (row: number, col: number) => { x: number; y: number }
  editor: () => EditState | null
  book: () => NvBookInfo
  /** фильтры активной вкладки (КТ-3) */
  filters: () => ColumnFilter[]
  /** видимые строки активной вкладки; null — фильтров нет */
  visibleRows: () => number[] | null
  /** состояние поиска: счётчик/индекс (Ф2) */
  searchInfo: () => NvSearchInfo
}

declare global {
  interface Window {
    __nv?: NvTestApi
  }
}

export interface TestHookRefs {
  main: () => HTMLElement | null
  scroll: () => HTMLDivElement | null
  region: () => VisibleRegion | null
  /** раскладка строк активного листа (с учётом фильтров) */
  layout: () => RowLayout
}

export function installTestHook(refs: TestHookRefs): void {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('test') && !params.has('testui')) return
  window.__nv = {
    cell: (row, col) => getCell(gridStore.getState().sheet, row, col),
    cellIn: (tab, row, col) => {
      const st = gridStore.getState()
      const t = st.tabs[Math.min(Math.max(tab, 0), st.tabs.length - 1)]
      return t ? getCell(t.sheet, row, col) : ''
    },
    activeRef: () => {
      const { active } = gridStore.getState().selection
      return cellRefName(active.row, active.col)
    },
    metrics: () => {
      const st = gridStore.getState()
      return selectionMetrics(st.sheet, st.selection, visibleRowsOf(st.sheet, st.filters))
    },
    ranges: () =>
      gridStore.getState().selection.ranges.map((r) => {
        const n = normalize(r)
        return `${cellRefName(n.r1, n.c1)}:${cellRefName(n.r2, n.c2)}`
      }),
    visible: () => refs.region(),
    draw: () => ({
      frames: drawStats.frames,
      avgMs: drawStats.frames > 0 ? drawStats.totalMs / drawStats.frames : 0,
      lastMs: drawStats.lastMs,
    }),
    resetDrawStats: () => {
      drawStats.frames = 0
      drawStats.totalMs = 0
      drawStats.lastMs = 0
    },
    scrollTo: (x, y) => {
      const el = refs.scroll()
      if (el) {
        el.scrollLeft = x
        el.scrollTop = y
      }
    },
    cellCenter: (row, col) => {
      const main = refs.main()
      const el = refs.scroll()
      if (!main || !el) return { x: 0, y: 0 }
      const layout = refs.layout()
      // row = -1 — центр заголовка колонки (как до Этапа 3); скрытая строка —
      // грубая позиция модельной строки (тесты по скрытым не кликают)
      const i = layout.indexOf(row)
      const vi = i >= 0 ? i : row
      const mainRect = main.getBoundingClientRect()
      const r = cellRect(vi, col, el.scrollLeft, el.scrollTop)
      return { x: mainRect.left + r.x + r.w / 2, y: mainRect.top + r.y + r.h / 2 }
    },
    editor: () => gridStore.getState().edit,
    book: () => {
      const st = gridStore.getState()
      return {
        fileName: st.fileName,
        dirty: st.dirty,
        tabs: st.tabs.map((t) => t.name),
        activeTab: st.activeTab,
        rows: st.sheet.rows,
        cols: st.sheet.cols,
      }
    },
    filters: () => gridStore.getState().filters,
    visibleRows: () => {
      const vis = visibleRowsOf(gridStore.getState().sheet, gridStore.getState().filters)
      return vis ? [...vis] : null
    },
    searchInfo: () => {
      const { open, query, scope, hits, index } = gridStore.getState().search
      return { open, query, scope, count: hits.length, index }
    },
  }
}
