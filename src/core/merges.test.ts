import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyMerge,
  coveredKeys,
  isCoveredCell,
  mergeAt,
  mergeLosesData,
  resolveMergedMove,
  shiftMerges,
  unmergeAt,
} from './merges'
import { shiftSheetCols, shiftSheetRows } from './layout'
import { selectionText } from './copy'
import { getCell, withCell, type SheetModel } from './sheet'
import { gridStore } from './store'
import { normalize } from './selection'

const s = () => gridStore.getState()

beforeEach(() => {
  s().seedDemo()
})

/** Лист с ячейками «r:c» → значение и опциональными merges. */
function sheetOf(cells: Record<string, string>, merges?: SheetModel['merges']): SheetModel {
  let sheet: SheetModel = { cells: new Map(), styles: new Map(), rows: 20, cols: 10, maxRow: -1, maxCol: -1 }
  for (const [key, value] of Object.entries(cells)) {
    const [r, c] = key.split(':').map(Number)
    sheet = withCell(sheet, r, c, value)
  }
  return merges ? { ...sheet, merges } : sheet
}

describe('merges: модель (novagrid-047)', () => {
  it('mergeAt находит объединение, isCoveredCell отличает скрытую ячейку', () => {
    const sh = sheetOf({ '0:0': 'A' }, [{ r1: 0, c1: 0, r2: 1, c2: 1 }])
    expect(mergeAt(sh, 0, 0)).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 })
    expect(mergeAt(sh, 1, 1)).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 })
    expect(mergeAt(sh, 2, 2)).toBeNull()
    expect(isCoveredCell(sh, 0, 0)).toBe(false)
    expect(isCoveredCell(sh, 1, 0)).toBe(true)
    expect(isCoveredCell(sh, 2, 2)).toBe(false)
  })

  it('applyMerge оставляет значение левого верхнего, остальные чистит', () => {
    const sh = sheetOf({ '0:0': 'A', '0:1': 'B', '0:2': 'C' })
    const { sheet: next, changes } = applyMerge(sh, { fr: 0, fc: 0, tr: 0, tc: 2 })
    expect(getCell(next, 0, 0)).toBe('A')
    expect(getCell(next, 0, 1)).toBe('')
    expect(getCell(next, 0, 2)).toBe('')
    expect(next.merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 2 }])
    // правки для честного отката значений
    expect(changes).toEqual([
      { row: 0, col: 1, before: 'B', after: '' },
      { row: 0, col: 2, before: 'C', after: '' },
    ])
  })

  it('mergeLosesData замечает данные вне левого верхнего угла', () => {
    const n = (fr: number, fc: number, tr: number, tc: number) => normalize({ fr, fc, tr, tc })
    expect(mergeLosesData(sheetOf({ '0:0': 'A', '0:1': '' }), n(0, 0, 0, 1))).toBe(false)
    expect(mergeLosesData(sheetOf({ '0:0': 'A', '0:1': 'B' }), n(0, 0, 0, 1))).toBe(true)
    expect(mergeLosesData(sheetOf({ '1:0': 'X' }), n(0, 0, 1, 1))).toBe(true)
  })

  it('applyMerge поглощает пересекающиеся объединения (как Excel)', () => {
    const sh = sheetOf({}, [
      { r1: 0, c1: 0, r2: 1, c2: 1 },
      { r1: 4, c1: 4, r2: 4, c2: 5 },
    ])
    const { sheet: next } = applyMerge(sh, { fr: 0, fc: 0, tr: 4, tc: 4 })
    expect(next.merges).toEqual([{ r1: 0, c1: 0, r2: 4, c2: 4 }])
  })

  it('unmergeAt снимает объединение и не трогает значения', () => {
    const sh = sheetOf({ '0:0': 'A' }, [{ r1: 0, c1: 0, r2: 1, c2: 1 }])
    const next = unmergeAt(sh, 1, 1)
    expect(next).not.toBeNull()
    expect(next!.merges).toBeUndefined()
    expect(getCell(next!, 0, 0)).toBe('A')
    expect(unmergeAt(sh, 5, 5)).toBeNull()
  })

  it('coveredKeys перечисляет скрытые ячейки', () => {
    const sh = sheetOf({}, [{ r1: 0, c1: 0, r2: 1, c2: 1 }])
    expect([...coveredKeys(sh.merges)].sort()).toEqual(['0:1', '1:0', '1:1'])
  })
})

describe('merges: навигация с объединениями (как Excel)', () => {
  // A1:B2 объединено; активная A1
  const merged = () => sheetOf({ '0:0': 'A' }, [{ r1: 0, c1: 0, r2: 1, c2: 1 }])

  it('шаг внутрь объединения перепрыгивает его целиком', () => {
    expect(resolveMergedMove(merged(), 0, 1, 0, 1)).toEqual({ row: 0, col: 2 }) // цель B1 → C1
    expect(resolveMergedMove(merged(), 1, 0, 1, 0)).toEqual({ row: 2, col: 0 }) // цель A2 → A3
    expect(resolveMergedMove(merged(), 0, 1, 1, 0)).toEqual({ row: 2, col: 1 }) // цель B1 вниз → B3
  })

  it('заход в объединение сбоку — на левый верхний угол', () => {
    expect(resolveMergedMove(merged(), 0, 1, 0, -1)).toEqual({ row: 0, col: 0 }) // цель B1 (из C1 влево), у края → угол
    expect(resolveMergedMove(merged(), 1, 0, -1, 0)).toEqual({ row: 0, col: 0 }) // цель A2 (из A3 вверх), у края → угол
    expect(resolveMergedMove(merged(), 1, 1, 0, -1)).toEqual({ row: 0, col: 0 }) // изнутри влево → угол
  })

  it('край листа: курсор остаётся на объединении', () => {
    expect(resolveMergedMove(merged(), 0, 0, 0, -1)).toEqual({ row: 0, col: 0 })
    expect(resolveMergedMove(merged(), 0, 0, -1, 0)).toEqual({ row: 0, col: 0 })
  })
})

describe('merges: сдвиги вставки/удаления (novagrid-047)', () => {
  it('вставка строки выше — объединение едет, внутри — растёт', () => {
    const m = [{ r1: 2, c1: 1, r2: 4, c2: 2 }]
    expect(shiftMerges(m, 'row', 0, 1)).toEqual([{ r1: 3, c1: 1, r2: 5, c2: 2 }])
    expect(shiftMerges(m, 'row', 3, 2)).toEqual([{ r1: 2, c1: 1, r2: 6, c2: 2 }])
  })

  it('удаление: целиком удалённое пропадает, частично резаное сжимается', () => {
    expect(shiftMerges([{ r1: 3, c1: 0, r2: 4, c2: 2 }], 'row', 3, -2)).toBeUndefined()
    // строки 2–5, удаляются 3–4 → остаётся 2–3
    expect(shiftMerges([{ r1: 2, c1: 0, r2: 5, c2: 2 }], 'row', 3, -2)).toEqual([
      { r1: 2, c1: 0, r2: 3, c2: 2 },
    ])
    // строки 2–4, удаляются 3–4 → остаётся только 2
    expect(shiftMerges([{ r1: 2, c1: 0, r2: 4, c2: 2 }], 'row', 3, -2)).toEqual([
      { r1: 2, c1: 0, r2: 2, c2: 2 },
    ])
  })

  it('выродившееся в одну ячейку объединение снимается', () => {
    // колонки 1–2 удалены — от объединения B:C остаётся точка → снятие
    expect(shiftMerges([{ r1: 2, c1: 1, r2: 2, c2: 2 }], 'col', 1, -2)).toBeUndefined()
    // частично резаное остаётся: A:D минус B:C → A:A… нет, c1=0 остаётся слева
    expect(shiftMerges([{ r1: 2, c1: 0, r2: 2, c2: 3 }], 'col', 1, -2)).toEqual([
      { r1: 2, c1: 0, r2: 2, c2: 1 },
    ])
  })

  it('shiftSheetRows/shiftSheetCols сдвигают merges вместе с данными', () => {
    const sh = sheetOf({ '2:1': 'X', '2:2': 'Y' }, [{ r1: 2, c1: 1, r2: 3, c2: 2 }])
    const ins = shiftSheetRows(sh, 0, 1)
    expect(ins.merges).toEqual([{ r1: 3, c1: 1, r2: 4, c2: 2 }])
    expect(getCell(ins, 3, 1)).toBe('X')
    // удалена колонка B: Y и правый край объединения съехали влево и сжались
    const del = shiftSheetCols(sh, 1, -1)
    expect(del.merges).toEqual([{ r1: 2, c1: 1, r2: 3, c2: 1 }])
    expect(getCell(del, 2, 1)).toBe('Y')
  })
})

describe('store: объединение ячеек (novagrid-047)', () => {
  it('mergeSelection объединяет выделение, значение — в левом верхнем; Ctrl+Z возвращает всё', () => {
    s().clickCell(0, 0)
    s().dragTo(0, 1)
    s().beginEdit('Шапка')
    s().commitEdit('none')
    s().clickCell(0, 0)
    s().dragTo(1, 1)
    s().mergeSelection()
    const sh = s().sheet
    expect(sh.merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 1 }])
    expect(getCell(sh, 0, 0)).toBe('Шапка')
    expect(s().selection.active).toEqual({ row: 0, col: 0 })
    expect(s().selection.ranges).toEqual([{ fr: 0, fc: 0, tr: 1, tc: 1 }])
    // один Ctrl+Z: значения и объединение вернулись
    s().undo()
    expect(s().sheet.merges).toBeUndefined()
    expect(getCell(s().sheet, 0, 0)).toBe('Шапка')
    s().redo()
    expect(s().sheet.merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 1 }])
    expect(getCell(s().sheet, 0, 0)).toBe('Шапка')
  })

  it('unmergeSelection снимает объединения выделения с откатом', () => {
    s().clickCell(0, 0)
    s().dragTo(0, 1)
    s().mergeSelection()
    expect(s().sheet.merges).toHaveLength(1)
    s().unmergeSelection()
    expect(s().sheet.merges).toBeUndefined()
    s().undo()
    expect(s().sheet.merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 1 }])
  })

  it('клик и навигация не заходят в скрытые ячейки (Tab/стрелки перепрыгивают)', () => {
    s().clickCell(0, 0)
    s().dragTo(1, 1)
    s().mergeSelection()
    // клик по скрытой ячейке B2 выбирает угол A1
    s().clickCell(1, 1)
    expect(s().selection.active).toEqual({ row: 0, col: 0 })
    // Tab из A1 перепрыгивает объединение → C1
    s().moveActive(0, 1)
    expect(s().selection.active).toEqual({ row: 0, col: 2 })
    // влево из C1 — на угол A1
    s().moveActive(0, -1)
    expect(s().selection.active).toEqual({ row: 0, col: 0 })
    // вниз из A1 — под объединение
    s().moveActive(1, 0)
    expect(s().selection.active).toEqual({ row: 2, col: 0 })
  })

  it('commitEdit после правки объединённой ячейки уходит из неё (Enter — вниз за объединение)', () => {
    s().clickCell(0, 0)
    s().dragTo(1, 1)
    s().mergeSelection()
    s().beginEdit('X')
    s().commitEdit('down')
    expect(getCell(s().sheet, 0, 0)).toBe('X')
    expect(s().selection.active).toEqual({ row: 2, col: 0 })
  })

  it('вставка/удаление строк сдвигает объединения', () => {
    s().clickCell(0, 0)
    s().dragTo(1, 1)
    s().mergeSelection()
    s().insertRows(0, 1)
    expect(s().sheet.merges).toEqual([{ r1: 1, c1: 0, r2: 2, c2: 1 }])
    s().deleteRows(0, 1)
    expect(s().sheet.merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 1 }])
    // удаление строк объединения целиком снимает его
    s().deleteRows(0, 2)
    expect(s().sheet.merges).toBeUndefined()
  })

  it('копирование выделения не заходит в скрытые ячейки (пусты)', () => {
    s().clickCell(0, 0)
    s().beginEdit('Заголовок')
    s().commitEdit('none')
    s().clickCell(0, 0)
    s().dragTo(0, 2)
    s().mergeSelection()
    // TSV копии: скрытые ячейки пусты, значение — в левой верхней
    expect(selectionText(s().sheet, s().selection)).toBe('Заголовок\t\t')
  })
})
