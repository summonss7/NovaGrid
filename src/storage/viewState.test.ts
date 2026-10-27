import { describe, expect, it } from 'vitest'
import { planRestore } from './viewState'

/*
 * План восстановления «где я был» (novagrid-037): чистая функция без Dexie —
 * лист ищется по имени, координаты клампятся к границам листа. Запись/чтение
 * IndexedDB покрываются e2e (files.spec.ts — переоткрытие книги).
 */

const TABS = [
  { name: 'Сотрудники', rows: 100, cols: 26 },
  { name: 'Справочник', rows: 50, cols: 10 },
]

describe('planRestore — куда вернуть курсор (novagrid-037)', () => {
  it('лист по имени и позиция как были', () => {
    expect(planRestore(TABS, { sheetName: 'Справочник', row: 17, col: 3 })).toEqual({
      tabIndex: 1,
      row: 17,
      col: 3,
    })
  })

  it('координаты клампятся к границам листа', () => {
    expect(planRestore(TABS, { sheetName: 'Справочник', row: 999, col: -5 })).toEqual({
      tabIndex: 1,
      row: 49,
      col: 0,
    })
  })

  it('лист переименован/удалён — null, остаёмся на A1', () => {
    expect(planRestore(TABS, { sheetName: 'Удалённый', row: 17, col: 3 })).toBeNull()
  })
})
