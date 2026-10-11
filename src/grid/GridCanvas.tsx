/*
 * Канвас-грид (решение спайка — собственный грид, docs/SPIKE-1-GRID.md):
 * прокрутка нативная (spacer в .grid-scroll), рендер — канвас поверх вьюпорта,
 * за кадр рисуются только видимые ячейки. Все жесты (Shift/Ctrl/Alt/ПКМ)
 * транслируются в действия стора, логика выделения живёт в core/selection.
 *
 * Этап 3: координаты строк идут через RowLayout (фильтры скрывают строки),
 * ПКМ открывает контекстное меню фильтрации (Ф3), кнопка ▾/воронка в шапке —
 * меню колонки, Esc сначала закрывает поиск.
 *
 * Этап 5.3 (мобильные жесты): касание выделяет ячейку; перетаскивание от
 * активной ячейки расширяет выделение (нативная прокрутка гасится
 * preventDefault на touchstart), от любой другой — прокручивает таблицу;
 * длинное нажатие (500 мс без сдвига) = ПКМ — то же меню фильтрации;
 * два пальца — пинч-зум таблицы (METRICS масштабируются, якорь — середина
 * жеста). Ctrl+колесо и Ctrl +/−/0 дублируют зум с клавиатуры.
 */

import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { visibleRowsOf, type ColumnFilter } from '../core/filter'
import { normalize, inSelection } from '../core/selection'
import { gridStore, rangeMetrics } from '../core/store'
import type { SheetModel } from '../core/sheet'
import { useSettings, useT } from '../i18n'
import { AssistPopup } from '../ui/AssistPopup'
import { useFormulaAssist } from '../ui/useFormulaAssist'
import { ContextMenu } from '../ui/ContextMenu'
import { ColumnMenu } from '../ui/ColumnMenu'
import {
  cellAtPoint,
  cellRect,
  METRICS,
  rowLayoutOf,
  scrollIntoView,
  totalSize,
  zoomOf,
  type RowLayout,
} from './geometry'
import { zoomStore } from './zoom'
import { drawGrid, themeFromCSS, type GridTheme, type VisibleRegion } from './renderer'
import { installTestHook } from './testHook'

type DragMode = 'select' | 'alt' | null

interface AltLabel {
  x: number
  y: number
  text: string
}

interface CtxMenuState {
  x: number
  y: number
  row: number
  col: number
}

interface ColMenuState {
  x: number
  y: number
  col: number
}

const LONG_PRESS_MS = 500
const LONG_PRESS_SLOP = 8 // сдвиг больше — это не нажатие, а жест
const ZOOM_WHEEL_K = 0.0015

export function GridCanvas() {
  const t = useT()
  const mainRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const editorRef = useRef<HTMLInputElement>(null)
  const themeRef = useRef<GridTheme | null>(null)
  const dragModeRef = useRef<DragMode>(null)
  const altAnchorRef = useRef<{ row: number; col: number } | null>(null)
  const lastActiveRef = useRef('')
  const regionRef = useRef<VisibleRegion | null>(null)
  const rafRef = useRef(0)
  // тач-жесты (5.3): активные касания, пинч, длинное нажатие, блокировка пан-а
  const touchesRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null)
  const lpTimerRef = useRef(0)
  const lpOriginRef = useRef<{ x: number; y: number } | null>(null)
  const panBlockRef = useRef(false)
  // Android открывает contextmenu сам после длинного нажатия — наш таймер уже
  // открыл меню; дедупликация по времени и точке
  const ctxGuardRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const [altLabel, setAltLabel] = useState<AltLabel | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null)
  const [colMenu, setColMenu] = useState<ColMenuState | null>(null)

  const edit = useStore(gridStore, (s) => s.edit)
  const sheet = useStore(gridStore, (s) => s.sheet)
  const zoom = useStore(zoomStore, (s) => s.zoom)
  // правка ячейки (не из строки формул) с «=» — подсказки функций (4.4)
  const cellEdit = edit !== null && edit.source !== 'bar' ? edit : null
  const assistApply = (next: { value: string; caret: number }) => {
    gridStore.getState().setEditValue(next.value)
    const el = editorRef.current
    if (el) requestAnimationFrame(() => el.setSelectionRange(next.caret, next.caret))
  }
  const assist = useFormulaAssist(cellEdit ? cellEdit.value : '', assistApply)
  const filters = useStore(gridStore, (s) => s.filters)
  const rows = useStore(gridStore, (s) => s.sheet.rows)
  const cols = useStore(gridStore, (s) => s.sheet.cols)

  // ── раскладка строк (фильтры) ─────────────────────────────────────────
  // sheet и filters иммутабельны по ссылке — кэш пересчитывается только
  // при их смене, кадр скролла платит O(1)
  const layoutRef = useRef<{
    sheet: SheetModel
    filters: readonly ColumnFilter[]
    layout: RowLayout
  } | null>(null)
  const layoutFor = (sh: SheetModel, fl: readonly ColumnFilter[]): RowLayout => {
    const cur = layoutRef.current
    if (cur && cur.sheet === sh && cur.filters === fl) return cur.layout
    const layout = rowLayoutOf(sh.rows, visibleRowsOf(sh, fl))
    layoutRef.current = { sheet: sh, filters: fl, layout }
    return layout
  }
  const layout = layoutFor(sheet, filters)

  // ── рендер ────────────────────────────────────────────────────────────
  const draw = () => {
    const canvas = canvasRef.current
    const main = mainRef.current
    const scrollEl = scrollRef.current
    const theme = themeRef.current
    if (!canvas || !main || !scrollEl || !theme) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = main.clientWidth
    const h = main.clientHeight
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const state = gridStore.getState()
    const lay = layoutFor(state.sheet, state.filters)
    const hit = state.search.hits[state.search.index]
    regionRef.current = drawGrid({
      ctx,
      width: w,
      height: h,
      scrollX: scrollEl.scrollLeft,
      scrollY: scrollEl.scrollTop,
      sheet: state.sheet,
      layout: lay,
      selection: state.selection,
      edit: state.edit,
      altRange: state.altRange,
      search: {
        hitSet: state.search.hitSet,
        currentKey: hit && hit.tab === state.activeTab ? `${hit.row}:${hit.col}` : null,
      },
      filteredCols: new Set(state.filters.map((f) => f.col)),
      theme,
    })
  }

  const scheduleDraw = () => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      draw()
    })
  }

  const resizeSpacer = () => {
    const spacer = spacerRef.current
    if (!spacer) return
    const st = gridStore.getState()
    const size = totalSize(layoutFor(st.sheet, st.filters).count, st.sheet.cols)
    spacer.style.width = `${size.w}px`
    spacer.style.height = `${size.h}px`
  }

  /**
   * Зум с якорем: точка таблицы под якорем (координаты вьюпорта грида)
   * остаётся под ним и после смены масштаба. Математика по СТАРОМУ масштабу
   * идёт до setZoom, установка прокрутки — после (и после resize спейсера,
   * иначе браузер ограничит scroll старым максимумом).
   */
  const applyZoomAnchored = (next: number, anchor?: { x: number; y: number }) => {
    const el = scrollRef.current
    if (!el) return
    let mx: number | null = null
    let my: number | null = null
    if (anchor) {
      const cx = anchor.x - METRICS.rowHeaderW + el.scrollLeft
      const cy = anchor.y - METRICS.headerH + el.scrollTop
      if (cx > 0) mx = cx / METRICS.colW
      if (cy > 0) my = cy / METRICS.rowH
    }
    zoomStore.getState().setZoom(next)
    resizeSpacer()
    if (anchor) {
      if (mx !== null) el.scrollLeft = Math.max(0, mx * METRICS.colW - (anchor.x - METRICS.rowHeaderW))
      if (my !== null) el.scrollTop = Math.max(0, my * METRICS.rowH - (anchor.y - METRICS.headerH))
    }
  }
  // нативные слушатели (wheel) живут в mount-эффекте — им нужен актуальный
  // колбэк без пересборки
  const zoomApplyRef = useRef(applyZoomAnchored)
  zoomApplyRef.current = applyZoomAnchored

  const zoomStep = (delta: number) => {
    const main = mainRef.current
    const anchor = main ? { x: main.clientWidth / 2, y: main.clientHeight / 2 } : undefined
    zoomApplyRef.current(zoomOf() + delta, anchor)
  }

  // смена зума любым путём (пинч/колесо/кнопки): тема со шрифтами масштаба,
  // спейсер, редактор и кадр
  useEffect(() => {
    themeRef.current = themeFromCSS(zoom)
    resizeSpacer()
    positionEditor()
    scheduleDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  // смена темы (7.2): токены на корне уже новые — перечитать тему канваса
  // и перерисовать кадр без перезагрузки страницы
  const resolvedTheme = useSettings((s) => s.resolvedTheme)
  useEffect(() => {
    themeRef.current = themeFromCSS(zoomOf())
    scheduleDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme])

  const ensureActiveVisible = () => {
    const el = scrollRef.current
    const main = mainRef.current
    if (!el || !main) return
    const st = gridStore.getState()
    const lay = layoutFor(st.sheet, st.filters)
    const i = lay.indexOf(st.selection.active.row)
    if (i < 0) return // активная ячейка скрыта фильтром
    const target = scrollIntoView(
      i,
      st.selection.active.col,
      el.scrollLeft,
      el.scrollTop,
      main.clientWidth,
      main.clientHeight,
    )
    if (target.scrollX !== el.scrollLeft) el.scrollLeft = target.scrollX
    if (target.scrollY !== el.scrollTop) el.scrollTop = target.scrollY
  }

  const positionEditor = () => {
    const input = editorRef.current
    const el = scrollRef.current
    const editState = gridStore.getState().edit
    if (!input || !el || !editState) return
    const st = gridStore.getState()
    const lay = layoutFor(st.sheet, st.filters)
    const i = Math.max(0, lay.indexOf(editState.row))
    const r = cellRect(i, editState.col, el.scrollLeft, el.scrollTop)
    input.style.left = `${r.x - 1}px`
    input.style.top = `${r.y - 1}px`
  }

  useEffect(() => {
    themeRef.current = themeFromCSS(zoomOf())

    // стартовый режим (демо/стресс) выбирает App — грид только рисует
    installTestHook({
      main: () => mainRef.current,
      scroll: () => scrollRef.current,
      region: () => regionRef.current,
      layout: () => {
        const st = gridStore.getState()
        return layoutFor(st.sheet, st.filters)
      },
    })

    const unsub = gridStore.subscribe(() => {
      const st = gridStore.getState()
      const key = `${st.selection.active.row}:${st.selection.active.col}`
      if (key !== lastActiveRef.current) {
        lastActiveRef.current = key
        ensureActiveVisible()
      }
      scheduleDraw()
    })

    const scrollEl = scrollRef.current
    const onScroll = () => {
      scheduleDraw()
      positionEditor()
    }
    scrollEl?.addEventListener('scroll', onScroll)
    // Ctrl+колесо — зум таблицы (и тачпад-пинч, который шлёт wheel с ctrlKey)
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const rect = mainRef.current?.getBoundingClientRect()
      if (!rect) return
      zoomApplyRef.current(zoomOf() * Math.exp(-e.deltaY * ZOOM_WHEEL_K), {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      })
    }
    const mainEl = mainRef.current
    mainEl?.addEventListener('wheel', onWheel, { passive: false })
    const ro = new ResizeObserver(scheduleDraw)
    if (mainEl) ro.observe(mainEl)
    draw()
    // после загрузки переменных шрифтов канвас перерисовывается корректным начертанием
    void document.fonts.ready.then(draw)

    return () => {
      unsub()
      scrollEl?.removeEventListener('scroll', onScroll)
      mainEl?.removeEventListener('wheel', onWheel)
      ro.disconnect()
      // cancel без обнуления оставляет rafRef ненулевым: после StrictMode-
      // перемонтирования scheduleDraw навсегда уходит в ранний return и
      // канвас перестаёт перерисовываться (проявилось с zoom-эффектом Этапа 5)
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // фокус и каретка при старте правки: каретка в конец — продолжение ввода
  // дописывает (как в Excel: первый символ замены уже вошёл в значение)
  useEffect(() => {
    const input = editorRef.current
    const editState = gridStore.getState().edit
    if (!input || !editState) return
    input.focus({ preventScroll: true })
    input.setSelectionRange(input.value.length, input.value.length)
  }, [edit?.row, edit?.col, edit?.mode])

  // ── мышь и тач ────────────────────────────────────────────────────────
  const localPoint = (clientX: number, clientY: number) => {
    const rect = mainRef.current!.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const cellFromPoint = (x: number, y: number) => {
    const el = scrollRef.current
    if (!el) return null
    const st = gridStore.getState()
    const lay = layoutFor(st.sheet, st.filters)
    if (lay.count === 0) return null
    const hit = cellAtPoint(x, y, el.scrollLeft, el.scrollTop)
    if (!hit) return null
    const visualRow = Math.min(hit.row, lay.count - 1)
    return {
      kind: hit.kind,
      col: Math.min(hit.col, st.sheet.cols - 1),
      visualRow,
      row: hit.kind === 'cell' || hit.kind === 'rowHeader' ? lay.rowAt(visualRow) : visualRow,
    }
  }

  const updateAltLabel = (clientX: number, clientY: number) => {
    const st = gridStore.getState()
    if (!st.altRange) return
    const m = rangeMetrics(st.sheet, normalize(st.altRange), visibleRowsOf(st.sheet, st.filters))
    const rect = mainRef.current!.getBoundingClientRect()
    const { x, y } = localPoint(clientX, clientY)
    setAltLabel({
      x: Math.min(x + 18, rect.width - 130),
      y: Math.max(6, y - 46),
      text: `${t.altSum} ${t.num(m.total)}`,
    })
  }

  const autoScrollDuringDrag = (x: number, y: number) => {
    const el = scrollRef.current
    if (!el) return
    const zone = METRICS.rowH * 2
    if (y < METRICS.headerH + zone) el.scrollTop -= METRICS.rowH
    else if (y > el.clientHeight - zone) el.scrollTop += METRICS.rowH
    if (x < METRICS.rowHeaderW + METRICS.colW) el.scrollLeft -= METRICS.colW
    else if (x > el.clientWidth - METRICS.colW) el.scrollLeft += METRICS.colW
  }

  // ── длинное нажатие = ПКМ (5.3) ───────────────────────────────────────
  const clearLongPress = () => {
    if (lpTimerRef.current) window.clearTimeout(lpTimerRef.current)
    lpTimerRef.current = 0
    lpOriginRef.current = null
  }

  const startLongPress = (
    clientX: number,
    clientY: number,
    kind: 'cell' | 'colHeader',
    col = 0,
  ) => {
    clearLongPress()
    lpOriginRef.current = { x: clientX, y: clientY }
    lpTimerRef.current = window.setTimeout(() => {
      lpTimerRef.current = 0
      lpOriginRef.current = null
      dragModeRef.current = null // меню важнее недотянутого выделения
      if (kind === 'colHeader') {
        setColMenu({ col, x: clientX, y: clientY })
        ctxGuardRef.current = { x: clientX, y: clientY, t: performance.now() }
      } else {
        openCtxAt(clientX, clientY)
      }
    }, LONG_PRESS_MS)
  }

  /** Общий путь меню ПКМ: мышь, Android-нажатие и наш тач-таймер (5.2/5.3). */
  const openCtxAt = (clientX: number, clientY: number) => {
    const { x, y } = localPoint(clientX, clientY)
    const hit = cellFromPoint(x, y)
    if (!hit) return
    ctxGuardRef.current = { x: clientX, y: clientY, t: performance.now() }
    if (hit.kind === 'colHeader') {
      setColMenu({ col: hit.col, x: clientX, y: clientY })
      return
    }
    if (hit.kind !== 'cell') return
    const st = gridStore.getState()
    // Excel-поведение: ПКМ вне выделения выбирает ячейку
    if (!inSelection(st.selection, hit.row, hit.col)) st.clickCell(hit.row, hit.col)
    setCtxMenu({ row: hit.row, col: hit.col, x: clientX, y: clientY })
  }

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    // pointerdown из всплывающих меню/панелей не должен попадать в грид:
    // иначе setPointerCapture уведёт у кнопки меню её click
    if (
      (e.target as HTMLElement).closest('.ctx-menu, .col-menu, .search-panel, .sum-card, .tab-menu')
    )
      return
    const { x, y } = localPoint(e.clientX, e.clientY)
    const hit = cellFromPoint(x, y)
    if (!hit || hit.kind === 'corner') return
    const isTouch = e.pointerType === 'touch'

    if (hit.kind === 'colHeader') {
      mainRef.current?.focus({ preventScroll: true })
      // зона кнопки меню в правой части заголовка (▾ / воронка) — Ф3.7
      const scrollEl = scrollRef.current
      const scrollX = scrollEl?.scrollLeft ?? 0
      const headerRight = METRICS.rowHeaderW + (hit.col + 1) * METRICS.colW - scrollX
      if (x > headerRight - 26) {
        setColMenu({ col: hit.col, x: e.clientX, y: e.clientY })
        return
      }
      gridStore.getState().selectCol(hit.col)
      if (isTouch) startLongPress(e.clientX, e.clientY, 'colHeader', hit.col)
      return
    }
    if (hit.kind === 'rowHeader') {
      mainRef.current?.focus({ preventScroll: true })
      gridStore.getState().selectRow(hit.row)
      return
    }
    mainRef.current?.focus({ preventScroll: true })

    if (isTouch) {
      // касание-выделение (5.3); перетаскивание от уже активной ячейки
      // расширяет выделение (пан гасится в onTouchStart), от другой ячейки —
      // нативная прокрутка; 500 мс без сдвига — меню ПКМ
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touchesRef.current.size === 2) {
        // второй палец — пинч-зум: выделение и нажатие отменяются
        clearLongPress()
        dragModeRef.current = null
        const pts = [...touchesRef.current.values()]
        pinchRef.current = {
          startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          startZoom: zoomOf(),
        }
        return
      }
      const st = gridStore.getState()
      const wasActive =
        st.selection.active.row === hit.row && st.selection.active.col === hit.col
      panBlockRef.current = wasActive
      st.clickCell(hit.row, hit.col)
      if (wasActive) dragModeRef.current = 'select'
      startLongPress(e.clientX, e.clientY, 'cell')
      return
    }

    mainRef.current?.setPointerCapture(e.pointerId)

    if (e.altKey) {
      // Alt-лассо быстрой суммы (Ф4): оранжевая рамка + живая Σ у курсора
      dragModeRef.current = 'alt'
      altAnchorRef.current = { row: hit.row, col: hit.col }
      gridStore.getState().setAltRange({ fr: hit.row, fc: hit.col, tr: hit.row, tc: hit.col })
      updateAltLabel(e.clientX, e.clientY)
      e.preventDefault()
      return
    }
    dragModeRef.current = 'select'
    gridStore
      .getState()
      .clickCell(hit.row, hit.col, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })
  }

  /**
   * Тач-прокрутка нативная; единственное исключение — жест выделения от
   * активной ячейки: preventDefault на touchstart не даёт браузеру запустить
   * пан, pointer-события продолжают приходить и dragTo расширяет выделение.
   */
  const onTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (e.touches.length >= 2) {
      e.preventDefault() // два пальца — пинч зума таблицы, не страницы
      return
    }
    if (panBlockRef.current) {
      e.preventDefault()
      panBlockRef.current = false
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch' && touchesRef.current.has(e.pointerId)) {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const pinch = pinchRef.current
      if (pinch && touchesRef.current.size >= 2) {
        const pts = [...touchesRef.current.values()]
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        if (dist > 10 && pinch.startDist > 10) {
          const mid = localPoint((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2)
          zoomApplyRef.current((pinch.startZoom * dist) / pinch.startDist, mid)
        }
        return
      }
    }
    // сдвиг больше порога — это не длинное нажатие
    const lo = lpOriginRef.current
    if (lo && Math.hypot(e.clientX - lo.x, e.clientY - lo.y) > LONG_PRESS_SLOP) clearLongPress()

    const mode = dragModeRef.current
    if (!mode) return
    const { x, y } = localPoint(e.clientX, e.clientY)
    const hit = cellFromPoint(x, y)
    if (hit && hit.kind === 'cell') {
      if (mode === 'select') gridStore.getState().dragTo(hit.row, hit.col)
      else {
        const a = altAnchorRef.current
        if (a) gridStore.getState().setAltRange({ fr: a.row, fc: a.col, tr: hit.row, tc: hit.col })
        updateAltLabel(e.clientX, e.clientY)
      }
    }
    if (mode === 'select') autoScrollDuringDrag(x, y)
  }

  const endTouchPointer = (pointerId: number) => {
    touchesRef.current.delete(pointerId)
    if (touchesRef.current.size < 2) pinchRef.current = null
    clearLongPress()
  }

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') endTouchPointer(e.pointerId)
    if (dragModeRef.current === 'alt') {
      // лассо показало сумму и отпущено — вернуть обычное выделение (Ф4)
      gridStore.getState().setAltRange(null)
      setAltLabel(null)
    }
    dragModeRef.current = null
  }

  const onPointerCancel = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') endTouchPointer(e.pointerId)
    dragModeRef.current = null
  }

  const onContextMenu = (e: React.MouseEvent<HTMLElement>) => {
    // меню ПКМ-фильтра (Ф3): по ячейке — фильтрация, по шапке — меню колонки
    e.preventDefault()
    // Android сам открывает contextmenu после длинного нажатия — наш таймер
    // уже показал меню в этой точке, второго не нужно
    const g = ctxGuardRef.current
    if (g && performance.now() - g.t < 400 && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 12)
      return
    openCtxAt(e.clientX, e.clientY)
  }

  // ── клавиатура ────────────────────────────────────────────────────────
  const visibleRowCount = () => {
    const main = mainRef.current
    return main ? Math.max(1, Math.floor((main.clientHeight - METRICS.headerH) / METRICS.rowH)) : 10
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    // клавиши из всплывающих меню/панелей внутри main — не команды грида
    // (иначе Enter «нажимает» активную ячейку вместо пункта меню, Этап 6.2)
    if ((e.target as HTMLElement).closest('.ctx-menu, .col-menu, .search-panel, .sum-card'))
      return
    const st = gridStore.getState()
    if (st.edit) return // ввод обрабатывает редактор
    const mod = e.ctrlKey || e.metaKey
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }
    if (e.key in arrows) {
      const [dr, dc] = arrows[e.key]
      st.moveActive(dr, dc, { extend: e.shiftKey, jump: mod })
      e.preventDefault()
      return
    }
    switch (e.key) {
      case 'Tab':
        st.moveActive(0, e.shiftKey ? -1 : 1)
        e.preventDefault()
        return
      case 'Enter':
        st.moveActive(e.shiftKey ? -1 : 1, 0)
        e.preventDefault()
        return
      case 'F2':
        st.beginEdit()
        e.preventDefault()
        return
      case 'ContextMenu':
      case 'F10':
        // Shift+F10 / клавиша меню — контекстное меню активной ячейки с
        // клавиатуры (Этап 6.2 «клавиатура везде»): фильтры ТЗ доступны
        // и без мыши; F10 без Shift оставляем системе (меню окна браузера)
        if (e.key === 'F10' && !e.shiftKey) return
        {
          const { active } = st.selection
          const main = mainRef.current
          const el = scrollRef.current
          if (main && el) {
            const lay = layoutFor(st.sheet, st.filters)
            const i = lay.indexOf(active.row)
            if (i >= 0) {
              const r = cellRect(i, active.col, el.scrollLeft, el.scrollTop)
              const rect = main.getBoundingClientRect()
              setCtxMenu({
                row: active.row,
                col: active.col,
                x: rect.left + r.x + r.w / 2,
                y: rect.top + r.y + r.h / 2,
              })
            }
          }
        }
        e.preventDefault()
        return
      case 'Escape':
        // сначала закрываем поиск (Ф2), потом снимаем выделение
        if (st.search.open) st.closeSearch()
        else st.escape()
        return
      case 'Delete':
      case 'Backspace':
        st.deleteSelection()
        e.preventDefault()
        return
      case 'Home':
        st.goTo(st.selection.active.row, 0, { extend: e.shiftKey })
        e.preventDefault()
        return
      case 'End':
        st.goTo(st.selection.active.row, st.sheet.cols - 1, { extend: e.shiftKey })
        e.preventDefault()
        return
      case 'PageDown':
        st.pageMove(visibleRowCount(), 1, e.shiftKey)
        e.preventDefault()
        return
      case 'PageUp':
        st.pageMove(visibleRowCount(), -1, e.shiftKey)
        e.preventDefault()
        return
      case 'F3':
        if (st.search.open) {
          st.searchStep(e.shiftKey ? -1 : 1)
          e.preventDefault()
        }
        return
    }
    // e.code не зависит от раскладки — Ctrl+Z работает и на «я»
    if (mod && e.code === 'KeyZ') {
      if (e.shiftKey) st.redo()
      else st.undo()
      e.preventDefault()
      return
    }
    if (mod && e.code === 'KeyY') {
      st.redo()
      e.preventDefault()
      return
    }
    if (mod && e.code === 'KeyA') {
      st.selectAll()
      e.preventDefault()
      return
    }
    // зум таблицы с клавиатуры (5.3): Ctrl + / − / 0 — как в настольных офисах
    if (mod && (e.code === 'Equal' || e.code === 'NumpadAdd')) {
      zoomStep(0.1)
      e.preventDefault()
      return
    }
    if (mod && (e.code === 'Minus' || e.code === 'NumpadSubtract')) {
      zoomStep(-0.1)
      e.preventDefault()
      return
    }
    if (mod && e.code === 'Digit0') {
      zoomApplyRef.current(1)
      e.preventDefault()
      return
    }
    if (e.key.length === 1 && !mod && !e.altKey) {
      st.beginEdit(e.key)
      e.preventDefault()
    }
  }

  // ── редактор ячейки ───────────────────────────────────────────────────
  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    // открыт попап подсказок: стрелки/Tab/Enter выбирают, Esc закрывает
    if (assist.handleKeys(e.key)) {
      e.preventDefault()
      return
    }
    const st = gridStore.getState()
    // после размонтирования редактора Chrome не бросает blur — фокус вернём сами,
    // иначе Ctrl+Z/стрелки уйдут в body и навигация «залипнет»
    const finish = (move: 'up' | 'down' | 'left' | 'right' | 'none' | 'cancel') => {
      if (move === 'cancel') st.cancelEdit()
      else st.commitEdit(move)
      mainRef.current?.focus({ preventScroll: true })
    }
    if (e.key === 'Enter') {
      finish(e.shiftKey ? 'up' : 'down')
      e.preventDefault()
    } else if (e.key === 'Tab') {
      finish(e.shiftKey ? 'left' : 'right')
      e.preventDefault()
    } else if (e.key === 'Escape') {
      finish('cancel')
      e.preventDefault()
    }
  }

  const onEditorBlur = () => {
    // уход фокуса фиксирует правку (клик по другой панели/ячейке)
    const st = gridStore.getState()
    if (st.edit) st.commitEdit('none')
    mainRef.current?.focus({ preventScroll: true })
  }

  const editorStyle = (() => {
    const el = scrollRef.current
    if (!edit || !el) return undefined
    const i = Math.max(0, layout.indexOf(edit.row))
    const r = cellRect(i, edit.col, el.scrollLeft, el.scrollTop)
    return { left: r.x - 1, top: r.y - 1, width: r.w + 1, height: r.h + 1 }
  })()

  const size = totalSize(layout.count, cols)

  return (
    <main
      ref={mainRef}
      className="grid-area"
      role="grid"
      aria-label={t.gridArea}
      aria-rowcount={rows}
      aria-colcount={cols}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onTouchStart={onTouchStart}
      onContextMenu={onContextMenu}
    >
      <div className="grid-scroll" ref={scrollRef}>
        <div className="grid-spacer" ref={spacerRef} style={{ width: size.w, height: size.h }} />
      </div>
      <canvas className="grid-canvas" ref={canvasRef} />
      {cellEdit && (
        <input
          ref={editorRef}
          className="grid-editor"
          style={editorStyle}
          value={cellEdit.value}
          onChange={(e) => {
            gridStore.getState().setEditValue(e.target.value)
            assist.sync(e.target.selectionStart ?? 0)
          }}
          onSelect={(e) => assist.sync(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onEditorKeyDown}
          onBlur={onEditorBlur}
          aria-label={t.cellEditorLabel}
          spellCheck={false}
        />
      )}
      {cellEdit && assist.assist && (
        <AssistPopup
          anchor={editorRef}
          assist={assist.assist}
          activeIdx={assist.activeIdx}
          onPick={assist.pick}
        />
      )}
      {altLabel && (
        <div
          className="alt-sum-label"
          style={{ left: altLabel.x, top: altLabel.y }}
          aria-live="polite"
        >
          {altLabel.text}
        </div>
      )}
      {ctxMenu && (
        <ContextMenu
          key={`${ctxMenu.row}:${ctxMenu.col}`}
          x={ctxMenu.x}
          y={ctxMenu.y}
          row={ctxMenu.row}
          col={ctxMenu.col}
          onClose={() => {
            setCtxMenu(null)
            mainRef.current?.focus({ preventScroll: true })
          }}
        />
      )}
      {colMenu && (
        <ColumnMenu
          key={colMenu.col}
          col={colMenu.col}
          x={colMenu.x}
          y={colMenu.y}
          onClose={() => {
            setColMenu(null)
            mainRef.current?.focus({ preventScroll: true })
          }}
        />
      )}
    </main>
  )
}
