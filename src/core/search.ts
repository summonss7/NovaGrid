/*
 * Инкрементальный поиск (CONCEPT Ф2, Этап 3): по сырым значениям ячеек,
 * режимы «этот лист» / «все листы» (по книге собирает стор — ему известны
 * фильтры вкладок). Совпадения упорядочены строка→колонка, как чтение
 * таблицы. Скрытые фильтром строки не ищутся: подсветка живёт в канвасе,
 * совпадение должно быть видимым (WYSIWYG).
 */

import { visibleIndexOf, visibleRowsOf, type ColumnFilter } from './filter'
import type { SheetModel } from './sheet'

export interface SearchOptions {
  caseSensitive: boolean
  wholeCell: boolean
}

export interface SearchHit {
  tab: number
  row: number
  col: number
}

function matches(raw: string, needle: string, opts: SearchOptions): boolean {
  if (opts.wholeCell) {
    return opts.caseSensitive ? raw === needle : raw.toLowerCase() === needle
  }
  return opts.caseSensitive ? raw.includes(needle) : raw.toLowerCase().includes(needle)
}

/** Совпадения одного листа в порядке строка→колонка; tab заполняет вызывающий. */
export function searchSheet(
  sheet: SheetModel,
  query: string,
  opts: SearchOptions,
  visible: readonly number[] | null = null,
): SearchHit[] {
  if (query === '') return []
  const needle = opts.caseSensitive ? query : query.toLowerCase()
  const hits: SearchHit[] = []
  for (const [key, raw] of sheet.cells) {
    if (raw === '' || !matches(raw, needle, opts)) continue
    const i = key.indexOf(':')
    const row = Number(key.slice(0, i))
    if (visible && visibleIndexOf(visible, row) < 0) continue
    hits.push({ tab: -1, row, col: Number(key.slice(i + 1)) })
  }
  hits.sort((a, b) => a.row - b.row || a.col - b.col)
  return hits
}

/** Совпадения всех листов книги (фильтры каждого листа учитываются). */
export function searchBook(
  sheets: readonly { sheet: SheetModel; filters?: readonly ColumnFilter[] }[],
  query: string,
  opts: SearchOptions,
): SearchHit[] {
  const out: SearchHit[] = []
  sheets.forEach((t, tab) => {
    const vis = t.filters ? visibleRowsOf(t.sheet, t.filters) : null
    for (const h of searchSheet(t.sheet, query, opts, vis)) out.push({ ...h, tab })
  })
  return out
}
