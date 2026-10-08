import { beforeEach, describe, expect, it } from 'vitest'
import { getCell } from './sheet'
import { gridStore, selectionMetrics } from './store'

const s = () => gridStore.getState()

beforeEach(() => {
  s().seedDemo()
})

describe('store: редактирование (1.3)', () => {
  it('демо-лист сценария ТЗ засеян', () => {
    expect(getCell(s().sheet, 1, 0)).toBe('Иванов')
    expect(getCell(s().sheet, 1, 2)).toBe('10000')
  })

  it('ввод с заменой: символ → commitEdit фиксирует значение и двигает вниз', () => {
    s().clickCell(0, 1)
    s().beginEdit('О')
    s().setEditValue('Отдел X')
    s().commitEdit('down')
    expect(getCell(s().sheet, 0, 1)).toBe('Отдел X')
    expect(s().selection.active).toEqual({ row: 1, col: 1 })
    expect(s().edit).toBeNull()
  })

  it('commitEdit без изменений не пишет историю', () => {
    s().clickCell(1, 0)
    s().beginEdit()
    s().setEditValue('Иванов') // то же значение
    s().commitEdit('none')
    s().undo()
    expect(getCell(s().sheet, 1, 0)).toBe('Иванов') // ничего не откатилось
  })

  it('Escape отменяет правку', () => {
    s().clickCell(1, 0)
    s().beginEdit()
    s().setEditValue('Пупкин')
    s().cancelEdit()
    expect(getCell(s().sheet, 1, 0)).toBe('Иванов')
    expect(s().edit).toBeNull()
  })
})

describe('store: undo/redo (1.5)', () => {
  it('правка откатывается и возвращается', () => {
    s().clickCell(1, 2)
    s().beginEdit()
    s().setEditValue('555')
    s().commitEdit('none')
    expect(getCell(s().sheet, 1, 2)).toBe('555')
    s().undo()
    expect(getCell(s().sheet, 1, 2)).toBe('10000')
    s().redo()
    expect(getCell(s().sheet, 1, 2)).toBe('555')
  })

  it('Delete очищает выделение одной транзакцией, undo возвращает всё', () => {
    s().clickCell(0, 0)
    s().clickCell(0, 0, { shift: false })
    // Shift-клик по C1 расширяет до A1:C1 — очистим шапку демо-таблицы
    s().clickCell(0, 2, { shift: true })
    s().deleteSelection()
    expect(getCell(s().sheet, 0, 0)).toBe('')
    expect(getCell(s().sheet, 0, 2)).toBe('')
    s().undo()
    expect(getCell(s().sheet, 0, 0)).toBe('Фамилия')
    expect(getCell(s().sheet, 0, 2)).toBe('Сумма')
  })
})

describe('store: выделение (1.4)', () => {
  it('Ctrl-клик собирает несмежные области, повторный снимает одиночную', () => {
    s().clickCell(1, 2) // Иванов 10000
    s().clickCell(2, 2, { ctrl: true }) // Петров 12500
    const m = selectionMetrics(s().sheet, s().selection)
    expect(m.count).toBe(2)
    expect(m.total).toBe(22500)
    s().clickCell(2, 2, { ctrl: true }) // повторный Ctrl-клик — снять
    expect(selectionMetrics(s().sheet, s().selection).count).toBe(1)
  })

  it('Ctrl+A выделяет весь контент', () => {
    s().selectAll()
    expect(selectionMetrics(s().sheet, s().selection).filled).toBe(7 * 3)
  })

  it('Esc снимает выделение до активной ячейки', () => {
    s().clickCell(1, 2)
    s().clickCell(3, 2, { shift: true })
    expect(selectionMetrics(s().sheet, s().selection).count).toBe(3)
    s().escape()
    expect(selectionMetrics(s().sheet, s().selection).count).toBe(1)
  })

  it('стрелки двигают активную ячейку, Shift растягивает диапазон', () => {
    s().clickCell(0, 0)
    s().moveActive(1, 0)
    s().moveActive(0, 1)
    expect(s().selection.active).toEqual({ row: 1, col: 1 })
    s().moveActive(1, 0, { extend: true })
    const m = selectionMetrics(s().sheet, s().selection)
    expect(m.count).toBe(0) // диапазон B2:B3 («Продажи», «Логистика») — чисел нет
    expect(m.filled).toBe(2)
  })

  it('клик во время правки фиксирует её, а не отбрасывает', () => {
    s().clickCell(1, 2)
    s().beginEdit()
    s().setEditValue('777')
    s().clickCell(2, 2)
    expect(getCell(s().sheet, 1, 2)).toBe('777')
    expect(s().selection.active).toEqual({ row: 2, col: 2 })
  })
})

describe('store: стресс-режим', () => {
  it('seedStress создаёт 100k×30 с числовой колонкой', () => {
    s().seedStress(100000, 30)
    expect(s().sheet.rows).toBe(100000)
    expect(s().sheet.cols).toBe(30)
    expect(getCell(s().sheet, 99999, 0)).toBe('100000')
    // границы и история сброшены
    s().undo()
    expect(getCell(s().sheet, 99999, 0)).toBe('100000')
  })
})
