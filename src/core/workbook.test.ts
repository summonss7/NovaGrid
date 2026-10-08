import { describe, expect, it } from 'vitest'
import { createSheet } from './sheet'
import {
  DEFAULT_SHEET_NAME,
  createTab,
  createTabs,
  sanitizeSheetName,
  tabsFromWire,
  uniqueTabName,
} from './workbook'

describe('workbook: имена листов (правила Excel)', () => {
  it('sanitizeSheetName вырезает запрещённые символы и обрезает до 31', () => {
    expect(sanitizeSheetName('Отчёт/2026?')).toBe('Отчёт 2026')
    expect(sanitizeSheetName('a[b]c:d*e')).toBe('a b c d e')
    expect(sanitizeSheetName('   ')).toBe('')
    expect(sanitizeSheetName('Л'.repeat(40)).length).toBe(31)
  })

  it('uniqueTabName даёт «Лист», «Лист (2)», «Лист (3)» без учёта регистра', () => {
    expect(uniqueTabName([], 'Лист')).toBe('Лист')
    expect(uniqueTabName(['Лист'], 'Лист')).toBe('Лист (2)')
    expect(uniqueTabName(['Лист', 'Лист (2)'], 'Лист')).toBe('Лист (3)')
    expect(uniqueTabName(['лист'], 'Лист')).toBe('Лист (2)')
  })
})

describe('workbook: вкладки из IO (wire)', () => {
  it('createTabs — один пустой «Лист 1»', () => {
    const tabs = createTabs()
    expect(tabs).toHaveLength(1)
    expect(tabs[0].name).toBe(DEFAULT_SHEET_NAME)
    expect(tabs[0].sheet.cells.size).toBe(0)
  })

  it('tabsFromWire даёт уникальные имена и уникальные id', () => {
    const sheet = createSheet()
    const tabs = tabsFromWire({
      sheets: [
        { name: 'Данные', sheet },
        { name: 'Данные', sheet },
        { name: 'данные', sheet },
      ],
    })
    const names = tabs.map((t) => t.name.toLowerCase())
    expect(new Set(names).size).toBe(3)
    expect(new Set(tabs.map((t) => t.id)).size).toBe(3)
    expect(tabs[0].name).toBe('Данные')
    expect(tabs[1].name).toBe('Данные (2)')
  })

  it('createTab генерирует стабильные уникальные id', () => {
    const a = createTab('A')
    const b = createTab('B')
    expect(a.id).not.toBe(b.id)
  })
})
