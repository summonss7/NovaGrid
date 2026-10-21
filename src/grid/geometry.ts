/*
 * Геометрия грида — чистые функции перевода координат (юнит-тестируемы).
 * Все размеры — константы Этапа 1; переменные ширины колонок возможны позже
 * без изменения контрактов этих функций. Этап 3 добавляет RowLayout:
 * фильтры скрывают строки, и визуальный индекс перестаёт совпадать
 * с модельной строкой (индексация прокрутки/рисования — визуальная,
 * номера в заголовке строк и ссылки A1 — модельные).
 */

import { visibleIndexOf } from '../core/filter'

export interface GridMetrics {
  /** ширина заголовочной колонки (номера строк) */
  rowHeaderW: number
  /** высота заголовочной строки (буквы колонок) */
  headerH: number
  rowH: number
  colW: number
}

/** Перевод визуальный индекс ⇄ модельная строка при скрытых фильтром строках. */
export interface RowLayout {
  /** сколько строк видно (высота прокрутки = headerH + count·rowH) */
  count: number
  /** модельная строка по визуальному индексу */
  rowAt(index: number): number
  /** визуальный индекс модельной строки; −1 — строка скрыта */
  indexOf(row: number): number
}

/**
 * Раскладка: null (фильтров нет) — тождественная, без аллокаций, чтобы
 * стресс 100k не платил за фичу фильтрации.
 */
export function rowLayoutOf(totalRows: number, visible: readonly number[] | null): RowLayout {
  if (!visible) {
    return { count: totalRows, rowAt: (i) => i, indexOf: (r) => r }
  }
  const last = visible.length - 1
  return {
    count: visible.length,
    rowAt: (i) => visible[Math.min(Math.max(i, 0), last)] ?? -1,
    indexOf: (r) => visibleIndexOf(visible, r),
  }
}

/* ── переменные ширины колонок (карточка novagrid-020) ────────────────── */

/** Минимальная и максимальная ширина колонки в базовых единицах (зум 100 %).
 *  Предел 1000 px (novagrid-035): длинные наименования товаров нечитаемы
 *  при 400 — владелец упёрся в потолок, растягивая колонку. */
export const COL_W_MIN = 32
export const COL_W_MAX = 1000
/** Ширина по умолчанию — та же, что у базовых метрик. */
export const BASE_COL_W = 96

/** Ось колонок: x0/width enough для cellRect/cellAtPoint. */
export interface ColAxis {
  /** левый край колонки от начала контента (без rowHeaderW и прокрутки) */
  x0(col: number): number
  width(col: number): number
}

/**
 * Раскладка колонок с переменными ширинами (перетаскивание границ в шапке).
 * widths — переопределения в базовых единицах (зум 100 %); фактическая
 * ширина = round(base · зум), как у METRICS.colW по умолчанию. Без
 * переопределений — равномерная раскладка без аллокаций (стресс не платит).
 */
export interface ColLayout extends ColAxis {
  count: number
  /** общая ширина контента (правый край последней колонки) */
  totalW: number
  /** колонка по X контента; −1 — левее начала. За последней — count−1 */
  colAt(x: number): number
  /** видимые колонки вьюпорта шириной w при прокрутке scrollX */
  visible(w: number, scrollX: number): { first: number; last: number }
}

function uniformAxis(m: GridMetrics): ColAxis {
  return { x0: (c) => c * m.colW, width: () => m.colW }
}

/** Колонка по X контента: раскладка знает точные границы, равномерная — арифметика. */
function colAtAxis(axis: ColAxis, x: number, m: GridMetrics): number {
  const lay = axis as Partial<ColLayout>
  return typeof lay.colAt === 'function' ? lay.colAt(x) : Math.floor(x / m.colW)
}

function widthOf(base: number, m: GridMetrics): number {
  const screen = Math.round(base * (m.colW / BASE_COL_W))
  return Math.max(Math.round(COL_W_MIN * (m.colW / BASE_COL_W)), screen)
}

export function colLayoutOf(
  count: number,
  widths: ReadonlyMap<number, number> | null,
  m = METRICS,
): ColLayout {
  const entries =
    widths ? [...widths.entries()].filter(([c, w]) => c >= 0 && c < count && w > 0) : []
  entries.sort((a, b) => a[0] - b[0])
  if (entries.length === 0) {
    const totalW = count * m.colW
    return {
      count,
      totalW,
      ...uniformAxis(m),
      colAt: (x) => (x < 0 ? -1 : Math.min(Math.floor(x / m.colW), count - 1)),
      visible: (w, scrollX) => ({
        first: Math.max(0, Math.floor(scrollX / m.colW)),
        last: Math.min(count - 1, Math.max(0, Math.ceil((scrollX + w) / m.colW) - 1)),
      }),
    }
  }
  // префиксные суммы до последней тронутой колонки; дальше — дефолтные
  const lastTouched = entries[entries.length - 1][0]
  const prefix: number[] = [0]
  for (let c = 0; c <= lastTouched; c++) {
    const ov = entries.find(([ec]) => ec === c)
    prefix.push(prefix[prefix.length - 1] + (ov ? widthOf(ov[1], m) : m.colW))
  }
  // prefix[i] = левый край колонки i (для i ≤ lastTouched+1)
  const x0 = (c: number): number => {
    if (c <= lastTouched + 1) return prefix[Math.max(0, Math.min(c, lastTouched + 1))]
    return prefix[lastTouched + 1] + (c - lastTouched - 1) * m.colW
  }
  const width = (c: number): number => {
    if (c > lastTouched) return m.colW
    return x0(c + 1) - x0(c)
  }
  const colAt = (x: number): number => {
    if (x < 0) return -1
    let lo = 0
    let hi = count - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (x0(mid) <= x) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  return {
    count,
    get totalW() {
      return x0(count)
    },
    x0,
    width,
    colAt,
    visible: (w, scrollX) => {
      const first = Math.max(0, colAt(scrollX))
      const last = Math.min(count - 1, Math.max(first, colAt(scrollX + w)))
      return { first, last }
    },
  }
}

/** Базовые размеры (масштаб 100 %) — от них считается пинч-зум (Этап 5.3). */
const BASE_METRICS: GridMetrics = {
  rowHeaderW: 44,
  headerH: 30,
  rowH: 30,
  colW: 96,
}

export const METRICS: GridMetrics = { ...BASE_METRICS }

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2.5

let zoomLevel = 1

/** Текущий уровень зума таблицы (1 = 100 %). */
export function zoomOf(): number {
  return zoomLevel
}

/**
 * Применить зум к METRICS (масштаб ячеек/шапок), вернуть фактический уровень
 * после клампинга. Прокрутку под якорь корректирует вызывающий (GridCanvas):
 * здесь нет DOM. Минимальные размеры защищают читаемость шапок при отдалении.
 */
export function applyZoom(z: number): number {
  zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
  METRICS.colW = Math.max(48, Math.round(BASE_METRICS.colW * zoomLevel))
  METRICS.rowH = Math.max(20, Math.round(BASE_METRICS.rowH * zoomLevel))
  METRICS.headerH = Math.max(22, Math.round(BASE_METRICS.headerH * zoomLevel))
  METRICS.rowHeaderW = Math.max(28, Math.round(BASE_METRICS.rowHeaderW * zoomLevel))
  return zoomLevel
}

/** 0 → A, 25 → Z, 26 → AA, 701 → ZZ (как в Excel). */
export function colName(col: number): string {
  let n = col
  let name = ''
  do {
    name = String.fromCharCode(65 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return name
}

/** Адрес ячейки в стиле Excel: (0,0) → A1. */
export function cellRefName(row: number, col: number): string {
  return `${colName(col)}${row + 1}`
}

export function visibleRows(
  scrollY: number,
  viewportH: number,
  m = METRICS,
): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scrollY / m.rowH))
  const last = Math.max(first, Math.ceil((scrollY + viewportH) / m.rowH) - 1)
  return { first, last }
}

export function visibleCols(
  scrollX: number,
  viewportW: number,
  m = METRICS,
): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scrollX / m.colW))
  const last = Math.max(first, Math.ceil((scrollX + viewportW) / m.colW) - 1)
  return { first, last }
}

/**
 * Ячейка под точкой вьюпорта (координаты события мыши). null — точка за
 * пределами таблицы; kind различает область контента и шапки.
 * cols — раскладка ширин колонок (по умолчанию равномерная).
 */
export function cellAtPoint(
  x: number,
  y: number,
  scrollX = 0,
  scrollY = 0,
  m = METRICS,
  cols?: ColAxis,
): { row: number; col: number; kind: 'cell' | 'colHeader' | 'rowHeader' | 'corner' } | null {
  if (x < 0 || y < 0) return null
  const axis = cols ?? uniformAxis(m)
  if (x < m.rowHeaderW && y < m.headerH) return { row: -1, col: -1, kind: 'corner' }
  if (y < m.headerH) {
    const col = colAtAxis(axis, x - m.rowHeaderW + scrollX, m)
    return col >= 0 ? { row: -1, col, kind: 'colHeader' } : null
  }
  if (x < m.rowHeaderW) {
    const row = Math.floor((y - m.headerH + scrollY) / m.rowH)
    return row >= 0 ? { row, col: -1, kind: 'rowHeader' } : null
  }
  const row = Math.floor((y - m.headerH + scrollY) / m.rowH)
  const col = colAtAxis(axis, x - m.rowHeaderW + scrollX, m)
  if (row < 0 || col < 0) return null
  return { row, col, kind: 'cell' }
}

/** Прямоугольник ячейки во вьюпорте (с учётом прокрутки). */
export function cellRect(
  row: number,
  col: number,
  scrollX: number,
  scrollY: number,
  m = METRICS,
  cols?: ColAxis,
): {
  x: number
  y: number
  w: number
  h: number
} {
  const axis = cols ?? uniformAxis(m)
  return {
    x: m.rowHeaderW + axis.x0(col) - scrollX,
    y: m.headerH + row * m.rowH - scrollY,
    w: axis.width(col),
    h: m.rowH,
  }
}

/** Общий размер прокручиваемой области (spacer). */
export function totalSize(
  rows: number,
  cols: number,
  m = METRICS,
  axis?: ColAxis,
): { w: number; h: number } {
  const w =
    cols <= 0
      ? m.rowHeaderW
      : m.rowHeaderW + (axis ? axis.x0(cols - 1) + axis.width(cols - 1) : cols * m.colW)
  return { w, h: m.headerH + rows * m.rowH }
}

/** Строка/колонка, которую нужно показать в левом верхнем углу, чтобы ячейка попала во вьюпорт. */
export function scrollIntoView(
  row: number,
  col: number,
  scrollX: number,
  scrollY: number,
  viewportW: number,
  viewportH: number,
  m = METRICS,
  axis?: ColAxis,
): { scrollX: number; scrollY: number } {
  const rect = cellRect(row, col, scrollX, scrollY, m, axis)
  const ax = axis ?? uniformAxis(m)
  let nx = scrollX
  let ny = scrollY
  if (rect.x < m.rowHeaderW) nx = ax.x0(col)
  else if (rect.x + rect.w > viewportW) nx = ax.x0(col) + rect.w + m.rowHeaderW - viewportW
  if (rect.y < m.headerH) ny = row * m.rowH
  else if (rect.y + rect.h > viewportH) ny = (row + 1) * m.rowH + m.headerH - viewportH
  return { scrollX: Math.max(0, nx), scrollY: Math.max(0, ny) }
}
