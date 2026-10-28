import { describe, expect, it } from 'vitest'
import { cellKey, type SheetModel } from '../core/sheet'
import { demoSheet } from './example'
import { evalStandalone } from './engine'
import { FormulaError } from './types'

/*
 * Функции формул (Этап 4.1, список Ф6). Вычисляем на детерминированной
 * мини-таблице (A — фамилии, B — отделы, C — суммы), чтобы проверки
 * читались как сценарий. Ошибки — сообщениями человеческим языком.
 */

const SHEET = demoSheet()

function evalOn(src: string): unknown {
  return evalStandalone(SHEET, src, 0, 4)
}

function evalErr(src: string): string {
  const v = evalOn(src)
  expect(v, `ожидалась ошибка: ${src}`).toBeInstanceOf(FormulaError)
  return (v as FormulaError).message
}

describe('агрегаты (математика)', () => {
  it('SUM: диапазон + прямые числа, текст в диапазоне игнорируется', () => {
    expect(evalOn('=SUM(C2:C7)')).toBe(59800)
    expect(evalOn('=SUM(C2:C7;2)')).toBe(59802)
    expect(evalOn('=SUM("10";5)')).toBe(15)
  })

  it('SUMIF: значение, сравнение, неравенство, джокеры', () => {
    expect(evalOn('=SUMIF(A2:A7;"Иванов";C2:C7)')).toBe(10000) // один Иванов
    expect(evalOn('=SUMIF(A2:A7;"Иван*";C2:C7)')).toBe(10000)
    expect(evalOn('=SUMIF(C2:C7;">10000")')).toBe(27800)
    expect(evalOn('=SUMIF(C2:C7;">=10000")')).toBe(37800)
    expect(evalOn('=SUMIF(A2:A7;"<>Иванов";C2:C7)')).toBe(49800)
  })

  it('SUMIFS: несколько условий одновременно (как ПКМ-фильтр по «И»)', () => {
    // «Продажи» с суммой > 9900: Иванов 10000 — единственный (у Волковой 9800)
    expect(evalOn('=SUMIFS(C2:C7;B2:B7;"Продажи";C2:C7;">9900")')).toBe(10000)
    // все продажи: 10000 + 8000 + 9800
    expect(evalOn('=SUMIFS(C2:C7;B2:B7;"Продажи")')).toBe(27800)
    expect(evalErr('=SUMIFS(C2:C7;B2:B7)')).toContain('аргументов')
  })

  it('AVERAGE/AVERAGEIF', () => {
    expect(evalOn('=AVERAGE(C2:C4)')).toBeCloseTo((10000 + 12500 + 8000) / 3)
    expect(evalOn('=AVERAGEIF(B2:B7;"Продажи";C2:C7)')).toBeCloseTo(27800 / 3)
  })

  it('COUNT/COUNTA/COUNTBLANK/COUNTIF', () => {
    expect(evalOn('=COUNT(A1:C7)')).toBe(6)
    expect(evalOn('=COUNTA(A1:C7)')).toBe(21)
    expect(evalOn('=COUNTBLANK(A1:D8)')).toBe(11)
    expect(evalOn('=COUNTIF(A2:A7;"Иванов")')).toBe(1)
    expect(evalOn('=COUNTIF(C2:C7;">=10000")')).toBe(3)
  })

  it('MIN/MAX', () => {
    expect(evalOn('=MIN(C2:C7)')).toBe(4200)
    expect(evalOn('=MAX(C2:C7;99999)')).toBe(99999)
  })

  it('ROUND: половина — от нуля, отрицательная точность', () => {
    expect(evalOn('=ROUND(2.5)')).toBe(3)
    expect(evalOn('=ROUND(-2.5)')).toBe(-3)
    expect(evalOn('=ROUND(12550;-3)')).toBe(13000)
    expect(evalOn('=ROUND(12550;2)')).toBe(12550)
  })

  it('ROUNDDOWN: к нулю (novagrid-040, книги .ods)', () => {
    expect(evalOn('=ROUNDDOWN(2.9)')).toBe(2)
    expect(evalOn('=ROUNDDOWN(-2.9)')).toBe(-2)
    expect(evalOn('=ROUNDDOWN(12550;-3)')).toBe(12000)
    expect(evalOn('=ROUNDDOWN(3.14159;2)')).toBe(3.14)
  })

  it('MROUND: ближайшее кратное (novagrid-040)', () => {
    expect(evalOn('=MROUND(10;3)')).toBe(9)
    expect(evalOn('=MROUND(11;3)')).toBe(12)
    expect(evalOn('=MROUND(-10;-3)')).toBe(-9)
    expect(evalOn('=MROUND(10;0)')).toBe(0)
    expect(evalErr('=MROUND(10;-3)')).toContain('одного знака')
  })

  it('ABS', () => {
    expect(evalOn('=ABS(-500)')).toBe(500)
    expect(evalOn('=ABS(C2-C3)')).toBe(2500)
  })
})

describe('логика', () => {
  it('IF с ветками и без else', () => {
    expect(evalOn('=IF(C2>5000;"крупная";"обычная")')).toBe('крупная')
    expect(evalOn('=IF(C6>5000;"да")')).toBe(false)
  })

  it('IFS — первое выполненное условие', () => {
    expect(evalOn('=IFS(C2>15000;"крупная";C2>9000;"средняя")')).toBe('средняя')
    expect(evalErr('=IFS(C2>999999;"нет")')).toContain('ни одно условие')
  })

  it('AND/OR/NOT', () => {
    expect(evalOn('=AND(C2>1000;C2<100000)')).toBe(true)
    expect(evalOn('=AND(C2>1000;C2<9999)')).toBe(false)
    expect(evalOn('=OR(C2=8000;C2=10000)')).toBe(true)
    expect(evalOn('=NOT(C2>5000)')).toBe(false)
  })
})

describe('текст', () => {
  it('CONCAT/CONCATENATE и &', () => {
    expect(evalOn('=CONCAT(A2;" — ";B2)')).toBe('Иванов — Продажи')
    expect(evalOn('=CONCATENATE(A2;"!")')).toBe('Иванов!')
    expect(evalOn('=A3&" ("&B3&")"')).toBe('Петров (Логистика)')
  })

  it('LEFT/RIGHT/MID/LEN', () => {
    expect(evalOn('=LEFT("Иванов";2)')).toBe('Ив')
    expect(evalOn('=LEFT("Иванов")')).toBe('И')
    expect(evalOn('=RIGHT("Иванов";3)')).toBe('нов')
    expect(evalOn('=MID("Иванов";2;3)')).toBe('ван')
    expect(evalOn('=LEN("Иванов")')).toBe(6)
    expect(evalErr('=MID("Иванов";0;2)')).toContain('от 1')
  })

  it('TRIM: края и двойные внутри', () => {
    expect(evalOn('=TRIM("  Иванов  ")')).toBe('Иванов')
    expect(evalOn('=TRIM("Иванов   Петров")')).toBe('Иванов Петров')
  })

  it('UPPER/LOWER — кириллица', () => {
    expect(evalOn('=UPPER("иванов")')).toBe('ИВАНОВ')
    expect(evalOn('=LOWER("ИВАНОВ")')).toBe('иванов')
  })
})

describe('даты (ISO-строки)', () => {
  it('DATE собирает дату', () => {
    expect(evalOn('=DATE(2026;10;9)')).toBe('2026-10-09')
    expect(evalErr('=DATE(2026;13;1)')).toContain('такого дня')
  })

  it('YEAR/MONTH/DAY разбирают дату', () => {
    expect(evalOn('=YEAR(DATE(2026;10;9))')).toBe(2026)
    expect(evalOn('=MONTH(DATE(2026;10;9))')).toBe(10)
    expect(evalOn('=DAY(DATE(2026;10;9))')).toBe(9)
    expect(evalOn('=YEAR("2024-05-15")')).toBe(2024)
    expect(evalErr('=YEAR("не дата")')).toContain('вида')
  })

  it('YEAR/MONTH/DAY понимают и русский формат «ДД.ММ.ГГГГ» (novagrid-038)', () => {
    expect(evalOn('=YEAR("27.10.2026")')).toBe(2026)
    expect(evalOn('=MONTH("27.10.2026")')).toBe(10)
    expect(evalOn('=DAY("27.10.2026")')).toBe(27)
  })

  it('TODAY — формат ГГГГ-ММ-ДД', () => {
    expect(evalOn('=TODAY()')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('VLOOKUP', () => {
  it('точное совпадение (по умолчанию) возвращает ячейку строки', () => {
    expect(evalOn('=VLOOKUP("Сидоров";A2:C7;3)')).toBe(8000)
    expect(evalOn('=VLOOKUP("сидоров";A2:C7;3)')).toBe(8000) // без учёта регистра
  })

  it('не найдено и колонка вне диапазона — по-человечески', () => {
    expect(evalErr('=VLOOKUP("Неттакова";A2:C7;3)')).toContain('нет в первой колонке')
    expect(evalErr('=VLOOKUP("Иванов";A2:C7;9)')).toContain('3 колонк')
  })

  it('приближенный режим (ЛОЖЬ последним аргументом)', () => {
    // C2:C4 = 10000, 12500, 8000: последняя строка со значением ≤ 12000 — 8000
    expect(evalOn('=VLOOKUP(12000;C2:C4;1;ЛОЖЬ)')).toBe(8000)
    expect(evalOn('=VLOOKUP(10000;C2:C4;1)')).toBe(10000) // по умолчанию точно
    expect(evalErr('=VLOOKUP(12000;C2:C4;1)')).toContain('нет в первой колонке')
  })
})

describe('операторы', () => {
  it('арифметика и проценты', () => {
    expect(evalOn('=2+3*4')).toBe(14)
    expect(evalOn('=(2+3)*4')).toBe(20)
    expect(evalOn('=C2*10%')).toBe(1000)
    expect(evalOn('=2^10')).toBe(1024)
  })

  it('сравнения: числа, текст без регистра, числа меньше текста', () => {
    expect(evalOn('=1<2')).toBe(true)
    expect(evalOn('="иванов"="ИВАНОВ"')).toBe(true)
    expect(evalOn('="а"<>"б"')).toBe(true)
    expect(evalOn('=1<"а"')).toBe(true)
  })

  it('ошибки операторов', () => {
    expect(evalErr('=1/0')).toBe('Деление на ноль')
    expect(evalErr('="а"+1')).toContain('не число')
    expect(evalErr('=A1:A2*2')).toContain('диапазоном')
  })

  it('неизвестная функция — с подсказкой про справочник', () => {
    expect(evalErr('=SUMPRODUCT(C2:C7;C2:C7)')).toContain('Неизвестная функция SUMPRODUCT')
    expect(evalErr('=SUM()')).toContain('аргументов')
  })
})

describe('пустые ячейки', () => {
  it('пусто — 0 в арифметике, пустая строка в склейке', () => {
    expect(evalOn('=D2+5')).toBe(5)
    expect(evalOn('=D2&"х"')).toBe('х')
    expect(evalOn('=COUNTBLANK(D1:D3)')).toBe(3)
  })
})

// защита от случайной порчи мини-таблицы тестами выше
describe('demoSheet фиксирован', () => {
  it('ячейки на месте', () => {
    const sheet: SheetModel = demoSheet()
    expect(sheet.cells.get(cellKey(1, 0))).toBe('Иванов')
    expect(sheet.cells.get(cellKey(1, 2))).toBe('10000')
  })
})
