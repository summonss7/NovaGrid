/*
 * Объединённые ячейки (novagrid-047): список прямоугольников в листе
 * (sheet.merges), значение и стиль живут в левой верхней ячейке — остальная
 * площадь «скрыта»: навигация, правка и выделение работают с началом.
 * Чистый TS без DOM — операции тестируются юнитами, грид только рисует.
 */

import { type CellChange } from './history'
import { type NormRange, normalize, type Range } from './selection'
import { type SheetModel, cellKey, getCell, withCellList } from './sheet'

/** Прямоугольник объединения (нормализованный, индексация с 0, включительно). */
export interface MergeRect {
  r1: number
  c1: number
  r2: number
  c2: number
}

/** Список объединений листа; undefined/пусто — объединений нет. */
export type Merges = readonly MergeRect[]

/** Объединение, накрывающее ячейку; null — обычная ячейка. */
export function mergeAt(sheet: SheetModel, row: number, col: number): MergeRect | null {
  const merges = sheet.merges
  if (!merges) return null
  for (const m of merges)
    if (row >= m.r1 && row <= m.r2 && col >= m.c1 && col <= m.c2) return m
  return null
}

/** Ячейка скрыта объединением (внутри, но не левый верхний угол). */
export function isCoveredCell(sheet: SheetModel, row: number, col: number): boolean {
  const m = mergeAt(sheet, row, col)
  return m !== null && (row !== m.r1 || col !== m.c1)
}

/** Прямоугольники пересекаются (строго — общая площадь больше нуля). */
function rectsIntersect(
  a: { r1: number; c1: number; r2: number; c2: number },
  b: { r1: number; c1: number; r2: number; c2: number },
): boolean {
  return a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1
}

/**
 * Объединения внутри диапазона (novagrid-047): пересекающиеся с ним срезы —
 * повторное объединение поверх старых поглощает их, как в Excel.
 */
function mergesInside(merges: Merges | undefined, n: NormRange): MergeRect[] {
  if (!merges) return []
  return merges.filter((m) => rectsIntersect(m, n))
}

/** Потеряются ли данные при объединении: непустые ячейки кроме левого верхнего. */
export function mergeLosesData(sheet: SheetModel, n: NormRange): boolean {
  for (let r = n.r1; r <= n.r2; r++)
    for (let c = n.c1; c <= n.c2; c++) {
      if (r === n.r1 && c === n.c1) continue
      if (getCell(sheet, r, c) !== '') return true
    }
  return false
}

/**
 * Применить объединение диапазона: значение остаётся в левом верхнем углу,
 * остальные ячейки очищаются (changes — для честного отката значений).
 * Возвращает лист с новым списком merges и правками значений.
 */
export function applyMerge(sheet: SheetModel, rg: Range): { sheet: SheetModel; changes: CellChange[] } {
  const n = normalize(rg)
  const single = n.r1 === n.r2 && n.c1 === n.c2
  const old = mergesInside(sheet.merges, n)
  if (single && old.length === 0) return { sheet, changes: [] }
  const changes: CellChange[] = []
  for (let r = n.r1; r <= n.r2; r++)
    for (let c = n.c1; c <= n.c2; c++) {
      if (r === n.r1 && c === n.c1) continue
      const before = getCell(sheet, r, c)
      if (before !== '') changes.push({ row: r, col: c, before, after: '' })
    }
  // одиночная ячейка поверх существующего объединения — только снятие старого
  const next: MergeRect[] = (sheet.merges ?? []).filter((m) => !old.includes(m))
  if (!single) next.push(n)
  next.sort((a, b) => a.r1 - b.r1 || a.c1 - b.c1)
  return {
    sheet: {
      ...withCellList(sheet, changes.map((ch) => ({ row: ch.row, col: ch.col, value: ch.after }))),
      merges: next,
    },
    changes,
  }
}

/**
 * Снять объединение, накрывающее ячейку (значения не трогает — скрытые ячейки
 * пусты). null — ячейка обычная, делать нечего.
 */
export function unmergeAt(sheet: SheetModel, row: number, col: number): SheetModel | null {
  const m = mergeAt(sheet, row, col)
  if (!m) return null
  const next = (sheet.merges ?? []).filter((x) => x !== m)
  return { ...sheet, merges: next.length > 0 ? next : undefined }
}

/**
 * Куда попадает навигация с учётом объединений (как Excel): шаг внутрь
 * объединения перепрыгивает его целиком — из A1 (A1:B2) вправо в C1, вниз
 * в A3; попадание «внутрь» со стороны — на левый верхний угол.
 */
export function resolveMergedMove(
  sheet: SheetModel,
  row: number,
  col: number,
  dr: number,
  dc: number,
): { row: number; col: number } {
  let r = row
  let c = col
  for (let guard = 0; guard < 1000; guard++) {
    const m = mergeAt(sheet, r, c)
    if (!m) return { row: r, col: c }
    if (dr > 0) r = m.r2 + 1
    else if (dr < 0) r = m.r1 - 1
    else if (dc > 0) c = m.c2 + 1
    else if (dc < 0) c = m.c1 - 1
    else return { row: m.r1, col: m.c1 }
    // край листа — остаёмся на объединении (Excel держит курсор на месте)
    if (r < 0 || c < 0) return { row: m.r1, col: m.c1 }
  }
  return { row: r, col: c }
}

/**
 * Сдвиг края объединения при вставке/удалении (см. shiftMerges). Края
 * асимметричны при удалении: верхний край, попавший в удалённую зону,
 * подъезжает к началу зоны (контент снизу поднимается), нижний — к концу
 * последней выжившей строки над зоной.
 */
function shiftTop(v: number, at: number, count: number, delta: number): number {
  if (delta > 0) return v >= at ? v + delta : v
  return v >= at + count ? v - count : v >= at ? at : v
}

function shiftBottom(v: number, at: number, count: number, delta: number): number {
  if (delta > 0) return v >= at ? v + delta : v
  return v >= at + count ? v - count : v >= at ? at - 1 : v
}

/**
 * Объединения после вставки/удаления строк/колонок (novagrid-047): вставка
 * внутри объединения растит его, целиком удалённое — пропадает, частично
 * резаное — сжимается; выродившееся в одну ячейку — снимается (как в Excel).
 * at — первая сдвигаемая строка/колонка, delta — сдвиг (>0 вставка).
 */
export function shiftMerges(
  merges: Merges | undefined,
  axis: 'row' | 'col',
  at: number,
  delta: number,
): Merges | undefined {
  if (!merges || merges.length === 0 || delta === 0) return merges
  const count = Math.abs(delta)
  const out: MergeRect[] = []
  for (const m of merges) {
    if (delta < 0) {
      // целиком в удалённой зоне — объединение удаляется вместе с ячейками
      if (axis === 'row' && m.r1 >= at && m.r2 < at + count) continue
      if (axis === 'col' && m.c1 >= at && m.c2 < at + count) continue
    }
    const r1 = axis === 'row' ? shiftTop(m.r1, at, count, delta) : m.r1
    const r2 = axis === 'row' ? shiftBottom(m.r2, at, count, delta) : m.r2
    const c1 = axis === 'col' ? shiftTop(m.c1, at, count, delta) : m.c1
    const c2 = axis === 'col' ? shiftBottom(m.c2, at, count, delta) : m.c2
    if (r1 > r2 || c1 > c2) continue // защита: сдвиг за пределы листа
    if (r1 === r2 && c1 === c2) continue // выродилось — снимается
    out.push({ r1, c1, r2, c2 })
  }
  out.sort((a, b) => a.r1 - b.r1 || a.c1 - b.c1)
  return out.length > 0 ? out : undefined
}

/** Ключи скрытых ячеек объединения (кроме левого верхнего угла). */
export function coveredKeys(merges: Merges | undefined): Set<string> {
  const out = new Set<string>()
  if (!merges) return out
  for (const m of merges)
    for (let r = m.r1; r <= m.r2; r++)
      for (let c = m.c1; c <= m.c2; c++) {
        if (r === m.r1 && c === m.c1) continue
        out.add(cellKey(r, c))
      }
  return out
}
