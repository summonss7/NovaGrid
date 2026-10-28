import { describe, expect, it } from 'vitest'
import { type GridTheme, cellFontOf, cellPxOf } from './renderer'

/* для cellFontOf/cellPxOf из темы нужен только базовый px ячейки */
const theme = { cellPx: 13.5 } as GridTheme

describe('cellFontOf/cellPxOf: шрифт ячейки из стиля (novagrid-039)', () => {
  it('без стиля — стандартный шрифт грида', () => {
    expect(cellFontOf(undefined, theme)).toBe(`13.5px ${'"Open Sans", "Segoe UI", system-ui, sans-serif'}`)
    expect(cellPxOf(undefined, theme)).toBe(13.5)
  })

  it('жирность и курсив собираются в canvas font', () => {
    expect(cellFontOf({ bold: true, italic: true }, theme)).toMatch(/^italic 600 /)
  })

  it('размер pt переводится в px как в Excel (96 dpi), с округлением до 0,1', () => {
    expect(cellPxOf({ size: 12 }, theme)).toBe(16) // 12pt × 4/3
    expect(cellPxOf({ size: 10.5 }, theme)).toBe(14)
    expect(cellPxOf({ size: 8 }, theme)).toBe(10.7) // 10,666… → 10,7
  })

  it('гарнитура display — Montserrat', () => {
    expect(cellFontOf({ font: 'display' }, theme)).toContain('Montserrat')
    expect(cellFontOf({ font: 'sans' }, theme)).toContain('Open Sans')
  })
})
