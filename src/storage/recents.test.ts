import { describe, expect, it } from 'vitest'
import type { SessionRow } from './db'
import { mergeRecents, type OpeningRow } from './recents'

/*
 * Слияние «Недавних» (novagrid-022): открытые файлы и автосохранённые
 * сессии — один список, свежие сверху, дедуп по имени файла.
 * novagrid-026: сессии без имени («Несохранённая книга») в список
 * не попадают — только файлы, которые реально открывали.
 */

function opening(id: number, fileName: string, openedAt: number, extra: Partial<OpeningRow> = {}) {
  return { id, key: `key-${id}`, fileName, openedAt, ...extra } satisfies OpeningRow
}

function session(id: number, fileName: string | null, savedAt: number): SessionRow {
  return { id, fileName, savedAt, cells: 42, sheets: [] }
}

describe('mergeRecents', () => {
  it('свежая запись сверху, независимо от типа', () => {
    const merged = mergeRecents(
      [opening(1, 'отчёт.xlsx', 200)],
      [session(2, 'старое.xlsx', 100)],
    )
    expect(merged.map((m) => m.kind)).toEqual(['open', 'session'])
  })

  it('одно имя — остаётся более свежая запись (сессия с правками выживает)', () => {
    const merged = mergeRecents(
      [opening(1, 'demo.xlsx', 100)],
      [session(2, 'demo.xlsx', 300), session(3, 'demo.xlsx', 200)],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ kind: 'session', session: { id: 2 } })
  })

  it('одно имя — открытие новее сессии, показывается открытие', () => {
    const merged = mergeRecents(
      [opening(1, 'demo.xlsx', 300)],
      [session(2, 'demo.xlsx', 100)],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ kind: 'open', opening: { id: 1 } })
  })

  it('дедуп по имени без учёта регистра (как Windows)', () => {
    const merged = mergeRecents(
      [opening(1, 'Отчёт.XLSX', 300)],
      [session(2, 'отчёт.xlsx', 100)],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].kind).toBe('open')
  })

  it('несохранённые книги (без имени) не попадают в «Недавние» (novagrid-026)', () => {
    const merged = mergeRecents(
      [opening(1, 'книга.xlsx', 100)],
      [session(2, null, 50), session(3, null, 10)],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ kind: 'open', opening: { id: 1 } })
  })

  it('лимит: максимум N записей после дедупа', () => {
    const merged = mergeRecents(
      [opening(1, 'a.csv', 50), opening(2, 'b.csv', 40)],
      [session(3, 'c.csv', 30), session(4, 'd.csv', 20), session(5, 'e.csv', 10)],
      4,
    )
    expect(merged.map((m) => (m.kind === 'open' ? m.opening.fileName : m.session.fileName))).toEqual(
      ['a.csv', 'b.csv', 'c.csv', 'd.csv'],
    )
  })
})
