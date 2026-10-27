import { describe, expect, it } from 'vitest'
import { FormulaError } from './types'
import { compileFormula, formatAst, parseCellRef, refName, shiftFormulaRefs } from './parser'

/*
 * Парсер формул (Этап 4.1): структура, приоритеты, локали разделителей,
 * ошибки человеческим языком (КТ: «Не хватает закрывающей скобки»,
 * «Диапазон A5:A2 записан снизу вверх — нужно A2:A5»).
 */

function parseError(src: string): string {
  try {
    compileFormula(src)
  } catch (e) {
    if (e instanceof FormulaError) return e.message
    throw e
  }
  return ''
}

describe('адреса и имена', () => {
  it('parseCellRef: A1 и $B$12, мусор отвергается', () => {
    expect(parseCellRef('A1')).toEqual({ row: 0, col: 0 })
    expect(parseCellRef('$B$12')).toEqual({ row: 11, col: 1 })
    expect(parseCellRef('AA100')).toEqual({ row: 99, col: 26 })
    expect(parseCellRef('Иванов')).toBeNull()
    expect(parseCellRef('A0')).toBeNull()
    expect(parseCellRef('A1048577')).toBeNull()
  })

  it('refName — обратное преобразование', () => {
    expect(refName(0, 0)).toBe('A1')
    expect(refName(11, 1)).toBe('B12')
    expect(refName(99, 26)).toBe('AA100')
  })
})

describe('структура формул', () => {
  it('числа: точка и запятая (когда есть «;»)', () => {
    expect(compileFormula('1.5').ast).toEqual({ t: 'num', v: 1.5 })
    // запятая десятичная, «;» — разделитель аргументов
    expect(compileFormula('SUM(1,5;2)').ast).toEqual({
      t: 'call',
      name: 'SUM',
      args: [
        { t: 'num', v: 1.5 },
        { t: 'num', v: 2 },
      ],
    })
  })

  it('запятая без «;» — разделитель аргументов', () => {
    const f = compileFormula('SUM(1,2)')
    expect(f.ast).toEqual({
      t: 'call',
      name: 'SUM',
      args: [
        { t: 'num', v: 1 },
        { t: 'num', v: 2 },
      ],
    })
  })

  it('строки с экранированной кавычкой', () => {
    expect(compileFormula('"а""б"').ast).toEqual({ t: 'str', v: 'а"б' })
  })

  it('ссылки и диапазоны, включая колонку целиком', () => {
    expect(compileFormula('$A$1').ast).toEqual({ t: 'ref', row: 0, col: 0 })
    expect(compileFormula('A2:B3').ast).toEqual({ t: 'range', r1: 1, c1: 0, r2: 2, c2: 1 })
    expect(compileFormula('B:B').ast).toEqual({ t: 'range', r1: 0, c1: 1, r2: -1, c2: 1 })
    expect(compileFormula('A:C').ast).toEqual({ t: 'range', r1: 0, c1: 0, r2: -1, c2: 2 })
  })

  it('приоритет операций и скобки', () => {
    // 2+3*4 = 14 — умножение выше
    const ast = compileFormula('2+3*4').ast
    expect(ast).toEqual({
      t: 'bin',
      op: '+',
      l: { t: 'num', v: 2 },
      r: {
        t: 'bin',
        op: '*',
        l: { t: 'num', v: 3 },
        r: { t: 'num', v: 4 },
      },
    })
    // унарный минус держится за числом: -2^2 = (-2)^2
    const neg = compileFormula('-2^2').ast as { t: 'bin'; op: string; l: unknown }
    expect(neg.op).toBe('^')
    expect(neg.l).toEqual({ t: 'neg', e: { t: 'num', v: 2 } })
  })

  it('проценты', () => {
    expect(compileFormula('50%').ast).toEqual({ t: 'percent', e: { t: 'num', v: 50 } })
  })

  it('логические константы в обеих нотациях', () => {
    expect(compileFormula('ИСТИНА').ast).toEqual({ t: 'bool', v: true })
    expect(compileFormula('false').ast).toEqual({ t: 'bool', v: false })
  })
})

describe('ошибки человеческим языком', () => {
  it('незакрытые скобки', () => {
    expect(parseError('SUM(1')).toBe('Не хватает закрывающей скобки')
    expect(parseError('(1+2')).toBe('Не хватает закрывающей скобки')
    expect(parseError('1+2)')).toBe('Лишняя закрывающая скобка')
  })

  it('диапазон снизу вверх — с подсказкой правильного', () => {
    expect(parseError('A5:A2')).toBe('Диапазон A5:A2 записан снизу вверх — нужно A2:A5')
    expect(parseError('B2:A2')).toContain('справа налево')
  })

  it('неизвестное имя', () => {
    expect(parseError('ivanov')).toContain('Неизвестное имя')
  })

  it('лишние символы и незакрытая кавычка', () => {
    expect(parseError('1 2')).toBe('После формулы остались лишние символы')
    expect(parseError('"текст')).toContain('кавычка')
  })

  it('разделитель между аргументами', () => {
    expect(parseError('SUM(1 2)')).toContain('разделитель')
  })
})

describe('зависимости', () => {
  it('deps собирает ссылки и прямоугольники', () => {
    const f = compileFormula('SUM(A1:B3)+C1')
    expect(f.deps).toEqual([
      { r1: 0, c1: 0, r2: 2, c2: 1 },
      { r1: 0, c1: 2, r2: 0, c2: 2 },
    ])
  })

  it('вложенные вызовы обходятся', () => {
    const f = compileFormula('IF(A1>0;SUM(B1:B2);C1)')
    expect(f.deps).toEqual([
      { r1: 0, c1: 0, r2: 0, c2: 0 },
      { r1: 0, c1: 1, r2: 1, c2: 1 },
      { r1: 0, c1: 2, r2: 0, c2: 2 },
    ])
  })
})

describe('канонический текст для .xlsx', () => {
  it('разделители становятся запятыми, числа — точкой', () => {
    expect(formatAst(compileFormula('SUM(A1;1,5)').ast)).toBe('SUM(A1,1.5)')
    expect(formatAst(compileFormula('IF(A1>=2;"да";"")').ast)).toBe('IF(A1>=2,"да","")')
    expect(formatAst(compileFormula('B:B').ast)).toBe('B:B')
  })
})

describe('shiftFormulaRefs — сдвиг ссылок при копировании (novagrid-037)', () => {
  it('относительные ссылки двигаются, $-абсолютные стоят', () => {
    expect(shiftFormulaRefs('=A1+1', 1, 0)).toBe('=A2+1')
    expect(shiftFormulaRefs('=A1+$B$2', 1, 1)).toBe('=B2+$B$2')
    expect(shiftFormulaRefs('=$A1+B$2', 2, 2)).toBe('=$A3+D$2')
  })

  it('диапазон сдвигается целиком, у каждой границы свои $', () => {
    expect(shiftFormulaRefs('=SUM(A1:A5)', 2, 0)).toBe('=SUM(A3:A7)')
    expect(shiftFormulaRefs('=SUM($A1:A$5)', 1, 1)).toBe('=SUM($A2:B$5)')
  })

  it('строки в кавычках не трогаются', () => {
    expect(shiftFormulaRefs('="A1"+"B2"', 5, 5)).toBe('="A1"+"B2"')
    expect(shiftFormulaRefs('="дата +""A1""..."&B1', 1, 0)).toBe('="дата +""A1""..."&B2')
  })

  it('имя функции с цифрами (LOG10) — не ссылка', () => {
    expect(shiftFormulaRefs('=LOG10(100)+A1', 1, 0)).toBe('=LOG10(100)+A2')
    expect(shiftFormulaRefs('=СУММ(A1:A2)', 1, 0)).toBe('=СУММ(A2:A3)')
  })

  it('хвост имени (A1 внутри A1Б) не сдвигается', () => {
    expect(shiftFormulaRefs('=A1Б+1', 1, 0)).toBe('=A1Б+1')
  })

  it('сдвиг за край клампится к началу листа', () => {
    expect(shiftFormulaRefs('=A1+B2', -5, -5)).toBe('=A1+A1')
  })

  it('не формула и нулевой сдвиг — текст без изменений', () => {
    expect(shiftFormulaRefs('A1', 1, 1)).toBe('A1')
    expect(shiftFormulaRefs('=A1', 0, 0)).toBe('=A1')
  })
})
