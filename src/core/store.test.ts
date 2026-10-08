import { beforeEach, describe, expect, it } from 'vitest'
import { createSheet, getCell, withCell } from './sheet'
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

describe('store: книга и вкладки (Этап 2.2)', () => {
  it('loadBook загружает листы из IO с метаданными файла', () => {
    s().loadBook(
      {
        sheets: [
          {
            name: 'Данные',
            sheet: (() => {
              let sh = createSheet()
              sh = withCell(sh, 0, 0, 'A1')
              return sh
            })(),
          },
          { name: 'Справка', sheet: createSheet() },
        ],
      },
      { fileName: 'отчёт.xlsx', fileFormat: 'xlsx' },
    )
    expect(s().tabs.map((t) => t.name)).toEqual(['Данные', 'Справка'])
    expect(s().activeTab).toBe(0)
    expect(getCell(s().sheet, 0, 0)).toBe('A1')
    expect(s().fileName).toBe('отчёт.xlsx')
    expect(s().fileFormat).toBe('xlsx')
    expect(s().dirty).toBe(false)
  })

  it('addTab добавляет уникальное имя и активирует новую вкладку', () => {
    expect(s().tabs).toHaveLength(1)
    s().addTab()
    expect(s().tabs).toHaveLength(2)
    expect(s().activeTab).toBe(1)
    expect(s().tabs[1].name).toBe('Лист 2')
    s().renameTab(1, 'Лист 1') // дубль имени → уникализация
    expect(s().tabs[1].name).toBe('Лист 1 (2)')
    expect(s().dirty).toBe(true)
  })

  it('duplicateTab копирует контент, история копии независима', () => {
    s().duplicateTab(0)
    expect(s().tabs).toHaveLength(2)
    expect(s().tabs[1].name).toBe('Лист 1 (2)')
    expect(getCell(s().tabs[1].sheet, 1, 0)).toBe('Иванов')
    // правка на копии не трогает оригинал
    s().clickCell(1, 0)
    s().beginEdit('X')
    s().commitEdit('none')
    expect(getCell(s().tabs[1].sheet, 1, 0)).toBe('X')
    expect(getCell(s().tabs[0].sheet, 1, 0)).toBe('Иванов')
  })

  it('removeTab не удаляет единственную вкладку, активная переходит к соседу', () => {
    expect(s().removeTab(0)).toBe(false) // единственная
    s().addTab() // активна 1
    s().clickCell(1, 0)
    s().beginEdit('Z')
    s().commitEdit('none')
    expect(s().removeTab(1)).toBe(true)
    expect(s().tabs).toHaveLength(1)
    expect(s().activeTab).toBe(0)
    expect(getCell(s().sheet, 1, 0)).toBe('Иванов')
  })

  it('undo изолирован по вкладкам', () => {
    s().addTab()
    // правка на вкладке 1
    s().clickCell(0, 0)
    s().beginEdit('новый')
    s().commitEdit('none')
    expect(getCell(s().sheet, 0, 0)).toBe('новый')
    // переключились на вкладку 0 — undo там пусто
    s().activateTab(0)
    s().undo()
    expect(getCell(s().sheet, 1, 2)).toBe('10000') // ничего не откатилось
    // вернулись — undo работает
    s().activateTab(1)
    s().undo()
    expect(getCell(s().sheet, 0, 0)).toBe('')
  })

  it('правки ставят dirty, markSaved снимает и запоминает формат', () => {
    expect(s().dirty).toBe(false)
    s().clickCell(1, 2)
    s().beginEdit('555')
    s().commitEdit('none')
    expect(s().dirty).toBe(true)
    s().markSaved('книга.csv', { fileFormat: 'csv', csvDelimiter: ',' })
    expect(s().dirty).toBe(false)
    expect(s().fileName).toBe('книга.csv')
    expect(s().fileFormat).toBe('csv')
    expect(s().csvDelimiter).toBe(',')
  })
})
