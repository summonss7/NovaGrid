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
 */
export function cellAtPoint(
  x: number,
  y: number,
  scrollX = 0,
  scrollY = 0,
  m = METRICS,
): { row: number; col: number; kind: 'cell' | 'colHeader' | 'rowHeader' | 'corner' } | null {
  if (x < 0 || y < 0) return null
  if (x < m.rowHeaderW && y < m.headerH) return { row: -1, col: -1, kind: 'corner' }
  if (y < m.headerH) {
    const col = Math.floor((x - m.rowHeaderW + scrollX) / m.colW)
    return col >= 0 ? { row: -1, col, kind: 'colHeader' } : null
  }
  if (x < m.rowHeaderW) {
    const row = Math.floor((y - m.headerH + scrollY) / m.rowH)
    return row >= 0 ? { row, col: -1, kind: 'rowHeader' } : null
  }
  const row = Math.floor((y - m.headerH + scrollY) / m.rowH)
  const col = Math.floor((x - m.rowHeaderW + scrollX) / m.colW)
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
): {
  x: number
  y: number
  w: number
  h: number
} {
  return {
    x: m.rowHeaderW + col * m.colW - scrollX,
    y: m.headerH + row * m.rowH - scrollY,
    w: m.colW,
    h: m.rowH,
  }
}

/** Общий размер прокручиваемой области (spacer). */
export function totalSize(rows: number, cols: number, m = METRICS): { w: number; h: number } {
  return { w: m.rowHeaderW + cols * m.colW, h: m.headerH + rows * m.rowH }
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
): { scrollX: number; scrollY: number } {
  const rect = cellRect(row, col, scrollX, scrollY, m)
  let nx = scrollX
  let ny = scrollY
  if (rect.x < m.rowHeaderW) nx = col * m.colW
  else if (rect.x + rect.w > viewportW) nx = (col + 1) * m.colW + m.rowHeaderW - viewportW
  if (rect.y < m.headerH) ny = row * m.rowH
  else if (rect.y + rect.h > viewportH) ny = (row + 1) * m.rowH + m.headerH - viewportH
  return { scrollX: Math.max(0, nx), scrollY: Math.max(0, ny) }
}
