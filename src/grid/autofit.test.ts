import { describe, expect, it } from 'vitest'
import { applyMerge } from '../core/merges'
import { withCell, withStyle, type SheetModel } from '../core/sheet'
import { AUTOFIT_MAX_CHARS, AUTOFIT_PAD_X, autoColWidths, type AutofitDeps } from './autofit'

/*
 * Автоширина колонок по тексту (novagrid-067): ширина — самый широкий
 * отображаемый текст колонки, пол/потолок, объединённые ячейки и отсев.
 * Измерение — детерминированный фейк: ширина текста = число символов × 10px
 * (×2 для крупного кегля, чтобы проверить учёт стиля).
 */

const measure = (t: string, font: string) => t.length * 10 * (font.includes('27px') ? 2 : 1)
const FONT = '13.5px sans'
const BIG_FONT = '27px sans'
const PAD = AUTOFIT_PAD_X * 2 + 2 // отступы ячейки + запас

const deps = (locale = 'ru-RU'): AutofitDeps => ({
  measure,
  fontOf: (style) => (style?.size ? BIG_FONT : FONT),
  pxOf: (style) => (style?.size ? 27 : 13.5),
  locale,
})

const sheetOf = (cells: [number, number, string][]): SheetModel => {
  let sh: SheetModel = { cells: new Map(), styles: new Map(), rows: 10, cols: 10, maxRow: -1, maxCol: -1 }
  for (const [r, c, v] of cells) sh = withCell(sh, r, c, v)
  return sh
}

describe('autoColWidths: ширина по самому широкому тексту (novagrid-067)', () => {
  it('ширина колонки — максимум текста в ней плюс отступы', () => {
    const sh = sheetOf([
      [0, 0, 'ab'],
      [1, 0, 'abcd'],
      [0, 1, 'abcdefghij'],
    ])
    const w = autoColWidths(sh, deps())
    expect(w.get(0)).toBe(4 * 10 + PAD)
    expect(w.get(1)).toBe(10 * 10 + PAD)
  })

  it('узкая колонка не уже пола COL_W_MIN', () => {
    const sh = sheetOf([[0, 0, 'a']])
    expect(autoColWidths(sh, deps()).get(0)).toBe(32)
  })

  it('очень широкий текст ограничен потолком в символах', () => {
    const sh = sheetOf([[0, 0, 'x'.repeat(500)]])
    const cap = measure('0'.repeat(AUTOFIT_MAX_CHARS), FONT) + PAD
    expect(autoColWidths(sh, deps()).get(0)).toBe(cap)
  })

  it('пустые колонки не входят в карту — им остаётся ширина по умолчанию', () => {
    const sh = sheetOf([[0, 1, 'abc']])
    const w = autoColWidths(sh, deps())
    expect(w.size).toBe(1)
    expect(w.has(0)).toBe(false)
  })

  it('формула измеряется вычисленным значением, а не текстом формулы', () => {
    const sh = sheetOf([[0, 0, '=10*10']])
    // сырой текст «=10*10» дал бы 6×10+PAD, вычисленное «100» — 3×10+PAD
    expect(autoColWidths(sh, deps()).get(0)).toBe(3 * 10 + PAD)
  })

  it('формат числа меняет измеряемый текст', () => {
    let sh = sheetOf([
      [0, 0, '5'],
      [1, 0, 'abc'], // 30px — не мешает
    ])
    sh = withStyle(sh, 0, 0, { fmt: 'money' })
    const w = autoColWidths(sh, deps())
    // «5,00 ₽» — 6 отображаемых символов против 1 сырого
    expect(w.get(0)).toBe(measure('5,00 ₽', FONT) + PAD)
  })

  it('стилевой кегль учитывается — крупный текст растит ширину', () => {
    let sh = sheetOf([[0, 0, 'abcd']])
    sh = withStyle(sh, 0, 0, { size: 18 })
    expect(autoColWidths(sh, deps()).get(0)).toBe(4 * 10 * 2 + PAD)
  })

  it('объединённые ячейки не растят ширину колонки', () => {
    let sh = sheetOf([
      [0, 0, 'x'.repeat(100)],
      [1, 0, 'коротко'],
    ])
    sh = applyMerge(sh, { fr: 0, fc: 0, tr: 0, tc: 3 }).sheet
    const w = autoColWidths(sh, deps())
    // без объединения было бы 100×10+PAD; остаётся вклад обычной ячейки
    expect(w.get(0)).toBe(measure('коротко', FONT) + PAD)
  })

  it('ячейки за логической границей листа не считаются', () => {
    const sh = sheetOf([[0, 0, 'abcd']])
    const narrow = { ...sh, cols: 1 }
    expect(autoColWidths(narrow, deps()).has(0)).toBe(true)
    expect(autoColWidths({ ...sh, cols: 0 }, deps()).has(0)).toBe(false)
  })
})
