/*
 * Инкрементальный поиск (CONCEPT Ф2, Этап 3): по сырым значениям ячеек,
 * режимы «этот лист» / «все листы» (по книге собирает стор — ему известны
 * фильтры вкладок). Совпадения упорядочены строка→колонка, как чтение
 * таблицы. Скрытые фильтром строки не ищутся: подсветка живёт в канвасе,
 * совпадение должно быть видимым (WYSIWYG).
 *
 * Умный поиск (novagrid-065): несколько слов в запросе — совпадение строка,
 * где есть ВСЕ слова (каждое — в любой ячейке строки). «"фраза"» — точная
 * фраза внутри одной ячейки, «-слово» — исключить строки с этим словом.
 * Без учёта регистра Ё=Е. Одно слово без операторов — прежний поиск
 * подстроки; «ячейка целиком» — буквальное сравнение без разбора.
 * «Найти и заменить» (core/replace) остаётся буквальным — замене нужен
 * точный текст, счётчики поиска и замены могут расходиться.
 */

import { cellText } from '../formula/engine'
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

/** Нормализация для нечувствительного поиска: регистр и Ё=Е. */
function fold(text: string, caseSensitive: boolean): string {
  return caseSensitive ? text : text.toLowerCase().replace(/ё/g, 'е')
}

/** Слово запроса: обязательное или исключение («-слово»). */
export interface QueryTerm {
  /** нормализованная подстрока */
  needle: string
  /** строки с этим словом не совпадают */
  exclude: boolean
}

/**
 * Разбор запроса на слова: пробелы разделяют, «"…"» — фраза целиком
 * (кавычки снимаются), «-» перед словом или фразой — исключение. Пустые
 * токены (кавычки без текста, одиночный «-») отбрасываются.
 */
export function parseQueryTerms(query: string, caseSensitive: boolean): QueryTerm[] {
  const terms: QueryTerm[] = []
  for (const token of query.match(/-?"[^"]*"|\S+/g) ?? []) {
    let text = token
    const exclude = text.startsWith('-')
    if (exclude) text = text.slice(1)
    // кавычки могли остаться на токене после «-»; незакрытая — снимаем первую
    if (text.startsWith('"')) {
      text = text.endsWith('"') && text.length > 1 ? text.slice(1, -1) : text.slice(1)
    }
    if (text === '') continue
    terms.push({ needle: fold(text, caseSensitive), exclude })
  }
  return terms
}

/** Текст ячейки для поиска: формулы — по вычисленному значению, как в гриде. */
function cellSearchText(sheet: SheetModel, row: number, col: number, raw: string): string {
  return raw.startsWith('=') ? cellText(sheet, row, col) : raw
}

/**
 * Буквальное совпадение текста с запросом, без разбора на слова — режим
 * «ячейка целиком» и «найти и заменить». needle уже в нижнем регистре
 * при нечувствительном регистре (как searchSheet).
 */
export function matches(raw: string, needle: string, opts: SearchOptions): boolean {
  if (opts.wholeCell) {
    return opts.caseSensitive ? raw === needle : raw.toLowerCase() === needle
  }
  return opts.caseSensitive ? raw.includes(needle) : raw.toLowerCase().includes(needle)
}

/** Подстрока (needle уже нормализован) в ячейках листа. */
function substringScan(
  sheet: SheetModel,
  needle: string,
  caseSensitive: boolean,
  visible: readonly number[] | null,
  hits: SearchHit[],
): void {
  if (needle === '') return
  for (const [key, raw] of sheet.cells) {
    const i = key.indexOf(':')
    const row = Number(key.slice(0, i))
    const col = Number(key.slice(i + 1))
    const text = cellSearchText(sheet, row, col, raw)
    if (text === '' || !fold(text, caseSensitive).includes(needle)) continue
    if (visible && visibleIndexOf(visible, row) < 0) continue
    hits.push({ tab: -1, row, col })
  }
}

/**
 * Многословный запрос: совпадение — строка, где есть все обязательные слова
 * (каждое в любой её ячейке) и ни одного исключения. В hits попадают ячейки
 * с обязательными словами — подсветка показывает, чем строка совпала.
 */
function rowScan(
  sheet: SheetModel,
  required: readonly string[],
  excluded: readonly string[],
  caseSensitive: boolean,
  visible: readonly number[] | null,
  hits: SearchHit[],
): void {
  const rows = new Map<number, { col: number; hay: string }[]>()
  for (const [key, raw] of sheet.cells) {
    const i = key.indexOf(':')
    const row = Number(key.slice(0, i))
    const col = Number(key.slice(i + 1))
    if (visible && visibleIndexOf(visible, row) < 0) continue
    const text = cellSearchText(sheet, row, col, raw)
    if (text === '') continue
    const hay = fold(text, caseSensitive)
    const cells = rows.get(row)
    if (cells) cells.push({ col, hay })
    else rows.set(row, [{ col, hay }])
  }
  for (const [row, cells] of rows) {
    if (excluded.some((n) => cells.some((c) => c.hay.includes(n)))) continue
    if (!required.every((n) => cells.some((c) => c.hay.includes(n)))) continue
    for (const c of cells) {
      if (required.some((n) => c.hay.includes(n))) hits.push({ tab: -1, row, col: c.col })
    }
  }
}

/** Совпадения одного листа в порядке строка→колонка; tab заполняет вызывающий. */
export function searchSheet(
  sheet: SheetModel,
  query: string,
  opts: SearchOptions,
  visible: readonly number[] | null = null,
): SearchHit[] {
  if (query === '') return []
  const hits: SearchHit[] = []
  // «ячейка целиком» — буквальное равенство, без разбора на слова
  if (opts.wholeCell) {
    const needle = opts.caseSensitive ? query : query.toLowerCase()
    for (const [key, raw] of sheet.cells) {
      const i = key.indexOf(':')
      const row = Number(key.slice(0, i))
      const col = Number(key.slice(i + 1))
      const text = cellSearchText(sheet, row, col, raw)
      if (text === '' || !matches(text, needle, opts)) continue
      if (visible && visibleIndexOf(visible, row) < 0) continue
      hits.push({ tab: -1, row, col })
    }
    hits.sort((a, b) => a.row - b.row || a.col - b.col)
    return hits
  }
  const terms = parseQueryTerms(query, opts.caseSensitive)
  const required = terms.filter((t) => !t.exclude).map((t) => t.needle)
  const excluded = terms.filter((t) => t.exclude).map((t) => t.needle)
  if (required.length === 0 && excluded.length === 0) {
    // только пробелы/кавычки — искать нечего
  } else if (required.length === 0) {
    // только исключения («-5») — вряд ли это операторы, ищем буквально
    substringScan(sheet, fold(query, opts.caseSensitive), opts.caseSensitive, visible, hits)
  } else if (required.length === 1 && excluded.length === 0) {
    // одно слово — обычный поиск подстроки (теперь с Ё=Е)
    substringScan(sheet, required[0], opts.caseSensitive, visible, hits)
  } else {
    rowScan(sheet, required, excluded, opts.caseSensitive, visible, hits)
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
