/*
 * Границы ячеек (novagrid-049): тонкая чёрная линия по сторонам ячейки,
 * виды как в выпадающем списке Excel — все / внешние / верхняя / нижняя /
 * левая / правая / убрать. Живут в CellStyle.borders, применяются к каждой
 * области выделения отдельно (периметр у каждой свой). Чистый TS без DOM —
 * рендер и стор только потребляют. Стиль линии и цвет — по спайку рендера
 * (минимум тонкая чёрная), сохранение в файл — novagrid-050.
 */

import type { MergeRect } from './merges'
import { type NormRange, type Selection, normalize } from './selection'
import { type CellBorders, type CellStyle, type SheetModel, cellKey } from './sheet'

/** Вид из выпадающего списка «Границы» FormatBar. */
export type BorderKind = 'all' | 'outer' | 'top' | 'bottom' | 'left' | 'right' | 'none'

/**
 * Стороны, которые вид добавляет ячейке (row, col) диапазона n; null — вид
 * этой ячейки не трогает. «none» возвращает null: он не добавляет сторон,
 * а снимает все (см. styleWithBorders).
 */
export function sidesForCell(
  kind: BorderKind,
  n: NormRange,
  row: number,
  col: number,
): Partial<CellBorders> | null {
  if (kind === 'none') return null
  const atTop = row === n.r1
  const atBottom = row === n.r2
  const atLeft = col === n.c1
  const atRight = col === n.c2
  switch (kind) {
    case 'all':
      return { top: true, right: true, bottom: true, left: true }
    case 'outer': {
      const sides: Partial<CellBorders> = {}
      if (atTop) sides.top = true
      if (atRight) sides.right = true
      if (atBottom) sides.bottom = true
      if (atLeft) sides.left = true
      return Object.keys(sides).length > 0 ? sides : null
    }
    case 'top':
      return atTop ? { top: true } : null
    case 'bottom':
      return atBottom ? { bottom: true } : null
    case 'left':
      return atLeft ? { left: true } : null
    case 'right':
      return atRight ? { right: true } : null
  }
}

/**
 * Стиль ячейки после применения сторон: новые стороны дописываются к уже
 * стоящим (верхняя не стирает нижнюю), null снимает границы полностью.
 * Пустой итог → undefined (стиля нет).
 */
export function styleWithBorders(
  style: CellStyle | undefined,
  sides: Partial<CellBorders> | null,
): CellStyle | undefined {
  if (sides === null) {
    if (!style?.borders) return style
    const rest: Partial<CellStyle> = { ...style }
    delete rest.borders
    return Object.keys(rest).length > 0 ? (rest as CellStyle) : undefined
  }
  const borders: CellBorders = { ...style?.borders, ...sides }
  // сторона false не хранится — «нет» выражается отсутствием поля
  for (const k of Object.keys(borders) as (keyof CellBorders)[]) if (!borders[k]) delete borders[k]
  return { ...style, borders }
}

/**
 * Периметр объединённой ячейки (novagrid-047 × 049): сторона рисуется, если
 * она есть хотя бы у одной ячейки соответствующего края — границы соседних
 * с выделением ячеек и импорта (novagrid-050) не теряются при объединении.
 */
export function mergeEdgeSides(
  sheet: SheetModel,
  mg: MergeRect,
): { top: boolean; right: boolean; bottom: boolean; left: boolean } {
  let top = false
  let bottom = false
  let left = false
  let right = false
  for (let c = mg.c1; c <= mg.c2 && !(top && bottom); c++) {
    if (sheet.styles.get(cellKey(mg.r1, c))?.borders?.top) top = true
    if (sheet.styles.get(cellKey(mg.r2, c))?.borders?.bottom) bottom = true
  }
  for (let r = mg.r1; r <= mg.r2 && !(left && right); r++) {
    if (sheet.styles.get(cellKey(r, mg.c1))?.borders?.left) left = true
    if (sheet.styles.get(cellKey(r, mg.c2))?.borders?.right) right = true
  }
  return { top, right, bottom, left }
}

/**
 * Правки стилей для применения вида к выделению: ячейки обходятся по
 * областям, несмежные пересечения дедуплицируются ключом. Пустой список —
 * менять нечего (сторона уже стоит / снимать нечего).
 */
export function borderStyleChanges(
  sheet: SheetModel,
  selection: Selection,
  kind: BorderKind,
): { row: number; col: number; before?: CellStyle; after?: CellStyle }[] {
  const seen = new Set<string>()
  const out: { row: number; col: number; before?: CellStyle; after?: CellStyle }[] = []
  for (const rg of selection.ranges) {
    const n = normalize(rg)
    for (let r = n.r1; r <= n.r2; r++) {
      for (let c = n.c1; c <= n.c2; c++) {
        const key = cellKey(r, c)
        if (seen.has(key)) continue
        seen.add(key)
        const before = sheet.styles.get(key)
        const sides = kind === 'none' ? null : sidesForCell(kind, n, r, c)
        if (kind === 'none') {
          if (!before?.borders) continue // снимать нечего
        } else if (sides) {
          let noop = true
          for (const k of Object.keys(sides) as (keyof CellBorders)[]) {
            if (!before?.borders?.[k]) {
              noop = false
              break
            }
          }
          if (noop) continue // все стороны уже стоят
        } else {
          continue // вид этой ячейки не трогает
        }
        out.push({ row: r, col: c, before, after: styleWithBorders(before, sides) })
      }
    }
  }
  return out
}
