import { describe, expect, it } from 'vitest'
import { type GridTheme, cellFontOf, cellPxOf, inkForCell } from './renderer'

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

describe('inkForCell: цвет текста с автоконтрастом к заливке (novagrid-055)', () => {
  /* тёмная тема: светлые чернила — сценарий шапки прайса SelPrice, где
     светло-голубая заливка из файла делала светлый текст невидимым */
  const dark = { cellPx: 13.5, ink: '#e8eae7' } as GridTheme
  const light = { cellPx: 13.5, ink: '#2b2b2b' } as GridTheme

  it('светлая заливка — тёмный текст в обеих темах (шапка прайса D9E1F2)', () => {
    expect(inkForCell(undefined, 'D9E1F2', dark)).toBe('#2b2b2b')
    expect(inkForCell(undefined, 'D9E1F2', light)).toBe('#2b2b2b')
    expect(inkForCell(undefined, 'FFFFFF', dark)).toBe('#2b2b2b')
  })

  it('тёмная заливка — светлый текст в обеих темах', () => {
    expect(inkForCell(undefined, '1F3864', dark)).toBe('#e8eae7')
    expect(inkForCell(undefined, '1F3864', light)).toBe('#e8eae7')
  })

  it('явный цвет шрифта неприкосновенен, без заливки — чернила темы', () => {
    expect(inkForCell('C00000', 'D9E1F2', dark)).toBe('#C00000')
    expect(inkForCell(undefined, undefined, dark)).toBe('#e8eae7')
    expect(inkForCell(undefined, undefined, light)).toBe('#2b2b2b')
  })
})
