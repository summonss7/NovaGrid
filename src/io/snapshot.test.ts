/*
 * Юнит-тесты капсулы .nvgridx (Этап 7.6, novagrid-019): круг
 * «книга → капсула → книга» с точностью до ячейки, стойкость к неверной
 * парольной фразе и битым байтам (заголовок = AAD, шифротекст, соль),
 * проверка магии/имени. WebCrypto доступен в Node ≥ 19 — окружение node.
 */

import { describe, expect, test } from 'vitest'
import type { CellStyle, SheetModel } from '../core/sheet'
import type { SheetTab } from '../core/workbook'
import {
  bookToSnapshot,
  decryptSnapshot,
  encryptSnapshot,
  isSnapshotBuffer,
  isSnapshotName,
  snapshotToBook,
  type SnapshotPayload,
} from './snapshot'

const PASS = 'фраза-секрет-123'

function sheetWith(cells: Record<string, string>, extra: Partial<SheetModel> = {}): SheetModel {
  const map = new Map(Object.entries(cells))
  let maxRow = -1
  let maxCol = -1
  for (const k of map.keys()) {
    const [r, c] = k.split(':').map(Number)
    maxRow = Math.max(maxRow, r)
    maxCol = Math.max(maxCol, c)
  }
  return {
    cells: map,
    styles: new Map<string, CellStyle>(),
    rows: 120,
    cols: 30,
    maxRow,
    maxCol,
    ...extra,
  }
}

function demoTabs(): SheetTab[] {
  return [
    {
      id: 't1',
      name: 'Сотрудники',
      sheet: sheetWith(
        { '0:0': 'Фамилия', '1:0': 'Иванов', '1:2': '10000', '2:2': '=SUM(C2:C2)' },
        {
          styles: new Map([['0:0', { bold: true, bg: 'd9e2f3' }]]),
          formulaCache: new Map([['2:2', '10000']]),
        },
      ),
    },
    {
      id: 't2',
      name: 'Справка',
      sheet: sheetWith({ '0:0': 'Отдел', '1:0': 'Продажи' }),
    },
  ]
}

describe('капсула .nvgridx: имя и магия', () => {
  test('isSnapshotName — расширение без учёта регистра', () => {
    expect(isSnapshotName('book.nvgridx')).toBe(true)
    expect(isSnapshotName('BOOK.NVGRIDX')).toBe(true)
    expect(isSnapshotName('book.xlsx')).toBe(false)
    expect(isSnapshotName('nvgridx')).toBe(false)
  })

  test('isSnapshotBuffer — только честная магия + полный заголовок', async () => {
    const buf = await encryptSnapshot(bookToSnapshot(demoTabs(), { fileName: 'b.xlsx', csvDelimiter: ';' }), PASS)
    expect(isSnapshotBuffer(buf)).toBe(true)
    expect(isSnapshotBuffer(new ArrayBuffer(8))).toBe(false)
    const xlsx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(isSnapshotBuffer(xlsx.buffer)).toBe(false)
  })
})

describe('капсула .nvgridx: шифрование', () => {
  test('круг книга → капсула → книга: ячейки, стили, кэш формул, габариты', async () => {
    const tabs = demoTabs()
    const payload = bookToSnapshot(tabs, { fileName: 'demo-book.xlsx', csvDelimiter: ';' })
    const capsule = await encryptSnapshot(payload, PASS)

    // капсула непрозрачна: JSON-книги внутри нет
    const asText = new TextDecoder().decode(capsule.slice(0, Math.min(capsule.byteLength, 2000)))
    expect(asText).not.toContain('Иванов')

    const opened = snapshotToBook(await decryptSnapshot(capsule, PASS))
    expect(opened.sheets.map((s) => s.name)).toEqual(['Сотрудники', 'Справка'])
    const a = opened.sheets[0].sheet
    expect(a.cells.get('1:0')).toBe('Иванов')
    expect(a.cells.get('2:2')).toBe('=SUM(C2:C2)')
    expect(a.styles.get('0:0')).toEqual({ bold: true, bg: 'd9e2f3' })
    expect(a.formulaCache?.get('2:2')).toBe('10000')
    expect(a.rows).toBe(120)
    expect(a.cols).toBe(30)
    expect(a.maxRow).toBe(2)
    expect(a.maxCol).toBe(2)
    expect(opened.sheets[1].sheet.cells.get('1:0')).toBe('Продажи')
  })

  test('метаданные книги и момент сохранения едут внутри', async () => {
    const payload: SnapshotPayload = bookToSnapshot(demoTabs(), {
      fileName: 'отчёт за октябрь.xlsx',
      csvDelimiter: ',',
    })
    const opened = await decryptSnapshot(await encryptSnapshot(payload, PASS), PASS)
    expect(opened.app).toBe('NovaGrid')
    expect(opened.format).toBe(1)
    expect(opened.book.fileName).toBe('отчёт за октябрь.xlsx')
    expect(opened.book.csvDelimiter).toBe(',')
    expect(Number.isNaN(Date.parse(opened.savedAt))).toBe(false)
  })

  test('неверная парольная фраза — отказ, а не мусор', async () => {
    const capsule = await encryptSnapshot(bookToSnapshot(demoTabs(), { fileName: null, csvDelimiter: ';' }), PASS)
    await expect(decryptSnapshot(capsule, 'другая фраза')).rejects.toThrow(
      'Неверная парольная фраза',
    )
  })

  test('битый шифротекст ломает тег GCM — отказ', async () => {
    const capsule = await encryptSnapshot(bookToSnapshot(demoTabs(), { fileName: null, csvDelimiter: ';' }), PASS)
    const bytes = new Uint8Array(capsule)
    bytes[bytes.length - 1] ^= 0xff
    await expect(decryptSnapshot(bytes.buffer, PASS)).rejects.toThrow('повреждён')
  })

  test('подделка заголовка (AAD) не принимается: магия, соль, IV', async () => {
    const capsule = await encryptSnapshot(bookToSnapshot(demoTabs(), { fileName: null, csvDelimiter: ';' }), PASS)
    for (const pos of [0, 10, 30]) {
      const bytes = new Uint8Array(capsule.slice(0))
      bytes[pos] ^= 0x01
      await expect(decryptSnapshot(bytes.buffer, PASS)).rejects.toThrow()
    }
  })

  test('два экспорта одной книги — разные соль и IV (нет переиспользования)', async () => {
    const payload = bookToSnapshot(demoTabs(), { fileName: null, csvDelimiter: ';' })
    const [x, y] = await Promise.all([encryptSnapshot(payload, PASS), encryptSnapshot(payload, PASS)])
    expect(x.byteLength).toBe(y.byteLength)
    const a = new Uint8Array(x)
    const b = new Uint8Array(y)
    expect(Array.from(a.slice(8, 24))).not.toEqual(Array.from(b.slice(8, 24)))
    expect(Array.from(a.slice(24, 36))).not.toEqual(Array.from(b.slice(24, 36)))
  })
})
