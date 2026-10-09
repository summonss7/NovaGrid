/*
 * Канвас-грид (решение спайка — собственный грид, docs/SPIKE-1-GRID.md):
 * прокрутка нативная (spacer в .grid-scroll), рендер — канвас поверх вьюпорта,
 * за кадр рисуются только видимые ячейки. Все жесты (Shift/Ctrl/Alt/ПКМ)
 * транслируются в действия стора, логика выделения живёт в core/selection.
 *
 * Этап 3: координаты строк идут через RowLayout (фильтры скрывают строки),
 * ПКМ открывает контекстное меню фильтрации (Ф3), кнопка ▾/воронка в шапке —
 * меню колонки, Esc сначала закрывает поиск.
 */

import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { visibleRowsOf, type ColumnFilter } from '../core/filter'
import { normalize, inSelection } from '../core/selection'
import { gridStore, rangeMetrics } from '../core/store'
import type { SheetModel } from '../core/sheet'
import { ru } from '../i18n/ru'
import { ContextMenu } from '../ui/ContextMenu'
import { ColumnMenu } from '../ui/ColumnMenu'
import {
  cellAtPoint,
  cellRect,
  METRICS,
  rowLayoutOf,
  scrollIntoView,
  totalSize,
  type RowLayout,
} from './geometry'
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

export function GridCanvas() {
  const mainRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const editorRef = useRef<HTMLInputElement>(null)
  const themeRef = useRef<GridTheme | null>(null)
  const dragModeRef = useRef<DragMode>(null)
  const altAnchorRef = useRef<{ row: number; col: number } | null>(null)
  const lastActiveRef = useRef('')
  const regionRef = useRef<VisibleRegion | null>(null)
  const rafRef = useRef(0)
  const [altLabel, setAltLabel] = useState<AltLabel | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null)
  const [colMenu, setColMenu] = useState<ColMenuState | null>(null)

  const edit = useStore(gridStore, (s) => s.edit)
  const sheet = useStore(gridStore, (s) => s.sheet)
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
    themeRef.current = themeFromCSS()

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
    const ro = new ResizeObserver(scheduleDraw)
    if (mainRef.current) ro.observe(mainRef.current)
    draw()
    // после загрузки переменных шрифтов канвас перерисовывается корректным начертанием
    void document.fonts.ready.then(draw)

    return () => {
      unsub()
      scrollEl?.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
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

  // ── мышь ──────────────────────────────────────────────────────────────
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
      text: `${ru.altSum} ${m.total.toLocaleString('ru-RU')}`,
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
      return
    }
    if (hit.kind === 'rowHeader') {
      mainRef.current?.focus({ preventScroll: true })
      gridStore.getState().selectRow(hit.row)
      return
    }
    mainRef.current?.focus({ preventScroll: true })
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

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
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

  const onPointerUp = () => {
    if (dragModeRef.current === 'alt') {
      // лассо показало сумму и отпущено — вернуть обычное выделение (Ф4)
      gridStore.getState().setAltRange(null)
      setAltLabel(null)
    }
    dragModeRef.current = null
  }

  const onContextMenu = (e: React.MouseEvent<HTMLElement>) => {
    // меню ПКМ-фильтра (Ф3): по ячейке — фильтрация, по шапке — меню колонки
    e.preventDefault()
    const { x, y } = localPoint(e.clientX, e.clientY)
    const hit = cellFromPoint(x, y)
    if (!hit) return
    if (hit.kind === 'colHeader') {
      setColMenu({ col: hit.col, x: e.clientX, y: e.clientY })
      return
    }
    if (hit.kind !== 'cell') return
    const st = gridStore.getState()
    // Excel-поведение: ПКМ вне выделения выбирает ячейку
    if (!inSelection(st.selection, hit.row, hit.col)) st.clickCell(hit.row, hit.col)
    setCtxMenu({ row: hit.row, col: hit.col, x: e.clientX, y: e.clientY })
  }

  // ── клавиатура ────────────────────────────────────────────────────────
  const visibleRowCount = () => {
    const main = mainRef.current
    return main ? Math.max(1, Math.floor((main.clientHeight - METRICS.headerH) / METRICS.rowH)) : 10
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
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
    if (e.key.length === 1 && !mod && !e.altKey) {
      st.beginEdit(e.key)
      e.preventDefault()
    }
  }

  // ── редактор ячейки ───────────────────────────────────────────────────
  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
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
      aria-label={ru.gridArea}
      aria-rowcount={rows}
      aria-colcount={cols}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
    >
      <div className="grid-scroll" ref={scrollRef}>
        <div className="grid-spacer" style={{ width: size.w, height: size.h }} />
      </div>
      <canvas className="grid-canvas" ref={canvasRef} />
      {edit && (
        <input
          ref={editorRef}
          className="grid-editor"
          style={editorStyle}
          value={edit.value}
          onChange={(e) => gridStore.getState().setEditValue(e.target.value)}
          onKeyDown={onEditorKeyDown}
          onBlur={onEditorBlur}
          aria-label={ru.cellEditorLabel}
          spellCheck={false}
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
