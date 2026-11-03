/*
 * Канвас-рендер грида: за кадр рисуются только видимые ячейки (виртуализация).
 * Функция чистая от DOM-событий — состояние приходит параметрами, что делает
 * кадр детерминированным и дешёвым (стресс 100k×30 = те же ~400 прямоугольников).
 *
 * Этап 3: строки идут через RowLayout (фильтры скрывают строки — рисуется
 * визуальный индекс, номер строки в шапке остаётся модельным), совпадения
 * поиска подсвечиваются мятным фоном (текущее — оранжевая рамка), у колонок
 * с фильтром рисуется воронка, у остальных — кнопка меню ▾.
 */

import { type MergeRect, mergeAt } from '../core/merges'
import { normalize, type Range, type Selection } from '../core/selection'
import { cellKey, formatCellDisplay, type CellStyle, type SheetModel } from '../core/sheet'
import type { EditState } from '../core/store'
import { cellError, cellIsFrozen, cellNumber, cellText } from '../formula/engine'
import type { DepRect } from '../formula/parser'
import {
  colName,
  type ColLayout,
  type FreezeView,
  METRICS,
  type RowLayout,
  visibleRows,
} from './geometry'

export interface GridTheme {
  ink: string
  inkSoft: string
  /** ошибки формул — тёплый оранжевый глубокой тональности (Ф6) */
  errInk: string
  bg: string
  surface: string
  gridLine: string
  limeFill: string
  limeBorder: string
  mintFill: string
  altFill: string
  altBorder: string
  greenBorder: string
  fontCell: string
  fontCellBold: string
  fontHeader: string
  /** базовый px шрифта ячейки (без стилевого размера) — для cellFontOf (novagrid-039) */
  cellPx: number
}

const FALLBACK_FONT = '"Open Sans", "Segoe UI", system-ui, sans-serif'
const DISPLAY_FONT = '"Montserrat", "Open Sans", "Segoe UI", system-ui, sans-serif'

/**
 * Шрифт канваса ячейки из её стиля (novagrid-039): гарнитура, размер (pt → px
 * как в Excel, 96 dpi), курсив и жирность. Без стиля — стандартный шрифт грида.
 */
export function cellFontOf(style: CellStyle | undefined, theme: GridTheme): string {
  const italic = style?.italic ? 'italic ' : ''
  const weight = style?.bold ? '600 ' : ''
  const px = style?.size ? Math.round(((style.size * 4) / 3) * 10) / 10 : theme.cellPx
  const family = style?.font === 'display' ? DISPLAY_FONT : FALLBACK_FONT
  return `${italic}${weight}${px}px ${family}`
}

/** Размер шрифта ячейки в px — для подчёркивания и метки ∛ (novagrid-039). */
export function cellPxOf(style: CellStyle | undefined, theme: GridTheme): number {
  return style?.size ? Math.round(((style.size * 4) / 3) * 10) / 10 : theme.cellPx
}

/** Тема из CSS-токенов; scale = зум таблицы — шрифты масштабируются вместе
 *  с ячейками (Этап 5.3), иначе отдалённые ячейки рваные, а приближённые пустые. */
export function themeFromCSS(scale = 1): GridTheme {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback
  const cellPx = Math.round(13.5 * scale * 10) / 10
  const headerPx = Math.round(12 * scale * 10) / 10
  return {
    ink: v('--nv-ink', '#2b2b2b'),
    inkSoft: v('--nv-ink-soft', '#6b6b6b'),
    errInk: v('--nv-danger-text', '#c23a10'),
    bg: v('--nv-bg', '#ffffff'),
    surface: v('--nv-surface', '#ededeb'),
    gridLine: v('--nv-grid-line', '#e4e4e1'),
    limeFill: v('--nv-cell-selected-bg', 'rgba(58, 223, 99, 0.12)'),
    limeBorder: v('--nv-primary', '#3adf63'),
    mintFill: v('--nv-mint', '#e8f8ec'),
    altFill: v('--nv-cell-alt-bg', 'rgba(242, 107, 33, 0.10)'),
    altBorder: v('--nv-accent', '#f26b21'),
    greenBorder: v('--nv-primary-deep', '#2ba84a'),
    fontCell: `${cellPx}px ${FALLBACK_FONT}`,
    fontCellBold: `600 ${cellPx}px ${FALLBACK_FONT}`,
    fontHeader: `600 ${headerPx}px ${FALLBACK_FONT}`,
    cellPx,
  }
}

export interface DrawStats {
  frames: number
  totalMs: number
  lastMs: number
}

/** Накопительная статистика кадров — читается e2e через тест-хук (?test=1). */
export const drawStats: DrawStats = { frames: 0, totalMs: 0, lastMs: 0 }

/** Подсветка поиска (Ф2): множество ключей «row:col» + текущее совпадение. */
export interface SearchHighlight {
  hitSet: ReadonlySet<string>
  currentKey: string | null
}

/**
 * Палитра рамок ссылок редактируемой формулы (novagrid-041): как в Excel,
 * каждая ссылка — свой цвет, по кругу. Зелёный исключён — он занят
 * выделением/активной ячейкой.
 */
export const EDIT_REF_COLORS = [
  '#2f6bdf', // синий
  '#9c4ad1', // фиолетовый
  '#e07b24', // оранжевый
  '#12958c', // бирюзовый
  '#d5457d', // розовый
  '#6f7bd6', // лавандовый
] as const

/** «#rrggbb» → «rgba(r, g, b, a)» — лёгкая заливка под рамкой ссылки. */
function withAlpha(hex: string, a: number): string {
  const v = parseInt(hex.slice(1), 16)
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`
}

export interface DrawInput {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  scrollX: number
  scrollY: number
  sheet: SheetModel
  /** унифицированная раскладка строк: 0..fr−1 — закреплённые (novagrid-044) */
  layout: RowLayout
  /** раскладка ширин колонок — переменные ширины после перетаскивания (novagrid-020) */
  cols: ColLayout
  /** закреплённые строки/колонки (novagrid-044); отсутствие — как {0,0} */
  frozen?: FreezeView
  /** тег локали словаря — формат числа (novagrid-045) */
  locale: string
  selection: Selection
  edit: EditState | null
  altRange: Range | null
  search: SearchHighlight
  /** колонки с активным фильтром — воронка в заголовке (Ф3.6) */
  filteredCols: ReadonlySet<number>
  /** ссылки редактируемой формулы — цветные рамки ячеек-источников (novagrid-041) */
  editRefs?: readonly DepRect[]
  theme: GridTheme
}

export interface VisibleRegion {
  firstRow: number
  lastRow: number
  firstCol: number
  lastCol: number
}

/**
 * Прямоугольная область отрисовки (novagrid-044): закреп дробит кадр на
 * до четырёх прямоугольников (закреп×закреп, закреп×скролл, …); без закрепа
 * область одна и код идентичен прежнему одному проходу.
 */
interface Region {
  x: number
  y: number
  w: number
  h: number
  /** диапазон унифицированных визуальных строк (включительно) */
  rowFrom: number
  rowTo: number
  /** диапазон колонок (включительно) */
  colFrom: number
  colTo: number
}

export function drawGrid(input: DrawInput): VisibleRegion {
  const t0 = performance.now()
  const {
    ctx,
    width,
    height,
    scrollX,
    scrollY,
    sheet,
    layout,
    cols,
    frozen,
    locale,
    selection,
    edit,
    altRange,
    search,
    filteredCols,
    editRefs,
    theme,
  } = input
  const m = METRICS

  const fr = frozen?.rows ?? 0
  const fc = frozen?.cols ?? 0
  const fy = fr * m.rowH
  const fx = fc > 0 ? cols.x0(fc) : 0
  // закреп не шире листа
  const frOk = Math.min(fr, layout.count)
  const fcOk = Math.min(fc, cols.count)

  // y унифицированной строки: закреп стоит под шапкой, дальше — прокрутка
  const rowY = (i: number) =>
    i < frOk ? m.headerH + i * m.rowH : m.headerH + fy + (i - frOk) * m.rowH - scrollY
  // x колонки: закреплённые не прокручиваются
  const colX = (c: number) => m.rowHeaderW + cols.x0(c) - (c < fcOk ? 0 : scrollX)

  const svRows = visibleRows(scrollY, height - m.headerH - fy)
  const scrollRowFrom = Math.min(frOk + svRows.first, layout.count - 1)
  const scrollRowTo = Math.min(frOk + svRows.last, layout.count - 1)
  const svCols = cols.visible(width - m.rowHeaderW - fx, scrollX + fx)
  const scrollColTo = Math.min(svCols.last, sheet.cols - 1)
  const lastRow = scrollRowTo
  const lastCol = scrollColTo

  // области кадра: закреп×закреп, закреп×скролл, скролл×закреп, скролл×скролл
  const regions: Region[] = []
  if (frOk > 0 && fcOk > 0)
    regions.push({
      x: m.rowHeaderW,
      y: m.headerH,
      w: fx,
      h: fy,
      rowFrom: 0,
      rowTo: frOk - 1,
      colFrom: 0,
      colTo: fcOk - 1,
    })
  if (frOk > 0)
    regions.push({
      x: m.rowHeaderW + fx,
      y: m.headerH,
      w: width - m.rowHeaderW - fx,
      h: fy,
      rowFrom: 0,
      rowTo: frOk - 1,
      colFrom: Math.max(svCols.first, fcOk),
      colTo: scrollColTo,
    })
  if (fcOk > 0)
    regions.push({
      x: m.rowHeaderW,
      y: m.headerH + fy,
      w: fx,
      h: height - m.headerH - fy,
      rowFrom: scrollRowFrom,
      rowTo: scrollRowTo,
      colFrom: 0,
      colTo: fcOk - 1,
    })
  regions.push({
    x: m.rowHeaderW + fx,
    y: m.headerH + fy,
    w: width - m.rowHeaderW - fx,
    h: height - m.headerH - fy,
    rowFrom: frOk > 0 || fcOk > 0 ? scrollRowFrom : Math.min(svRows.first, layout.count - 1),
    rowTo: scrollRowTo,
    colFrom: Math.max(svCols.first, fcOk),
    colTo: scrollColTo,
  })

  // «пустое место» за границей листа (novagrid-035) — только в прокручиваемой
  // области: сетка и заголовки рисуются до края окна (как в Excel)
  const contentRight =
    m.rowHeaderW + (sheet.cols > 0 ? cols.x0(sheet.cols - 1) + cols.width(sheet.cols - 1) : 0)
  const fillerCols = Math.max(
    0,
    Math.ceil((width - (contentRight - scrollX)) / m.colW),
  )
  const contentBottom = m.headerH + layout.count * m.rowH
  const fillerRows = Math.max(0, Math.ceil((height - (contentBottom - scrollY)) / m.rowH))

  ctx.save()
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, width, height)

  for (const reg of regions) {
    if (reg.w <= 0 || reg.h <= 0 || reg.rowFrom > reg.rowTo || reg.colFrom > reg.colTo) continue
    ctx.save()
    // контент обрезается областью — прокручиваясь, уходит под шапки и закреп
    ctx.beginPath()
    ctx.rect(reg.x, reg.y, reg.w, reg.h)
    ctx.clip()

    // ── заливки стилей: до сетки — линии остаются поверх ──
    for (let i = reg.rowFrom; i <= reg.rowTo; i++) {
      const r = layout.rowAt(i)
      const y = rowY(i)
      if (y + m.rowH <= reg.y || y >= reg.y + reg.h) continue
      for (let c = reg.colFrom; c <= reg.colTo; c++) {
        const bg = sheet.styles.get(cellKey(r, c))?.bg
        if (!bg) continue
        const x = colX(c)
        const w = cols.width(c)
        if (x + w <= reg.x || x >= reg.x + reg.w) continue
        ctx.fillStyle = `#${bg}`
        ctx.fillRect(x, y, w, m.rowH)
      }
    }

    // ── линии сетки ──
    ctx.strokeStyle = theme.gridLine
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = reg.rowFrom; i <= reg.rowTo + 1; i++) {
      const y = rowY(i) + 0.5
      if (y < reg.y || y > reg.y + reg.h) continue
      ctx.moveTo(Math.max(reg.x, m.rowHeaderW), y)
      ctx.lineTo(reg.x + reg.w, y)
    }
    for (let c = reg.colFrom; c <= reg.colTo + 1; c++) {
      const x = colX(c) + 0.5
      if (x < reg.x || x > reg.x + reg.w) continue
      ctx.moveTo(x, Math.max(reg.y, m.headerH))
      ctx.lineTo(x, reg.y + reg.h)
    }
    // заполнитель до края окна — только прокручиваемая область
    if (reg.rowFrom >= frOk && reg.colFrom >= fcOk) {
      for (let k = 1; k <= fillerCols; k++) {
        const x = contentRight - scrollX + k * m.colW + 0.5
        if (x > width) break
        ctx.moveTo(x, Math.max(reg.y, m.headerH))
        ctx.lineTo(x, reg.y + reg.h)
      }
      for (let k = 1; k <= fillerRows; k++) {
        const y = contentBottom - scrollY + k * m.rowH + 0.5
        if (y > height) break
        ctx.moveTo(Math.max(reg.x, m.rowHeaderW), y)
        ctx.lineTo(reg.x + reg.w, y)
      }
    }
    ctx.stroke()

    // ── объединённые ячейки (novagrid-047): одна область — внутренние линии
    // сетки стерты, фон левой верхней ячейки, рамка по периметру ──
    if (sheet.merges && sheet.merges.length > 0) {
      for (const mg of sheet.merges) {
        const r = mergeAreaRect(mg, layout, reg, cols, rowY, colX)
        if (!r) continue
        const bg = sheet.styles.get(cellKey(mg.r1, mg.c1))?.bg
        ctx.fillStyle = bg ? `#${bg}` : theme.bg
        ctx.fillRect(r.x, r.y, r.w, r.h)
        ctx.strokeStyle = theme.gridLine
        ctx.lineWidth = 1
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
      }
    }

    // ── подсветка совпадений поиска (Ф2): мятный фон под текстом ──
    if (search.hitSet.size > 0) {
      ctx.fillStyle = theme.mintFill
      for (let i = reg.rowFrom; i <= reg.rowTo; i++) {
        const r = layout.rowAt(i)
        const y = rowY(i)
        if (y + m.rowH <= reg.y || y >= reg.y + reg.h) continue
        for (let c = reg.colFrom; c <= reg.colTo; c++) {
          if (!search.hitSet.has(`${r}:${c}`)) continue
          const x = colX(c)
          const w = cols.width(c)
          if (x + w <= reg.x || x >= reg.x + reg.w) continue
          // совпадение в объединённой ячейке красит её целиком; скрытые
          // ячейки не совпадаются (пусты) — сюда не попадают
          const mg = mergeAt(sheet, r, c)
          const span = mg ? mergeSpan(mg, layout, cols, rowY, colX) : null
          if (span) ctx.fillRect(span.x + 1, span.y + 1, span.w - 2, span.h - 2)
          else ctx.fillRect(x + 1, y + 1, w - 2, m.rowH - 2)
        }
      }
    }

    // ── текст ячеек: формулы показывают вычисленное значение (Этап 4),
    // ошибки — тёплым цветом, чужие формулы — с меткой «∛ не пересчитывается»
    // формат числа (novagrid-045) применяется к отображению ──
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    const pad = 6
    for (let i = reg.rowFrom; i <= reg.rowTo; i++) {
      const r = layout.rowAt(i)
      const y = rowY(i)
      const cy = y + m.rowH / 2
      if (y + m.rowH <= reg.y || y >= reg.y + reg.h) continue
      for (let c = reg.colFrom; c <= reg.colTo; c++) {
        const raw = sheet.cells.get(cellKey(r, c))
        if (raw === undefined) continue
        // скрытые ячейки объединения не рисуются; текст левой верхней
        // размещается по всей площади объединения (novagrid-047)
        const mg = mergeAt(sheet, r, c)
        if (mg && (r !== mg.r1 || c !== mg.c1)) continue
        // правка ячейки рисуется редактором; правка из строки формул — нет
        if (edit && edit.row === r && edit.col === c && edit.source !== 'bar') continue
        let x = colX(c)
        let w = cols.width(c)
        let cellCy = cy
        if (mg) {
          const span = mergeSpan(mg, layout, cols, rowY, colX)
          if (span) {
            x = span.x
            w = span.w
            cellCy = span.y + span.h / 2
          }
        }
        const style = sheet.styles.get(cellKey(r, c))
        const isFormula = raw.startsWith('=') && raw.trim().length > 1
        const computed = isFormula ? cellText(sheet, r, c) : raw
        const text = style?.fmt ? formatCellDisplay(computed, style.fmt, locale) : computed
        if (text === '') continue
        const numeric = cellNumber(sheet, r, c) !== null
        const err = isFormula ? cellError(sheet, r, c) : null
        const frozenCell = isFormula ? cellIsFrozen(sheet, r, c) : false
        // шрифт собирается из стиля ячейки: гарнитура/размер/Ж/К (novagrid-039)
        ctx.font = cellFontOf(style, theme)
        ctx.fillStyle = style?.fg ? `#${style.fg}` : err ? theme.errInk : theme.ink
        const shown = ellipsize(ctx, text, w - pad * 2)
        const align = style?.align ?? (numeric ? 'right' : 'left')
        let textX = x + pad
        if (align === 'right') {
          textX = x + w - pad
          ctx.textAlign = 'right'
        } else if (align === 'center') {
          textX = x + w / 2
          ctx.textAlign = 'center'
        }
        ctx.fillText(shown, textX, cellCy)
        if (align !== 'left') ctx.textAlign = 'left'
        // подчёркивание (novagrid-039): линия шириной текста под базовой линией
        if (style?.underline) {
          const textW = ctx.measureText(shown).width
          const lineX =
            align === 'right' ? textX - textW : align === 'center' ? textX - textW / 2 : textX
          const py = Math.round(cellCy + cellPxOf(style, theme) * 0.42) + 0.5
          ctx.fillRect(lineX, py, textW, 1)
        }
        // метка чужой формулы (∛) — маленький знак в правом верхнем углу
        if (frozenCell) {
          ctx.font = '10px ' + FALLBACK_FONT.slice(FALLBACK_FONT.indexOf('"'))
          ctx.fillStyle = theme.inkSoft
          ctx.fillText('∛', x + w - 10, y + 9)
          ctx.font = cellFontOf(style, theme)
        }
      }
    }
    ctx.font = theme.fontCell

    // ── заливки и рамки выделения (Ф5: каждая область со своей рамкой) ──
    for (const rg of selection.ranges) {
      const n = normalize(rg)
      paintRange(ctx, reg, n.r1, n.c1, n.r2, n.c2, layout, cols, rowY, colX, theme.limeFill, theme.limeBorder)
    }
    // активная ячейка — толстая зелёная рамка поверх заливки; объединённая
    // активная обводится целиком (novagrid-047)
    {
      const { row, col } = selection.active
      const i = layout.indexOf(row)
      if (i >= reg.rowFrom && i <= reg.rowTo && col >= reg.colFrom && col <= reg.colTo) {
        const mg = mergeAt(sheet, row, col)
        const span = mg ? mergeSpan(mg, layout, cols, rowY, colX) : null
        const x = span ? span.x : colX(col)
        const w = span ? span.w : cols.width(col)
        const y = span ? span.y : rowY(i)
        const h = span ? span.h : m.rowH
        ctx.strokeStyle = theme.greenBorder
        ctx.lineWidth = 2
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
      }
    }
    // ссылки редактируемой формулы — цветные рамки с лёгкой заливкой поверх
    if (editRefs && editRefs.length > 0) {
      editRefs.forEach((d, k) => {
        const color = EDIT_REF_COLORS[k % EDIT_REF_COLORS.length]
        paintRange(ctx, reg, d.r1, d.c1, d.r2, d.c2, layout, cols, rowY, colX, withAlpha(color, 0.1), color)
      })
    }
    // Alt-лассо — оранжевая рамка быстрой суммы (Ф4)
    if (altRange) {
      const n = normalize(altRange)
      paintRange(ctx, reg, n.r1, n.c1, n.r2, n.c2, layout, cols, rowY, colX, theme.altFill, theme.altBorder)
    }
    // текущее совпадение поиска — оранжевая рамка поверх всего (Ф2);
    // совпадение в объединённой ячейке обводит её целиком (novagrid-047)
    if (search.currentKey) {
      const csep = search.currentKey.indexOf(':')
      const hitRow = Number(search.currentKey.slice(0, csep))
      const hitCol = Number(search.currentKey.slice(csep + 1))
      const i = layout.indexOf(hitRow)
      if (i >= reg.rowFrom && i <= reg.rowTo && hitCol >= reg.colFrom && hitCol <= reg.colTo) {
        const mg = mergeAt(sheet, hitRow, hitCol)
        const span = mg ? mergeSpan(mg, layout, cols, rowY, colX) : null
        const x = span ? span.x : colX(hitCol)
        const w = span ? span.w : cols.width(hitCol)
        const y = span ? span.y : rowY(i)
        const h = span ? span.h : m.rowH
        ctx.strokeStyle = theme.altBorder
        ctx.lineWidth = 2
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
      }
    }
    ctx.restore()
  }
  ctx.restore()

  // ── шапки (поверх контента — sticky) ──
  drawHeaders(
    ctx,
    width,
    height,
    colX,
    rowY,
    frOk,
    fcOk,
    fcOk > 0 ? 0 : regions[regions.length - 1].colFrom,
    lastCol,
    frOk > 0 ? 0 : regions[regions.length - 1].rowFrom,
    lastRow,
    layout,
    cols,
    selection,
    filteredCols,
    theme,
    fillerCols,
    fillerRows,
    layout.count === sheet.rows,
  )

  const ms = performance.now() - t0
  drawStats.frames++
  drawStats.totalMs += ms
  drawStats.lastMs = ms
  return {
    firstRow: regions[regions.length - 1].rowFrom,
    lastRow,
    firstCol: regions[regions.length - 1].colFrom,
    lastCol,
  }
}

/** Габариты объединения в визуальных координатах; null — скрыто фильтром. */
function mergeSpan(
  mg: MergeRect,
  layout: RowLayout,
  cols: ColLayout,
  rowY: (i: number) => number,
  colX: (c: number) => number,
): { x: number; y: number; w: number; h: number } | null {
  const i1 = layout.indexOf(mg.r1)
  if (i1 < 0) return null
  const i2 = lastVisibleTill(layout, mg.r1, mg.r2)
  if (i2 < i1) return null
  const y = rowY(i1)
  const x = colX(mg.c1)
  return {
    x,
    y,
    w: colX(mg.c2) + cols.width(mg.c2) - x,
    h: rowY(i2) + METRICS.rowH - y,
  }
}

/** Прямоугольник объединения, обрезанный областью кадра (novagrid-047). */
function mergeAreaRect(
  mg: MergeRect,
  layout: RowLayout,
  reg: Region,
  cols: ColLayout,
  rowY: (i: number) => number,
  colX: (c: number) => number,
): { x: number; y: number; w: number; h: number } | null {
  const i1raw = layout.indexOf(mg.r1)
  const i1 = i1raw >= 0 ? i1raw : firstVisibleFrom(layout, mg.r1, mg.r2)
  const i2 = lastVisibleTill(layout, mg.r1, mg.r2)
  if (i1 < 0 || i2 < i1) return null
  const vi1 = Math.max(i1, reg.rowFrom)
  const vi2 = Math.min(i2, reg.rowTo)
  const cc1 = Math.max(mg.c1, reg.colFrom)
  const cc2 = Math.min(mg.c2, reg.colTo)
  if (vi1 > vi2 || cc1 > cc2) return null
  const m = METRICS
  const x = colX(cc1)
  const w = colX(cc2) + cols.width(cc2) - x
  const y = rowY(vi1)
  const h = rowY(vi2) + m.rowH - y
  if (x + w <= reg.x || y + h <= reg.y || x >= reg.x + reg.w || y >= reg.y + reg.h) return null
  return { x, y, w, h }
}

/** Край диапазона модели в визуальных индексах (скрытые фильтром — мимо). */
function paintRange(
  ctx: CanvasRenderingContext2D,
  reg: Region,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  layout: RowLayout,
  cols: ColLayout,
  rowY: (i: number) => number,
  colX: (c: number) => number,
  fill: string,
  border: string,
): void {
  // края диапазона могут попасть на скрытые строки — тогда берём ближайшие
  // видимые внутри диапазона; в визуальных индексах блок всегда сплошной
  const i1 = layout.indexOf(r1)
  const i2 = layout.indexOf(r2)
  if (i1 < 0 && i2 < 0) return
  const from = i1 >= 0 ? i1 : Math.max(0, firstVisibleFrom(layout, r1, r2))
  const to = i2 >= 0 ? i2 : lastVisibleTill(layout, r1, r2)
  // диапазон режется областью кадра (закреп рисуется своей областью)
  const vi1 = Math.max(from, reg.rowFrom)
  const vi2 = Math.min(to, reg.rowTo)
  const cc1 = Math.max(c1, reg.colFrom)
  const cc2 = Math.min(c2, reg.colTo)
  if (vi1 > vi2 || cc1 > cc2) return
  const m = METRICS
  const x = colX(cc1)
  const w = colX(cc2) + cols.width(cc2) - x
  const y = rowY(vi1)
  const h = rowY(vi2) + m.rowH - y
  if (x + w <= reg.x || y + h <= reg.y || x >= reg.x + reg.w || y >= reg.y + reg.h) return
  ctx.fillStyle = fill
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = border
  ctx.lineWidth = 2
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
}

/** Первый видимый индекс внутри модельного отрезка [r1, r2]. */
function firstVisibleFrom(layout: RowLayout, r1: number, r2: number): number {
  let lo = 0
  let hi = layout.count - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const v = layout.rowAt(mid)
    if (v >= r1 && v <= r2) {
      ans = mid
      hi = mid - 1
    } else if (v < r1) lo = mid + 1
    else hi = mid - 1
  }
  return ans
}

/** Последний видимый индекс внутри модельного отрезка [r1, r2]. */
function lastVisibleTill(layout: RowLayout, r1: number, r2: number): number {
  let lo = 0
  let hi = layout.count - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const v = layout.rowAt(mid)
    if (v >= r1 && v <= r2) {
      ans = mid
      lo = mid + 1
    } else if (v < r1) lo = mid + 1
    else hi = mid - 1
  }
  return ans
}

function drawHeaders(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colX: (c: number) => number,
  rowY: (i: number) => number,
  fr: number,
  fc: number,
  firstCol: number,
  lastCol: number,
  firstRow: number,
  lastRow: number,
  layout: RowLayout,
  cols: ColLayout,
  selection: Selection,
  filteredCols: ReadonlySet<number>,
  theme: GridTheme,
  fillerCols: number,
  fillerRows: number,
  fillerRowsNumbered: boolean,
): void {
  const m = METRICS
  const selected = selection.ranges.map(normalize)
  const fy = fr * m.rowH
  const fx = fc > 0 ? cols.x0(fc) : 0

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

  // буквы колонок + кнопка меню (▾ / воронка при фильтре); при закрепе
  // (novagrid-044) колонки от 0 — закреплённые всегда в кадре
  for (let c = firstCol; c <= lastCol; c++) {
    const x = colX(c)
    const w = cols.width(c)
    if (x + w <= m.rowHeaderW || x >= width) continue
    const isSel = selected.some((n) => c >= n.c1 && c <= n.c2)
    if (isSel) {
      ctx.fillStyle = theme.bg
      ctx.fillRect(x, 0, w, m.headerH)
    }
    ctx.fillStyle = isSel ? theme.greenBorder : theme.inkSoft
    ctx.textAlign = 'center'
    ctx.fillText(colName(c), x + w / 2, m.headerH / 2)
    if (filteredCols.has(c)) {
      drawFunnel(ctx, x + w - 15, 9, theme.greenBorder)
    } else {
      drawChevron(ctx, x + w - 15, m.headerH / 2, theme.inkSoft)
    }
  }

  // буквы виртуальных колонок заполнителя (novagrid-035): без меню-кнопки —
  // колонки ненастоящие, только продолжение сетки до края окна
  if (fillerCols > 0 && cols.count > 0) {
    const right = colX(cols.count - 1) + cols.width(cols.count - 1)
    ctx.fillStyle = theme.inkSoft
    ctx.textAlign = 'center'
    for (let k = 0; k < fillerCols; k++) {
      const x = right + k * m.colW
      if (x >= width) break
      ctx.fillText(colName(cols.count + k), x + m.colW / 2, m.headerH / 2)
    }
  }

  // номера строк (модельные — скрытые не сдвигают нумерацию); при закрепе
  // строки от 0 — закреплённые всегда в кадре (novagrid-044)
  ctx.textAlign = 'center'
  for (let i = firstRow; i <= lastRow; i++) {
    const r = layout.rowAt(i)
    const y = rowY(i)
    if (y + m.rowH <= m.headerH || y >= height) continue
    const isSel = selected.some((n) => r >= n.r1 && r <= n.r2)
    if (isSel) {
      ctx.fillStyle = theme.bg
      ctx.fillRect(0, y, m.rowHeaderW, m.rowH)
    }
    ctx.fillStyle = isSel ? theme.greenBorder : theme.inkSoft
    ctx.fillText(String(r + 1), m.rowHeaderW / 2, y + m.rowH / 2)
  }

  // номера виртуальных строк заполнителя — только без фильтров (иначе
  // визуальный индекс не совпадает с модельным номером)
  if (fillerRows > 0 && fillerRowsNumbered) {
    ctx.fillStyle = theme.inkSoft
    for (let k = 0; k < fillerRows; k++) {
      const y = rowY(layout.count + k)
      if (y >= height) break
      ctx.fillText(String(layout.count + k + 1), m.rowHeaderW / 2, y + m.rowH / 2)
    }
  }

  // линии закрепления (novagrid-044): заметнее сетки, как в Excel
  if (fr > 0 || fc > 0) {
    ctx.strokeStyle = theme.inkSoft
    ctx.lineWidth = 1
    ctx.beginPath()
    if (fr > 0) {
      ctx.moveTo(0, m.headerH + fy + 0.5)
      ctx.lineTo(width, m.headerH + fy + 0.5)
    }
    if (fc > 0) {
      ctx.moveTo(m.rowHeaderW + fx + 0.5, 0)
      ctx.lineTo(m.rowHeaderW + fx + 0.5, height)
    }
    ctx.stroke()
  }
}

/** Воронка фильтра (Ф3.6): зелёная, 12×12. */
function drawFunnel(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + 12, y)
  ctx.lineTo(x + 8.2, y + 4.6)
  ctx.lineTo(x + 8.2, y + 11)
  ctx.lineTo(x + 3.8, y + 12.8)
  ctx.lineTo(x + 3.8, y + 4.6)
  ctx.closePath()
  ctx.fill()
}

/** Кнопка меню колонки ▾ (Ф3.7): мягкая стрелка вниз. */
function drawChevron(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  ctx.strokeStyle = color
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(cx - 3.5, cy - 1.5)
  ctx.lineTo(cx, cy + 2)
  ctx.lineTo(cx + 3.5, cy - 1.5)
  ctx.stroke()
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
