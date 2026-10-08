/*
 * Канвас-рендер грида: за кадр рисуются только видимые ячейки (виртуализация).
 * Функция чистая от DOM-событий — состояние приходит параметрами, что делает
 * кадр детерминированным и дешёвым (стресс 100k×30 = те же ~400 прямоугольников).
 */

import { normalize, type Range, type Selection } from '../core/selection'
import { getCell, isNumericCell, type SheetModel } from '../core/sheet'
import type { EditState } from '../core/store'
import { colName, METRICS, visibleCols, visibleRows } from './geometry'

export interface GridTheme {
  ink: string
  inkSoft: string
  bg: string
  surface: string
  gridLine: string
  limeFill: string
  limeBorder: string
  altFill: string
  altBorder: string
  greenBorder: string
  fontCell: string
  fontHeader: string
}

const FALLBACK_FONT = '"Open Sans", "Segoe UI", system-ui, sans-serif'

export function themeFromCSS(): GridTheme {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback
  return {
    ink: v('--nv-ink', '#2b2b2b'),
    inkSoft: v('--nv-ink-soft', '#9a9a9a'),
    bg: v('--nv-bg', '#ffffff'),
    surface: v('--nv-surface', '#ededeb'),
    gridLine: v('--nv-grid-line', '#e4e4e1'),
    limeFill: 'rgba(58, 223, 99, 0.12)',
    limeBorder: v('--nv-primary', '#3adf63'),
    altFill: 'rgba(242, 107, 33, 0.10)',
    altBorder: v('--nv-accent', '#f26b21'),
    greenBorder: v('--nv-primary-deep', '#2ba84a'),
    fontCell: `13.5px ${FALLBACK_FONT}`,
    fontHeader: `600 12px ${FALLBACK_FONT}`,
  }
}

export interface DrawStats {
  frames: number
  totalMs: number
  lastMs: number
}

/** Накопительная статистика кадров — читается e2e через тест-хук (?test=1). */
export const drawStats: DrawStats = { frames: 0, totalMs: 0, lastMs: 0 }

export interface DrawInput {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  scrollX: number
  scrollY: number
  sheet: SheetModel
  selection: Selection
  edit: EditState | null
  altRange: Range | null
  theme: GridTheme
}

export interface VisibleRegion {
  firstRow: number
  lastRow: number
  firstCol: number
  lastCol: number
}

export function drawGrid(input: DrawInput): VisibleRegion {
  const t0 = performance.now()
  const { ctx, width, height, scrollX, scrollY, sheet, selection, edit, altRange, theme } = input
  const m = METRICS

  const rows = visibleRows(scrollY, height - m.headerH)
  const cols = visibleCols(scrollX, width - m.rowHeaderW)
  const lastRow = Math.min(rows.last, sheet.rows - 1)
  const lastCol = Math.min(cols.last, sheet.cols - 1)

  ctx.save()
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, width, height)

  // контент обрезается областью таблицы — прокручиваясь, уходит под шапки
  ctx.beginPath()
  ctx.rect(m.rowHeaderW, m.headerH, width - m.rowHeaderW, height - m.headerH)
  ctx.clip()

  // ── линии сетки ──
  ctx.strokeStyle = theme.gridLine
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let r = rows.first; r <= lastRow + 1; r++) {
    const y = m.headerH + r * m.rowH - scrollY + 0.5
    ctx.moveTo(m.rowHeaderW, y)
    ctx.lineTo(width, y)
  }
  for (let c = cols.first; c <= lastCol + 1; c++) {
    const x = m.rowHeaderW + c * m.colW - scrollX + 0.5
    ctx.moveTo(x, m.headerH)
    ctx.lineTo(x, height)
  }
  ctx.stroke()

  // ── текст ячеек (числа — вправо, текст — влево) ──
  ctx.font = theme.fontCell
  ctx.textBaseline = 'middle'
  ctx.fillStyle = theme.ink
  ctx.textAlign = 'left'
  const pad = 6
  for (let r = rows.first; r <= lastRow; r++) {
    const cy = m.headerH + r * m.rowH - scrollY + m.rowH / 2
    for (let c = cols.first; c <= lastCol; c++) {
      const raw = getCell(sheet, r, c)
      if (raw === '') continue
      if (edit && edit.row === r && edit.col === c) continue
      const x = m.rowHeaderW + c * m.colW - scrollX
      const numeric = isNumericCell(sheet, r, c)
      const text = ellipsize(ctx, raw, m.colW - pad * 2)
      if (numeric) {
        ctx.textAlign = 'right'
        ctx.fillText(text, x + m.colW - pad, cy)
        ctx.textAlign = 'left'
      } else {
        ctx.fillText(text, x + pad, cy)
      }
    }
  }

  // ── заливки и рамки выделения (Ф5: каждая область со своей рамкой) ──
  for (const rg of selection.ranges) {
    const n = normalize(rg)
    paintRange(
      ctx,
      n.r1,
      n.c1,
      n.r2,
      n.c2,
      scrollX,
      scrollY,
      theme.limeFill,
      theme.limeBorder,
      width,
      height,
    )
  }
  // активная ячейка — толстая зелёная рамка поверх заливки
  {
    const { row, col } = selection.active
    const x = m.rowHeaderW + col * m.colW - scrollX
    const y = m.headerH + row * m.rowH - scrollY
    if (x + m.colW > m.rowHeaderW && y + m.rowH > m.headerH && x < width && y < height) {
      ctx.strokeStyle = theme.greenBorder
      ctx.lineWidth = 2
      ctx.strokeRect(x + 1, y + 1, m.colW - 2, m.rowH - 2)
    }
  }
  // Alt-лассо — оранжевая рамка быстрой суммы (Ф4)
  if (altRange) {
    const n = normalize(altRange)
    paintRange(
      ctx,
      n.r1,
      n.c1,
      n.r2,
      n.c2,
      scrollX,
      scrollY,
      theme.altFill,
      theme.altBorder,
      width,
      height,
    )
  }
  ctx.restore()

  // ── шапки (поверх контента — sticky) ──
  drawHeaders(
    ctx,
    width,
    height,
    scrollX,
    scrollY,
    cols.first,
    lastCol,
    rows.first,
    lastRow,
    selection,
    theme,
  )

  const ms = performance.now() - t0
  drawStats.frames++
  drawStats.totalMs += ms
  drawStats.lastMs = ms
  return { firstRow: rows.first, lastRow, firstCol: cols.first, lastCol }
}

function paintRange(
  ctx: CanvasRenderingContext2D,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  scrollX: number,
  scrollY: number,
  fill: string,
  border: string,
  width: number,
  height: number,
): void {
  const m = METRICS
  const x = m.rowHeaderW + c1 * m.colW - scrollX
  const y = m.headerH + r1 * m.rowH - scrollY
  const w = (c2 - c1 + 1) * m.colW
  const h = (r2 - r1 + 1) * m.rowH
  if (x + w <= m.rowHeaderW || y + h <= m.headerH || x >= width || y >= height) return
  ctx.fillStyle = fill
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = border
  ctx.lineWidth = 2
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
}

function drawHeaders(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scrollX: number,
  scrollY: number,
  firstCol: number,
  lastCol: number,
  firstRow: number,
  lastRow: number,
  selection: Selection,
  theme: GridTheme,
): void {
  const m = METRICS
  const selected = selection.ranges.map(normalize)

  // полоса заголовков колонок + заголовок строк + уголок — surface
  ctx.fillStyle = theme.surface
  ctx.fillRect(0, 0, width, m.headerH)
  ctx.fillRect(0, m.headerH, m.rowHeaderW, height - m.headerH)

  ctx.strokeStyle = theme.gridLine
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, m.headerH + 0.5)
  ctx.lineTo(width, m.headerH + 0.5)
  ctx.moveTo(m.rowHeaderW + 0.5, 0)
  ctx.lineTo(m.rowHeaderW + 0.5, height)
  ctx.stroke()

  ctx.font = theme.fontHeader
  ctx.textBaseline = 'middle'

  // буквы колонок
  for (let c = firstCol; c <= lastCol; c++) {
    const x = m.rowHeaderW + c * m.colW - scrollX
    if (x + m.colW <= m.rowHeaderW || x >= width) continue
    const isSel = selected.some((n) => c >= n.c1 && c <= n.c2)
    if (isSel) {
      ctx.fillStyle = theme.bg
      ctx.fillRect(x, 0, m.colW, m.headerH)
    }
    ctx.fillStyle = isSel ? theme.greenBorder : theme.inkSoft
    ctx.textAlign = 'center'
    ctx.fillText(colName(c), x + m.colW / 2, m.headerH / 2)
  }

  // номера строк
  ctx.textAlign = 'center'
  for (let r = firstRow; r <= lastRow; r++) {
    const y = m.headerH + r * m.rowH - scrollY
    if (y + m.rowH <= m.headerH || y >= height) continue
    const isSel = selected.some((n) => r >= n.r1 && r <= n.r2)
    if (isSel) {
      ctx.fillStyle = theme.bg
      ctx.fillRect(0, y, m.rowHeaderW, m.rowH)
    }
    ctx.fillStyle = isSel ? theme.greenBorder : theme.inkSoft
    ctx.fillText(String(r + 1), m.rowHeaderW / 2, y + m.rowH / 2)
  }
}

/** Обрезка текста под ширину ячейки с многоточием. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  const ellipsis = '…'
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxW) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + ellipsis
}
