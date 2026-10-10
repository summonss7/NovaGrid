/*
 * «Найти и заменить» (Этап 7, CONCEPT §6 в.5): движок замены поверх опций
 * поиска Этапа 3.1 (matches/видимость). Замене доступны те же совпадения,
 * что показывает счётчик: скрытые фильтром строки не трогаются (WYSIWYG),
 * порядок строка→колонк.
 *
 * Режимы (карточка novagrid-013 п.3):
 *  - значения (по умолчанию): заменяется вычисленное значение ячейки;
 *    формула, чей результат совпал, становится статическим значением
 *    (как «Заменить: Значения» в Excel);
 *  - «искать в формулах»: заменяется текст формулы после «=» с последующим
 *    пересчётом движком (Этап 4) — формула остаётся формулой;
 *  - чужие формулы (∛): пропускаются в любом режиме — кэш из файла не
 *    трогаем, формулу не ломаем.
 */

import { cellIsFrozen, cellText, isFormulaRaw } from '../formula/engine'
import type { CellChange } from './history'
import { visibleIndexOf, visibleRowsOf, type ColumnFilter } from './filter'
import { matches, type SearchHit, type SearchOptions } from './search'
import { getCell, type SheetModel } from './sheet'

export interface ReplaceOptions extends SearchOptions {
  /** искать в тексте формул (после «=») вместо вычисленных значений */
  inFormulas: boolean
}

/**
 * Текст, в котором ищем для этой ячейки; null — ячейка вне замены
 * (пустая или чужая формула ∛). Общее для счётчика совпадений и замены —
 * счётчик не может разойтись с тем, что заменит «Заменить все».
 */
function subjectText(
  sheet: SheetModel,
  row: number,
  col: number,
  opts: ReplaceOptions,
): string | null {
  const raw = getCell(sheet, row, col)
  if (raw === '') return null
  if (!isFormulaRaw(raw)) return raw
  // чужие формулы (∛): показан кэш из файла — замену не выполняем
  if (cellIsFrozen(sheet, row, col)) return null
  return opts.inFormulas ? raw.slice(1) : cellText(sheet, row, col)
}

/** Подставить replacement вместо всех вхождений needle (регистр — по флагу). */
function applyAll(
  text: string,
  needle: string,
  replacement: string,
  caseSensitive: boolean,
): string {
  if (needle === '') return text
  if (caseSensitive) return text.split(needle).join(replacement)
  // без учёта регистра: ручной скан — replacement вставляется как есть,
  // без приведения к нижнему регистру
  const hay = text.toLowerCase()
  const q = needle.toLowerCase()
  let out = ''
  let i = 0
  for (;;) {
    const at = hay.indexOf(q, i)
    if (at < 0) {
      out += text.slice(i)
      return out
    }
    out += text.slice(i, at) + replacement
    i = at + q.length
  }
}

/**
 * Новое raw ячейки после замены; null — ячейка не меняется (не совпала,
 * чужая формула или замена ничего не изменила).
 */
export function replaceCellRaw(
  sheet: SheetModel,
  row: number,
  col: number,
  query: string,
  replacement: string,
  opts: ReplaceOptions,
): string | null {
  if (query === '') return null
  const raw = getCell(sheet, row, col)
  const text = subjectText(sheet, row, col, opts)
  if (text === null || !matches(text, needleOf(query, opts), opts)) return null
  const out = opts.wholeCell
    ? replacement
    : applyAll(text, query, replacement, opts.caseSensitive)
  if (out === text) return null
  // в режиме формул заменяли тело после «=» — вернуть префикс, остаётся формулой
  return opts.inFormulas && isFormulaRaw(raw) ? `=${out}` : out
}

/** matches ждёт needle в нижнем регистре при нечувствительном регистре (как searchSheet). */
function needleOf(query: string, opts: ReplaceOptions): string {
  return opts.caseSensitive ? query : query.toLowerCase()
}

/** Совпадения замены одного листа в порядке строка→колонк; tab заполняет вызывающий. */
export function replaceHitsInSheet(
  sheet: SheetModel,
  query: string,
  opts: ReplaceOptions,
  visible: readonly number[] | null = null,
): SearchHit[] {
  if (query === '') return []
  const hits: SearchHit[] = []
  const needle = needleOf(query, opts)
  for (const [key, raw] of sheet.cells) {
    if (raw === '') continue
    const i = key.indexOf(':')
    const row = Number(key.slice(0, i))
    const col = Number(key.slice(i + 1))
    if (visible && visibleIndexOf(visible, row) < 0) continue
    const text = subjectText(sheet, row, col, opts)
    if (text === null || text === '' || !matches(text, needle, opts)) continue
    hits.push({ tab: -1, row, col })
  }
  hits.sort((a, b) => a.row - b.row || a.col - b.col)
  return hits
}

/** Совпадения замены по всем листам книги (фильтры каждого листа учтены). */
export function replaceHitsInBook(
  sheets: readonly { sheet: SheetModel; filters?: readonly ColumnFilter[] }[],
  query: string,
  opts: ReplaceOptions,
): SearchHit[] {
  const out: SearchHit[] = []
  sheets.forEach((t, tab) => {
    const vis = t.filters ? visibleRowsOf(t.sheet, t.filters) : null
    for (const h of replaceHitsInSheet(t.sheet, query, opts, vis)) out.push({ ...h, tab })
  })
  return out
}

/** Заменить все совпадения листа; изменения в порядке строка→колонк. */
export function replaceAllInSheet(
  sheet: SheetModel,
  query: string,
  replacement: string,
  opts: ReplaceOptions,
  visible: readonly number[] | null = null,
): CellChange[] {
  const changes: CellChange[] = []
  if (query === '') return changes
  for (const [key, raw] of sheet.cells) {
    if (raw === '') continue
    const i = key.indexOf(':')
    const row = Number(key.slice(0, i))
    const col = Number(key.slice(i + 1))
    if (visible && visibleIndexOf(visible, row) < 0) continue
    const after = replaceCellRaw(sheet, row, col, query, replacement, opts)
    if (after !== null && after !== raw) changes.push({ row, col, before: raw, after })
  }
  changes.sort((a, b) => a.row - b.row || a.col - b.col)
  return changes
}
