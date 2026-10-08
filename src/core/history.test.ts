import { describe, expect, it } from 'vitest'
import { History } from './history'

describe('history: delta-стек undo/redo', () => {
  it('запись → undo → redo возвращает изменения туда-обратно', () => {
    const h = new History()
    h.push({ label: 'edit', changes: [{ row: 0, col: 0, before: '', after: '10000' }] })

    const undone = h.undo()
    expect(undone?.changes[0].before).toBe('')
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(true)

    const redone = h.redo()
    expect(redone?.changes[0].after).toBe('10000')
    expect(h.canRedo).toBe(false)
    expect(h.canUndo).toBe(true)
  })

  it('новая правка после undo сбрасывает redo-ветку (как в Excel)', () => {
    const h = new History()
    h.push({ label: 'a', changes: [] })
    h.push({ label: 'b', changes: [] })
    h.undo()
    h.push({ label: 'c', changes: [] })
    expect(h.canRedo).toBe(false)
    expect(h.undo()?.label).toBe('c')
    expect(h.undo()?.label).toBe('a')
    expect(h.undo()).toBeNull()
  })

  it('стек ограничен лимитом', () => {
    const h = new History(3)
    for (let i = 0; i < 5; i++) h.push({ label: `e${i}`, changes: [] })
    expect(h.undo()?.label).toBe('e4')
    expect(h.undo()?.label).toBe('e3')
    expect(h.undo()?.label).toBe('e2')
    expect(h.undo()).toBeNull()
  })

  it('clear опустошает обе ветки', () => {
    const h = new History()
    h.push({ label: 'a', changes: [] })
    h.undo()
    h.clear()
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(false)
  })
})
