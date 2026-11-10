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
import { getCell, getStyle, type CellStyle } from '../core/sheet'
import { cellText, formulaStateAt } from '../formula/engine'
import { gridStore, selectionMetrics, type EditState } from '../core/store'
import { useSettings, type ResolvedTheme, type ThemePref } from '../i18n'
import {
  cellRefName,
  cellRect,
  METRICS,
  zoomOf,
  type ColLayout,
  type RowAxis,
  type RowLayout,
} from './geometry'
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

/** Состояние «Найти и заменить» для e2e Этапа 7 (зеркало searchInfo). */
export interface NvReplaceInfo {
  open: boolean
  query: string
  replacement: string
  scope: 'sheet' | 'book'
  count: number
  index: number
  lastCount: number | null
}

export interface NvFormulaInfo {
  source: string
  display: string
  error: string | null
  frozen: boolean
}

export interface NvTestApi {
  cell: (row: number, col: number) => string
  /** отображаемое значение ячейки: формула → вычисленное (Этап 4) */
  cellText: (row: number, col: number) => string
  /** состояние формулы в ячейке; null — не формула */
  formulaInfo: (row: number, col: number) => NvFormulaInfo | null
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
  /** закрепление областей активной вкладки (novagrid-044) */
  freeze: () => { rows: number; cols: number }
  editor: () => EditState | null
  book: () => NvBookInfo
  /** фильтры активной вкладки (КТ-3) */
  filters: () => ColumnFilter[]
  /** объединённые ячейки активного листа (novagrid-047) */
  merges: () => { r1: number; c1: number; r2: number; c2: number }[]
  /** видимые строки активной вкладки; null — фильтров нет */
  visibleRows: () => number[] | null
  /** состояние поиска: счётчик/индекс (Ф2) */
  searchInfo: () => NvSearchInfo
  /** состояние «Найти и заменить»: счётчик/индекс/последнее действие (Этап 7) */
  replaceInfo: () => NvReplaceInfo
  /** зум таблицы и текущие размеры ячеек (Этап 5.3, пинч/кнопки) */
  zoom: () => number
  cellMetrics: () => { rowH: number; colW: number; headerH: number; rowHeaderW: number }
  /** фактическая ширина колонки с учётом переопределений и зума (novagrid-020) */
  colWidth: (col: number) => number
  /** стиль ячейки активного листа; null — стиля нет (novagrid-039) */
  style: (row: number, col: number) => CellStyle | null
  /** высота строки грида с автовысотой переноса (novagrid-048) */
  rowHeight: (row: number) => number
  /** смена ширины колонки, как перетаскиванием границы (для e2e novagrid-048) */
  setColWidth: (col: number, width: number) => void
  /** тема интерфейса (Этап 7.2): настройка и вычисленная тема */
  theme: () => { pref: ThemePref; resolved: ResolvedTheme }
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
  /** раскладка колонок активного листа (переменные ширины, novagrid-020) */
  cols: () => ColLayout
  /** ось строк активного листа (автовысоты переноса, novagrid-048) */
  rows: () => RowAxis
}

export function installTestHook(refs: TestHookRefs): void {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('test') && !params.has('testui')) return
  window.__nv = {
    cell: (row, col) => getCell(gridStore.getState().sheet, row, col),
    style: (row, col) => getStyle(gridStore.getState().sheet, row, col) ?? null,
    rowHeight: (row) => {
      const layout = refs.layout()
      const i = layout.indexOf(row)
      return i >= 0 ? refs.rows().height(i) : METRICS.rowH
    },
    setColWidth: (col, width) => gridStore.getState().setColWidth(col, width),
    cellText: (row, col) => cellText(gridStore.getState().sheet, row, col),
    formulaInfo: (row, col) => {
      const st = gridStore.getState()
      const state = formulaStateAt(st.sheet, row, col)
      if (!state) return null
      return {
        source: getCell(st.sheet, row, col),
        display: state.display,
        error: state.error,
        frozen: state.frozen,
      }
    },
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
      const st = gridStore.getState()
      const layout = refs.layout()
      const colLay = refs.cols()
      // row = -1 — центр заголовка колонки (как до Этапа 3); скрытая строка —
      // грубая позиция модельной строки (тесты по скрытым не кликают)
      const i = layout.indexOf(row)
      const vi = i >= 0 ? i : row
      const mainRect = main.getBoundingClientRect()
      const r = cellRect(vi, col, el.scrollLeft, el.scrollTop, undefined, colLay, {
        rows: Math.min(st.freeze.rows, st.sheet.rows),
        cols: Math.min(st.freeze.cols, st.sheet.cols),
      }, refs.rows())
      return { x: mainRect.left + r.x + r.w / 2, y: mainRect.top + r.y + r.h / 2 }
    },
    /** закрепление областей активной вкладки (novagrid-044) */
    freeze: () => ({ ...gridStore.getState().freeze }),
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
    merges: () =>
      (gridStore.getState().sheet.merges ?? []).map((m) => ({ r1: m.r1, c1: m.c1, r2: m.r2, c2: m.c2 })),
    visibleRows: () => {
      const vis = visibleRowsOf(gridStore.getState().sheet, gridStore.getState().filters)
      return vis ? [...vis] : null
    },
    searchInfo: () => {
      const { open, query, scope, hits, index } = gridStore.getState().search
      return { open, query, scope, count: hits.length, index }
    },
    replaceInfo: () => {
      const r = gridStore.getState().replace
      return {
        open: r.open,
        query: r.query,
        replacement: r.replacement,
        scope: r.scope,
        count: r.hits.length,
        index: r.index,
        lastCount: r.lastCount,
      }
    },
    zoom: () => zoomOf(),
    cellMetrics: () => ({ ...METRICS }),
    colWidth: (col) => {
      // действующие ширины: автоширина по тексту или ручные (novagrid-067)
      return refs.cols().width(col)
    },
    theme: () => {
      const { theme, resolvedTheme } = useSettings.getState()
      return { pref: theme, resolved: resolvedTheme }
    },
  }
}
