import { describe, expect, it } from 'vitest'
import { applySuggestion, computeAssist } from './assist'

/*
 * Автодополнение (4.4): подсказки по префиксу после «=», подпись аргументов
 * вызова с номером текущего, и когда списка быть не должно (после «(» —
 * только подпись аргументов, Enter обязан фиксировать формулу).
 */

describe('подсказки имён функций', () => {
  it('префикс после «=» фильтрует список, короткие имена раньше', () => {
    const a = computeAssist('=SU', 3)
    expect(a).not.toBeNull()
    expect(a!.suggestions[0].name).toBe('SUM')
    expect(a!.suggestions.map((s) => s.name)).toContain('SUMIF')
    expect(a!.prefixStart).toBe(1)
    expect(a!.prefixEnd).toBe(3)
  })

  it('пустой префикс: список только сразу после «=», не после «(»', () => {
    expect(computeAssist('=', 1)!.suggestions.length).toBeGreaterThan(0)
    const afterParen = computeAssist('=SUM(', 5)
    expect(afterParen!.suggestions).toEqual([])
    expect(afterParen!.argHint?.name).toBe('SUM')
  })

  it('среди слова-адреса подсказок нет (A5 после двоеточия)', () => {
    const a = computeAssist('=SUMIF(A2:A5', 10)
    expect(a?.suggestions ?? []).toEqual([])
  })

  it('не формула — null; один «=» — уже список', () => {
    expect(computeAssist('SUM(', 4)).toBeNull()
    expect(computeAssist('текст', 2)).toBeNull()
  })
})

describe('подпись аргументов', () => {
  it('номер аргумента по разделителям на глубине 0', () => {
    expect(computeAssist('=IF(a', 5)!.argHint?.argIdx).toBe(0)
    expect(computeAssist('=IF(a;b', 7)!.argHint?.argIdx).toBe(1)
    expect(computeAssist('=IF(a;b;', 8)!.argHint?.argIdx).toBe(2)
    // вложенный вызов: каретка внутри SUM (после «b»)
    const nested = computeAssist('=IF(SUM(a;b);c;d', 11)
    expect(nested!.argHint?.name).toBe('SUM')
    expect(nested!.argHint?.argIdx).toBe(1)
  })

  it('строки не считаются разделителями', () => {
    const a = computeAssist('=CONCAT("a;b";c', 15)
    expect(a!.argHint?.argIdx).toBe(1)
  })
})

describe('подстановка', () => {
  it('префикс заменяется именем со скобкой, каретка после неё', () => {
    expect(applySuggestion('=SU', 1, 3, 'SUMIF')).toEqual({
      value: '=SUMIF(',
      caret: 7,
    })
  })
})
