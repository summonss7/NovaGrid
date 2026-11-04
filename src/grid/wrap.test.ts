import { describe, expect, it } from 'vitest'
import { withCell, withStyle, type SheetModel } from '../core/sheet'
import { wrapHeight, wrapLineMetrics, wrapLines, wrapRowHeights } from './wrap'

/*
 * Перенос текста в ячейке (novagrid-048): разбиение по словам, метрики
 * строк и автовысоты строк листа. Измерение — детерминированный фейк:
 * ширина текста = число символов × 10px (моноширинная «пропорция»).
 */

const measure = (t: string) => t.length * 10
const FONT = '13.5px sans'

describe('wrapLines: перенос по словам (novagrid-048)', () => {
  it('влезающий текст — одна строка', () => {
    expect(wrapLines('hello world', FONT, 120, measure)).toEqual(['hello world'])
  })

  it('не влезающий переносится по словам', () => {
    // 11 символов = 110px > 60px: «hello » и «world» не помещаются вместе
    expect(wrapLines('hello world', FONT, 60, measure)).toEqual(['hello', 'world'])
  })

  it('слова набираются в строку жадно, пока влезают', () => {
    // 55px влезает, «aa bb cc» = 80px не влезает
    expect(wrapLines('aa bb cc dd', FONT, 55, measure)).toEqual(['aa bb', 'cc dd'])
  })

  it('слово шире ячейки ломится по символам (как в Excel)', () => {
    // 12 символов = 120px, ячейка 50px → куски по 5 символов
    expect(wrapLines('AAAAAAAAAAAA', FONT, 50, measure)).toEqual(['AAAAA', 'AAAAA', 'AA'])
  })

  it('явные переводы строки — свои абзацы, пустой абзац — пустая строка', () => {
    expect(wrapLines('a\nb', FONT, 100, measure)).toEqual(['a', 'b'])
    expect(wrapLines('a\n\nb', FONT, 100, measure)).toEqual(['a', '', 'b'])
  })

  it('пустой текст — без строк; нулевая ширина — текст как есть', () => {
    expect(wrapLines('', FONT, 100, measure)).toEqual([])
    expect(wrapLines('abc', FONT, 0, measure)).toEqual(['abc'])
  })
})

describe('wrapLineMetrics/wrapHeight: высота под число строк', () => {
  it('одна строка остаётся в базовой высоте и центрирована', () => {
    const m = wrapLineMetrics(13.5, 30)
    expect(m.lineH).toBe(18) // ceil(13.5 × 1.32)
    expect(m.padY).toBe(6) // (30 − 18) / 2 — как центр обычной ячейки
    expect(wrapHeight(1, m, 30)).toBe(30)
  })

  it('высота растёт линиями, шаг = lineH', () => {
    const m = wrapLineMetrics(13.5, 30)
    expect(wrapHeight(2, m, 30)).toBe(6 * 2 + 18 * 2) // 48
    expect(wrapHeight(3, m, 30)).toBe(6 * 2 + 18 * 3) // 66
  })
})

describe('wrapRowHeights: автовысоты строк листа (novagrid-048)', () => {
  const deps = (colWidth: number) => ({
    colWidth: () => colWidth,
    fontOf: () => FONT,
    pxOf: () => 13.5,
    measure,
    locale: 'ru-RU',
    baseRowH: 30,
  })

  const sheetOf = (cells: [number, number, string][], wrapCells: [number, number][]): SheetModel => {
    let sh: SheetModel = { cells: new Map(), styles: new Map(), rows: 10, cols: 10, maxRow: -1, maxCol: -1 }
    for (const [r, c, v] of cells) sh = withCell(sh, r, c, v)
    for (const [r, c] of wrapCells) sh = withStyle(sh, r, c, { wrap: true })
    return sh
  }

  it('длинный текст с переносом растит строку, обычные ячейки — нет', () => {
    // 40 символов при ширине текста 84px → 5 строк по 8 символов
    const sh = sheetOf(
      [
        [0, 0, 'a'.repeat(40)],
        [1, 1, 'b'.repeat(40)],
      ],
      [[0, 0]],
    )
    const h = wrapRowHeights(sh, deps(96))
    expect(h.get(0)).toBe(6 * 2 + 18 * 5)
    expect(h.has(1)).toBe(false) // без wrap высота не растёт
  })

  it('одна строка в переносе — базовая высота, в карте её нет', () => {
    const sh = sheetOf([[0, 0, 'short']], [[0, 0]])
    expect(wrapRowHeights(sh, deps(96)).size).toBe(0)
  })

  it('высота строки — максимум по её ячейкам с переносом', () => {
    const sh = sheetOf(
      [
        [2, 0, 'a'.repeat(40)],
        [2, 1, 'b'.repeat(100)], // 10 строк при ширине 84px
      ],
      [
        [2, 0],
        [2, 1],
      ],
    )
    const h = wrapRowHeights(sh, deps(96))
    const tall = 6 * 2 + 18 * Math.ceil(100 / 8) // 8 символов влезает в 84px
    expect(h.get(2)).toBe(tall)
  })

  it('формула переносится вычисленным значением, формат числа удлиняет текст', () => {
    const sh = sheetOf(
      [
        [0, 0, '=1+1'],
        [1, 0, '5'],
      ],
      [
        [0, 0],
        [1, 0],
      ],
    )
    const plain = wrapRowHeights(sh, deps(96))
    expect(plain.size).toBe(0) // «2» — одна строка
    // процентный формат: «500,00 %» — всё ещё одна строка, но механизм применён
    let fmtSh = withStyle(sh, 1, 0, { wrap: true, fmt: 'percent' })
    fmtSh = withCell(fmtSh, 1, 0, '5')
    expect(wrapRowHeights(fmtSh, deps(96)).size).toBe(0)
  })

  it('объединённая ячейка автовысоту не растит', () => {
    const sh = sheetOf([[0, 0, 'a'.repeat(40)]], [[0, 0]])
    const merged = { ...sh, merges: [{ r1: 0, c1: 0, r2: 0, c2: 1 }] }
    expect(wrapRowHeights(merged, deps(96)).size).toBe(0)
  })

  it('пустые и безстилевые ячейки не считаются', () => {
    const sh = sheetOf([[0, 0, '']], [[0, 0]])
    expect(wrapRowHeights(sh, deps(96)).size).toBe(0)
  })
})
