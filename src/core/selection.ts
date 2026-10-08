/*
 * Модель выделения (CONCEPT Ф5): активная ячейка + массив диапазонов,
 * поддерживающий Ctrl-несмежные области. Чистый TS без DOM — операции
 * выделения тестируются юнитами, грид только транслирует жесты в них.
 */

export interface CellRef {
  row: number
  col: number
}

/**
 * Диапазон хранится «якорь → текущий конец» (не нормализован), чтобы
 * Shift-стрелки/перетаскивание естественно расширяли его в любую сторону.
 */
export interface Range {
  fr: number
  fc: number
  tr: number
  tc: number
}

export interface Selection {
  /** активная ячейка — толстая зелёная рамка, приёмник ввода */
  active: CellRef
  ranges: Range[]
}

export interface NormRange {
  r1: number
  c1: number
  r2: number
  c2: number
}

export function range(r: number, c: number): Range {
  return { fr: r, fc: c, tr: r, tc: c }
}

export function normalize({ fr, fc, tr, tc }: Range): NormRange {
  return { r1: Math.min(fr, tr), c1: Math.min(fc, tc), r2: Math.max(fr, tr), c2: Math.max(fc, tc) }
}

export function selectionOf(row: number, col: number): Selection {
  return { active: { row, col }, ranges: [range(row, col)] }
}

export function inNormRange(n: NormRange, row: number, col: number): boolean {
  return row >= n.r1 && row <= n.r2 && col >= n.c1 && col <= n.c2
}

export function inSelection(sel: Selection, row: number, col: number): boolean {
  return sel.ranges.some((rg) => inNormRange(normalize(rg), row, col))
}

/** Минимальный охватывающий прямоугольник всех областей (основа копирования Ф5). */
export function boundingBox(sel: Selection): NormRange {
  const boxes = sel.ranges.map(normalize)
  return {
    r1: Math.min(...boxes.map((b) => b.r1)),
    c1: Math.min(...boxes.map((b) => b.c1)),
    r2: Math.max(...boxes.map((b) => b.r2)),
    c2: Math.max(...boxes.map((b) => b.c2)),
  }
}

/** Перечисление ячеек выделения без повторов (ячейка в двух областях — один раз). */
export function selectedCells(sel: Selection): { rows: number[]; cols: number[]; count: number } {
  const seen = new Set<string>()
  const rows: number[] = []
  const cols: number[] = []
  for (const rg of sel.ranges) {
    const n = normalize(rg)
    for (let r = n.r1; r <= n.r2; r++) {
      for (let c = n.c1; c <= n.c2; c++) {
        const key = `${r}:${c}`
        if (seen.has(key)) continue
        seen.add(key)
        rows.push(r)
        cols.push(c)
      }
    }
  }
  return { rows, cols, count: rows.length }
}

export function clampRef(ref: CellRef, rows: number, cols: number): CellRef {
  return {
    row: Math.min(Math.max(ref.row, 0), rows - 1),
    col: Math.min(Math.max(ref.col, 0), cols - 1),
  }
}
