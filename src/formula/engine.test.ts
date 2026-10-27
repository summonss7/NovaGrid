import { describe, expect, it } from 'vitest'
import type { CellChange } from '../core/history'
import { cellKey, type SheetModel, withCell } from '../core/sheet'
import {
  applyFormulaChanges,
  canonicalFormulaText,
  cellError,
  cellIsFrozen,
  cellNumber,
  cellText,
  evalStandalone,
  formatNumber,
  formulaResultForSave,
  getValues,
  isFormulaRaw,
  recalcSheet,
} from './engine'
import { liveExample } from './example'
import { FormulaError } from './types'

/*
 * Движок формул (Этап 4.2): значения ячеек, пересчёт при правках по
 * зависимостям диапазонов, циклы, чужие формулы из файлов (кэш + ∛).
 */

function sheetOf(rows: readonly (readonly string[])[]): SheetModel {
  const cells = new Map<string, string>()
  let maxRow = -1
  let maxCol = -1
  rows.forEach((cellsRow, r) =>
    cellsRow.forEach((v, c) => {
      if (v !== '') {
        cells.set(cellKey(r, c), v)
        maxRow = Math.max(maxRow, r)
        maxCol = Math.max(maxCol, c)
      }
    }),
  )
  return { cells, styles: new Map(), rows: 100, cols: 26, maxRow, maxCol }
}

describe('вычисление значений', () => {
  it('формулы дают отображаемое значение и число', () => {
    const sheet = sheetOf([
      ['10', '20'],
      ['=A1+B1'],
    ])
    recalcSheet(sheet)
    expect(cellText(sheet, 1, 0)).toBe('30')
    expect(cellNumber(sheet, 1, 0)).toBe(30)
    expect(cellError(sheet, 1, 0)).toBeNull()
    expect(cellIsFrozen(sheet, 1, 0)).toBe(false)
  })

  it('не-формулы идут как есть', () => {
    const sheet = sheetOf([['иванов', '=SUM((1)']])
    recalcSheet(sheet)
    expect(cellText(sheet, 0, 0)).toBe('иванов')
    expect(isFormulaRaw('=')).toBe(false)
    expect(isFormulaRaw('=A1')).toBe(true)
    expect(cellText(sheet, 0, 1)).toBe('Не хватает закрывающей скобки')
    expect(cellError(sheet, 0, 1)).toBe('Не хватает закрывающей скобки')
  })

  it('цепочка ссылок через формулы', () => {
    const sheet = sheetOf([
      ['2', '=A1*2', '=B1+1'],
      ['=SUM(A1:C1)'],
    ])
    recalcSheet(sheet)
    expect(cellText(sheet, 0, 1)).toBe('4')
    expect(cellText(sheet, 0, 2)).toBe('5')
    expect(cellText(sheet, 1, 0)).toBe('11')
  })

  it('SUMIF по колонке целиком считает до границы контента', () => {
    const sheet = sheetOf([
      ['Иванов', '100'],
      ['Петров', '200'],
      ['Иванов', '300'],
      ['=SUMIF(A:A;"Иванов";B:B)'],
    ])
    recalcSheet(sheet)
    expect(cellText(sheet, 3, 0)).toBe('400')
  })
})

describe('пересчёт при правках (зависимости)', () => {
  const build = (): SheetModel =>
    sheetOf([
      ['Иванов', '10000', '', ''],
      ['Иванов', '2000', '', ''],
      ['', '', '=SUMIF(A:A;"Иванов";B:B)', ''],
      ['', '', '', '=C3*2'],
    ])

  const change = (prev: SheetModel, row: number, col: number, after: string): { prev: SheetModel; next: SheetModel; changes: CellChange[] } => {
    const changes: CellChange[] = [
      { row, col, before: (prev.cells.get(cellKey(row, col)) ?? ''), after },
    ]
    const next = withCell(prev, row, col, after)
    return { prev, next, changes }
  }

  it('правка аргумента переводняет цепочку зависимых', () => {
    const sheet = build()
    recalcSheet(sheet)
    expect(cellText(sheet, 2, 2)).toBe('12000')
    expect(cellText(sheet, 3, 3)).toBe('24000')

    const { prev, next, changes } = change(sheet, 1, 1, '5000')
    applyFormulaChanges(prev, next, changes)
    expect(cellText(next, 2, 2)).toBe('15000')
    expect(cellText(next, 3, 3)).toBe('30000')
  })

  it('удаление формулы убирает значение, зависимые видят пусто', () => {
    const sheet = build()
    recalcSheet(sheet)
    const { prev, next, changes } = change(sheet, 2, 2, '')
    applyFormulaChanges(prev, next, changes)
    expect(cellText(next, 2, 2)).toBe('')
    // D4 = C3*2, C3 пустая → 0
    expect(cellText(next, 3, 3)).toBe('0')
  })

  it('замена формулы на значение тоже пересчитывает', () => {
    const sheet = build()
    recalcSheet(sheet)
    const { prev, next, changes } = change(sheet, 2, 2, '7')
    applyFormulaChanges(prev, next, changes)
    expect(cellText(next, 2, 2)).toBe('7')
    expect(cellText(next, 3, 3)).toBe('14')
  })
})

describe('циклические ссылки', () => {
  it('прямая ссылка на себя', () => {
    const sheet = sheetOf([['=A1+1']])
    recalcSheet(sheet)
    expect(cellError(sheet, 0, 0)).toContain('Циклическая ссылка')
  })

  it('взаимные ссылки', () => {
    const sheet = sheetOf([['=B1', '=A1']])
    recalcSheet(sheet)
    expect(cellError(sheet, 0, 0)).toContain('Циклическая ссылка')
    expect(cellError(sheet, 0, 1)).toContain('Циклическая ссылка')
  })
})

describe('чужие формулы (4.6: кэш + ∛)', () => {
  it('неизвестная функция с кэшем из файла — заморожена', () => {
    const sheet = sheetOf([['1', '2'], ['=SUMPRODUCT(A1:B1;A1:B1)']])
    sheet.formulaCache = new Map([[cellKey(1, 0), '5']])
    recalcSheet(sheet)
    expect(cellText(sheet, 1, 0)).toBe('5')
    expect(cellIsFrozen(sheet, 1, 0)).toBe(true)
    expect(cellError(sheet, 1, 0)).toBeNull()
  })

  it('поддерживаемая функция из файла считается заново (кэш не нужен)', () => {
    const sheet = sheetOf([['10', '20'], ['=SUM(A1:B1)']])
    sheet.formulaCache = new Map([[cellKey(1, 0), '999']])
    recalcSheet(sheet)
    expect(cellText(sheet, 1, 0)).toBe('30')
    expect(cellIsFrozen(sheet, 1, 0)).toBe(false)
  })

  it('ручная опечатка без кэша — ошибка человеческим языком', () => {
    const sheet = sheetOf([['=SUMPROD(A1:A2)']])
    recalcSheet(sheet)
    expect(cellError(sheet, 0, 0)).toContain('Неизвестная функция')
    expect(cellIsFrozen(sheet, 0, 0)).toBe(false)
  })

  it('сохранение: канонический текст + результат (для .xlsx)', () => {
    const ok = sheetOf([['=SUM(A1:A2;1)']])
    recalcSheet(ok)
    expect(canonicalFormulaText('=SUM(A1:A2;1)')).toBe('SUM(A1:A2,1)')
    expect(formulaResultForSave(ok, 0, 0)).toEqual({ result: 1, canonical: 'SUM(A1:A2,1)' })

    const frozen = sheetOf([['=SUMPRODUCT(A1:A1)']])
    frozen.formulaCache = new Map([[cellKey(0, 0), '42']])
    recalcSheet(frozen)
    expect(formulaResultForSave(frozen, 0, 0)).toEqual({
      result: 42,
      canonical: '=SUMPRODUCT(A1:A1)'.slice(1),
    })
  })
})

describe('формат чисел', () => {
  it('без артефактов плавающей точки', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(1320000)).toBe('1320000')
    expect(formatNumber(-2.5)).toBe('-2.5')
    expect(formatNumber(1 / 3)).toBe('0.333333333333')
  })
})

describe('кэш значений (WeakMap)', () => {
  it('повторные чтения того же листа не пересчитывают', () => {
    const sheet = sheetOf([['=SUM(A1:A1)']])
    const a = getValues(sheet)
    const b = getValues(sheet)
    expect(a).toBe(b)
  })

  it('evalStandalone не портит кэш листа', () => {
    const sheet = sheetOf([['5'], ['=A1*2']])
    recalcSheet(sheet)
    expect(evalStandalone(sheet, '=A1+100')).toBe(105)
    expect(cellText(sheet, 1, 0)).toBe('10')
  })
})

describe('живой пример справочника', () => {
  it('считается в контексте листа', () => {
    const sheet = sheetOf([
      ['Иванов', '100'],
      ['Петров', '300'],
    ])
    expect(evalStandalone(sheet, '=SUM(B1:B2)')).toBe(400)
    expect(evalStandalone(sheet, '=SUM(нет')).toBeInstanceOf(FormulaError)
  })
})

describe('живые примеры справочника (example.ts)', () => {
  it('на таблице с данными пример строится по её колонкам и считается', () => {
    const sheet = sheetOf([
      ['Фамилия', 'Отдел', 'Сумма'],
      ['Иванов', 'Продажи', '10000'],
      ['Петров', 'Логистика', '12500'],
      ['Иванов', 'Продажи', '8000'],
    ])
    // агрегаты берут строки данных (шапку пропускают): C2:C4
    const sum = liveExample(sheet, 'SUM')
    expect(sum.formula).toBe('=SUM(C2:C4)')
    expect(sum.result).toBe('30500')
    const sumif = liveExample(sheet, 'SUMIF')
    expect(sumif.formula).toBe('=SUMIF(A2:A4;"Иванов";C2:C4)')
    expect(sumif.result).toBe('18000')
    const upper = liveExample(sheet, 'UPPER')
    expect(upper.formula).toBe('=UPPER(A2)')
    expect(upper.result).toBe('ИВАНОВ')
  })

  it('пустому листу служит встроенная мини-таблица', () => {
    const empty = sheetOf([[]])
    const sum = liveExample(empty, 'SUM')
    expect(sum.formula).toBe('=SUM(C2:C7)')
    expect(sum.result).toBe('59800')
  })
})

describe('дата-арифметика «+»/«−» (novagrid-038)', () => {
  it('«=A1+1» от даты — следующий календарный день', () => {
    const sheet = sheetOf([
      ['2026-10-27', '=A1+1'],
      ['=A1+0', '=A1+100'],
    ])
    recalcSheet(sheet)
    expect(cellText(sheet, 0, 1)).toBe('2026-10-28')
    expect(cellText(sheet, 1, 0)).toBe('2026-10-27')
    expect(cellText(sheet, 1, 1)).toBe('2027-02-04')
    // дата-результат — текст, не число: Σ его не суммирует
    expect(cellNumber(sheet, 0, 1)).toBeNull()
  })

  it('«−1» назад по календарю, «дата − дата» — дни между', () => {
    const sheet = sheetOf([
      ['2026-03-01', '=A1-1'],
      ['2026-10-27', '=A2-A1'],
    ])
    recalcSheet(sheet)
    expect(cellText(sheet, 0, 1)).toBe('2026-02-28')
    expect(cellText(sheet, 1, 1)).toBe('240')
    expect(cellNumber(sheet, 1, 1)).toBe(240)
  })

  it('русский формат «ДД.ММ.ГГГГ» тоже дата, результат в нём же', () => {
    const sheet = sheetOf([
      ['27.10.2026', '=A1+1', '=A1-31'],
    ])
    recalcSheet(sheet)
    expect(cellText(sheet, 0, 1)).toBe('28.10.2026')
    expect(cellText(sheet, 0, 2)).toBe('26.09.2026')
  })

  it('число + дата, дата с временем, TODAY()+1', () => {
    const sheet = sheetOf([
      ['2026-12-31 10:30', '=1+A1', '=A1+0.5'],
    ])
    recalcSheet(sheet)
    expect(cellText(sheet, 0, 1)).toBe('2027-01-01 10:30')
    // +0.5 дня — время сдвигается на 12 часов (дробные дни честно считаются)
    expect(cellText(sheet, 0, 2)).toBe('2026-12-31 22:30')
    expect(evalStandalone(sheetOf([[]]), '=TODAY()+1')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('ошибки человеческим языком: складывать даты, число минус дата, дата плюс текст', () => {
    const sheet = sheetOf([
      ['2026-10-27', '2026-10-28'],
      ['=A1+B1', '=5-A1', '=A1+"два"'],
    ])
    recalcSheet(sheet)
    expect(cellError(sheet, 1, 0)).toContain('нельзя складывать')
    expect(cellError(sheet, 1, 1)).toContain('Из числа нельзя вычесть дату')
    expect(cellError(sheet, 1, 2)).toContain('не число')
  })

  it('обычные числа «+»/«−» работают как раньше', () => {
    const sheet = sheetOf([['10', '=A1+1', '=A1-1', '=A1*2']])
    recalcSheet(sheet)
    expect(cellText(sheet, 0, 1)).toBe('11')
    expect(cellText(sheet, 0, 2)).toBe('9')
    expect(cellText(sheet, 0, 3)).toBe('20')
  })
})
