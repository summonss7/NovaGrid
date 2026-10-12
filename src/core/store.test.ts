import { beforeEach, describe, expect, it } from 'vitest'
import { visibleRowsOf } from './filter'
import { createSheet, getCell, withCell } from './sheet'
import { cellNumber } from '../formula/engine'
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

describe('store: фильтры (Этап 3, Ф3)', () => {
  it('ПКМ-сценарий: A = Иванов, затем добавить C = 10000 — объединение по «И»', () => {
    s().filterByValue(0, 'Иванов')
    expect(s().filters).toEqual([{ col: 0, mode: 'include', values: ['Иванов'] }])
    // видимые: строки с фамилией Иванов (в демо-листе это строки 1 и 4)
    const vis1 = visibleRowsOf(s().sheet, s().filters)!
    expect(vis1).toContain(1)

    s().filterByValue(2, '10000')
    const vis2 = visibleRowsOf(s().sheet, s().filters)!
    // Иванов + 10000 — только строка 1 (у Кузнецовой в строке 4 другая сумма)
    expect(vis2).toEqual([1])

    // инверсия: exclude
    s().excludeByValue(0, 'Иванов')
    expect(s().filters.find((f) => f.col === 0)?.mode).toBe('exclude')

    s().clearAllFilters()
    expect(s().filters).toEqual([])
  })

  it('добавление значения к фильтру: {Иванов, Петров}', () => {
    s().filterByValue(0, 'Иванов')
    s().addValueToFilter(0, 'Петров')
    const f = s().filters.find((x) => x.col === 0)
    expect(f?.values).toEqual(['Иванов', 'Петров'])
    // повторное добавление не дублирует
    s().addValueToFilter(0, 'Петров')
    expect(s().filters.find((x) => x.col === 0)?.values).toEqual(['Иванов', 'Петров'])
  })

  it('include, покрывающий все значения колонки, снимает фильтр', () => {
    s().setColumnFilter({
      col: 0,
      mode: 'include',
      values: ['Фамилия', 'Иванов', 'Петров', 'Сидоров', 'Кузнецова', 'Смирнов', 'Волкова'],
    })
    expect(s().filters).toEqual([])
  })

  it('фильтры изолированы по вкладкам', () => {
    s().filterByValue(0, 'Иванов')
    s().addTab()
    expect(s().filters).toEqual([])
    s().filterByValue(0, 'X') // на новой вкладке
    s().activateTab(0)
    expect(s().filters).toEqual([{ col: 0, mode: 'include', values: ['Иванов'] }])
  })

  it('метрики выделения не считают скрытые строки (КТ-3: Σ по видимым)', () => {
    // демо-лист: сплошной диапазон A1:C7 без фильтра — все 6 чисел
    s().selectAll()
    expect(selectionMetrics(s().sheet, s().selection).total).toBe(59800)
    // фильтр A = Петров скрывает остальных — колонка C целиком даёт только 12500
    s().filterByValue(0, 'Петров')
    const vis = visibleRowsOf(s().sheet, s().filters)
    expect(selectionMetrics(s().sheet, s().selection, vis).total).toBe(12500)
    s().clearAllFilters()
  })

  it('sortColumn переставляет значения видимых строк и откатывается undo', () => {
    s().sortColumn(2, 'asc')
    // все 7 строк колонки C непустые: числа по возрастанию, текст-шапка в конце
    expect(getCell(s().sheet, 0, 2)).toBe('4200')
    expect(getCell(s().sheet, 1, 2)).toBe('8000')
    expect(getCell(s().sheet, 5, 2)).toBe('15300')
    expect(getCell(s().sheet, 6, 2)).toBe('Сумма')
    s().undo()
    expect(getCell(s().sheet, 0, 2)).toBe('Сумма')
    expect(getCell(s().sheet, 1, 2)).toBe('10000')
    expect(getCell(s().sheet, 6, 2)).toBe('9800')
  })
})

describe('store: поиск (Этап 3, Ф2)', () => {
  it('инкрементальный поиск по листу: счётчик, шаг, закрытие', () => {
    s().openSearch()
    s().setSearchQuery('Иванов')
    expect(s().search.hits.length).toBe(1) // в демо-листе один Иванов
    s().setSearchQuery('о')
    expect(s().search.hits.length).toBeGreaterThan(3)
    // Enter-навигация двигает активную ячейку по совпадениям циклично
    const first = s().search.index
    s().searchStep(1)
    const second = s().search.index
    expect(second).not.toBe(first)
    s().closeSearch()
    expect(s().search.open).toBe(false)
    expect(s().search.hits).toEqual([])
  })

  it('поиск по книге: второй лист включается, переход активирует вкладку', () => {
    s().addTab()
    s().clickCell(0, 0)
    s().beginEdit('Иванов')
    s().commitEdit('none')
    s().activateTab(0)
    s().openSearch()
    s().setSearchScope('book')
    s().setSearchQuery('Иванов')
    expect(s().search.hits.length).toBe(2)
    // шаг до совпадения на вкладке 1 — вкладка активируется
    const target = s().search.hits.find((h) => h.tab === 1)!
    s().gotoHit(target)
    expect(s().activeTab).toBe(1)
    expect(s().selection.active).toEqual({ row: 0, col: 0 })
  })

  it('правки обновляют совпадения живьём', () => {
    s().openSearch()
    s().setSearchQuery('Иванов')
    expect(s().search.hits.length).toBe(1)
    s().clickCell(1, 0)
    s().beginEdit('Ивановский')
    s().commitEdit('none')
    expect(s().search.hits.length).toBe(1) // «Ивановский» тоже содержит «Иванов»
    s().undo()
    expect(s().search.hits.length).toBe(1)
    s().setSearchQuery('Ивановский')
    expect(s().search.hits.length).toBe(0)
  })
})

describe('store: ширины колонок (novagrid-020)', () => {
  it('setColWidth переопределяет ширину, стандартная — сбрасывает', () => {
    expect(s().colWidths).toBeNull()
    s().setColWidth(0, 150)
    expect(s().colWidths?.get(0)).toBe(150)
    s().setColWidth(0, 96) // стандартная ширина = сброс
    expect(s().colWidths).toBeNull()
  })

  it('ширины клампятся и хранятся по вкладкам', () => {
    s().setColWidth(1, 10)
    expect(s().colWidths?.get(1)).toBe(32) // минимум
    s().setColWidth(1, 1000)
    expect(s().colWidths?.get(1)).toBe(400) // максимум
    s().addTab()
    expect(s().colWidths).toBeNull() // новый лист — стандартные
    s().activateTab(0)
    expect(s().colWidths?.get(1)).toBe(400) // прежний лист помнит
  })
})

describe('store: указание ссылок формулы (novagrid-020)', () => {
  it('клик по ячейке вставляет адрес на место каретки, протяжка — диапазон', () => {
    s().clickCell(3, 3)
    s().beginEdit('=')
    s().setEditCaret(1)
    s().pointCell(1, 0, false) // A2
    expect(s().edit?.value).toBe('=A2')
    s().setEditValue('=A2+') // ручной ввод сбросил жест
    s().setEditCaret(4)
    s().pointCell(2, 1, false) // B3
    expect(s().edit?.value).toBe('=A2+B3')
    s().pointCell(4, 2, true) // протянуть до C5 → B3:C5
    expect(s().edit?.value).toBe('=A2+B3:C5')
    s().commitEdit('none')
    expect(getCell(s().sheet, 3, 3)).toBe('=A2+B3:C5')
  })

  it('указание не двигает активную ячейку и сворачивается по Esc', () => {
    s().clickCell(3, 3)
    s().beginEdit('=')
    s().pointCell(1, 0, false)
    expect(s().selection.active).toEqual({ row: 3, col: 3 })
    expect(s().selection.ranges).toEqual([{ fr: 1, fc: 0, tr: 1, tc: 0 }])
    s().cancelEdit()
    expect(s().selection.ranges).toEqual([{ fr: 3, fc: 3, tr: 3, tc: 3 }])
  })
})

describe('store: автосумма Σ (novagrid-020)', () => {
  it('Σ: следующий выбор диапазона пишет =SUM в ячейку-приёмник', () => {
    s().clickCell(6, 2) // стоим на свободной ячейке C7
    s().startSumPick()
    expect(s().sumPick).toEqual({ row: 6, col: 2 })
    s().clickCell(1, 2)
    s().dragTo(3, 2) // C2:C4
    s().applySumPick()
    expect(getCell(s().sheet, 6, 2)).toBe('=SUM(C2:C4)')
    expect(s().sumPick).toBeNull()
    expect(s().selection.active).toEqual({ row: 6, col: 2 })
    // сумма посчитана движком: 10000 + 12500 + 8000
    expect(cellNumber(s().sheet, 6, 2)).toBe(30500)
  })

  it('несмежные области собираются через «;», undo откатывает вставку', () => {
    s().clickCell(9, 0)
    s().startSumPick()
    s().clickCell(1, 2) // первый клик заменил выделение на C2
    s().clickCell(3, 2, { ctrl: true }) // + C4 (несмежная область)
    s().applySumPick()
    expect(getCell(s().sheet, 9, 0)).toBe('=SUM(C2;C4)')
    expect(cellNumber(s().sheet, 9, 0)).toBe(18000)
    s().undo()
    expect(getCell(s().sheet, 9, 0)).toBe('')
  })

  it('Esc снимает режим Σ без записи', () => {
    s().clickCell(9, 2)
    s().startSumPick()
    s().escape()
    expect(s().sumPick).toBeNull()
    s().clickCell(1, 2)
    s().applySumPick() // уже выключен — ничего не пишет
    expect(getCell(s().sheet, 9, 2)).toBe('')
  })
})
