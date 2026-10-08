/*
 * Тест-хук e2e: устанавливается только при ?test=1 / ?testui=1 — в обычном
 * режиме в приложении его нет. Даёт Playwright доступ к состоянию грида
 * (значения ячеек канваса недоступны DOM-локаторам) и к статистике кадров.
 */

import { normalize } from '../core/selection'
import { getCell } from '../core/sheet'
import { gridStore, selectionMetrics, type EditState } from '../core/store'
import { cellRefName, cellRect } from './geometry'
import { drawStats, type VisibleRegion } from './renderer'

export interface NvBookInfo {
  fileName: string | null
  dirty: boolean
  tabs: string[]
  activeTab: number
  rows: number
  cols: number
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
      return selectionMetrics(st.sheet, st.selection)
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
      const mainRect = main.getBoundingClientRect()
      const r = cellRect(row, col, el.scrollLeft, el.scrollTop)
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
  }
}
