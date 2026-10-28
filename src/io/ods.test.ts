import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { cellKey } from '../core/sheet'
import { cellIsFrozen, cellText, recalcSheet } from '../formula/engine'
import { odfFormulaToA1, odsToSheets } from './ods'

/* Сборка минимального .ods в тесте: SheetJS не пишет формулы в ODS, поэтому
 * content.xml рукописный — как его пишет LibreOffice (повторы, кэш, текст). */
async function buildOds(content: string): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet', {
    compression: 'STORE',
  })
  zip.file(
    'META-INF/manifest.xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">' +
      '<manifest:file-entry manifest:full-path="/"/></manifest:manifest>',
  )
  zip.file('content.xml', content)
  const out = await zip.generateAsync({ type: 'arraybuffer' })
  return out
}

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:calcext="urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0"'

function wrap(body: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<office:document-content ${NS} office:version="1.3">` +
    '<office:body><office:spreadsheet>' +
    body +
    '</office:spreadsheet></office:body></office:document-content>'
  )
}

describe('ods: перевод формул ODF → A1', () => {
  it('ссылки, диапазоны, функции, разделители «;»', () => {
    expect(odfFormulaToA1('of:=[.L1551]*[.K1551]')).toBe('L1551*K1551')
    expect(odfFormulaToA1('of:=SUM([.X180:.X206])')).toBe('SUM(X180:X206)')
    expect(odfFormulaToA1('of:=-[.J26]')).toBe('-J26')
    expect(odfFormulaToA1('of:=[.K3]*27.5')).toBe('K3*27.5')
    expect(odfFormulaToA1('of:=ROUNDDOWN([.K2]-[.K2]/100*3;-1)')).toBe('ROUNDDOWN(K2-K2/100*3;-1)')
    expect(odfFormulaToA1('of:=[.$A$1]+[.$B2]')).toBe('$A$1+$B2')
    expect(odfFormulaToA1('oooc:=[.A1]+1')).toBe('A1+1')
  })

  it('межлистовые ссылки → «Лист!A1» (Excel-корректный текст)', () => {
    expect(odfFormulaToA1('of:=[$Звонки.L12633]*[.J12636]')).toBe('Звонки!L12633*J12636')
    expect(odfFormulaToA1('of:=SUM([$Perfect.N10448])')).toBe('SUM(Perfect!N10448)')
    expect(odfFormulaToA1('of:=SUM([$Other.X412:.X416])')).toBe('SUM(Other!X412:X416)')
    expect(odfFormulaToA1("of:=[.'Мой лист'.A1]+[.B2]")).toBe("'Мой лист'!A1+B2")
  })

  it('нечто незнакомое остаётся как есть (станет «чужой» формулой ∛)', () => {
    expect(odfFormulaToA1('of:=[.A1]*[некорректно]')).toBe('A1*[некорректно]')
    expect(odfFormulaToA1('of:=[.#REF!.A1]')).toBe("'#REF!'!A1")
  })
})

describe('ods: чтение значений и формул (novagrid-040)', () => {
  it('формулы читаются в модель, кэш — в formulaCache, движок пересчитывает', async () => {
    const content = wrap(
      '<table:table table:name="Продажи">' +
        '<table:table-row>' +
        '<table:table-cell office:value-type="float" office:value="10"><text:p>10</text:p></table:table-cell>' +
        '<table:table-cell office:value-type="float" office:value="25"><text:p>25</text:p></table:table-cell>' +
        '</table:table-row>' +
        '<table:table-row>' +
        '<table:table-cell table:formula="of:=[.A1]*[.B1]" office:value-type="float" office:value="250"><text:p>250</text:p></table:table-cell>' +
        '<table:table-cell table:formula="of:=SUM([.A1:.B1])" office:value-type="float" office:value="35"><text:p>35</text:p></table:table-cell>' +
        '<table:table-cell table:formula="of:=ROUNDDOWN([.B1]/3;0)" office:value-type="float" office:value="8"><text:p>8</text:p></table:table-cell>' +
        '</table:table-row>' +
        '</table:table>',
    )
    const sheets = await odsToSheets(await buildOds(content))
    const sheet = sheets[0].sheet
    expect(sheet.cells.get(cellKey(1, 0))).toBe('=A1*B1')
    expect(sheet.cells.get(cellKey(1, 1))).toBe('=SUM(A1:B1)')
    expect(sheet.cells.get(cellKey(1, 2))).toBe('=ROUNDDOWN(B1/3;0)')
    expect(sheet.formulaCache?.get(cellKey(1, 0))).toBe('250')
    recalcSheet(sheet)
    expect(cellText(sheet, 1, 0)).toBe('250')
    expect(cellText(sheet, 1, 1)).toBe('35')
    expect(cellText(sheet, 1, 2)).toBe('8')
    expect(cellIsFrozen(sheet, 1, 0)).toBe(false)
  })

  it('межлистовая формула: пересчёт невозможен → кэш «∛», текст не теряется', async () => {
    const content = wrap(
      '<table:table table:name="А">' +
        '<table:table-row><table:table-cell table:formula="of:=[$Б.C1]*2" office:value-type="float" office:value="84"><text:p>84</text:p></table:table-cell></table:table-row>' +
        '</table:table>' +
        '<table:table table:name="Б">' +
        '<table:table-row><table:table-cell office:value-type="float" office:value="42"><text:p>42</text:p></table:table-cell></table:table-row>' +
        '</table:table>',
    )
    const sheets = await odsToSheets(await buildOds(content))
    const sheet = sheets[0].sheet
    expect(sheet.cells.get(cellKey(0, 0))).toBe('=Б!C1*2')
    expect(sheet.formulaCache?.get(cellKey(0, 0))).toBe('84')
    recalcSheet(sheet)
    expect(cellText(sheet, 0, 0)).toBe('84')
    expect(cellIsFrozen(sheet, 0, 0)).toBe(true)
  })

  it('повторы строк/колонок и пустые строки не сдвигают координаты', async () => {
    const content = wrap(
      '<table:table table:name="Лист1">' +
        // строка 1: два числа, второе повторено на 2 колонки
        '<table:table-row>' +
        '<table:table-cell office:value-type="float" office:value="1"/>' +
        '<table:table-cell table:number-columns-repeated="2" office:value-type="float" office:value="7"/>' +
        '</table:table-row>' +
        // строки 2–4: пустые (повтором), строка 5: текст
        '<table:table-row table:number-rows-repeated="3"><table:table-cell table:number-columns-repeated="4"/></table:table-row>' +
        '<table:table-row><table:table-cell office:value-type="string"><text:p>после пустых</text:p></table:table-cell></table:table-row>' +
        '</table:table>',
    )
    const sheets = await odsToSheets(await buildOds(content))
    const sheet = sheets[0].sheet
    expect(sheet.cells.get(cellKey(0, 0))).toBe('1')
    expect(sheet.cells.get(cellKey(0, 1))).toBe('7')
    expect(sheet.cells.get(cellKey(0, 2))).toBe('7')
    expect(sheet.cells.get(cellKey(0, 3))).toBeUndefined()
    // пустые строки не съелись — текст остался на 5-й строке (0-based 4)
    expect(sheet.cells.get(cellKey(4, 0))).toBe('после пустых')
    expect(sheet.maxRow).toBe(4)
  })

  it('даты без таймзоны («наивные»), время, булевы, проценты, текст', async () => {
    const content = wrap(
      '<table:table table:name="Типы">' +
        '<table:table-row>' +
        '<table:table-cell office:value-type="date" office:date-value="2015-09-01"/>' +
        '<table:table-cell office:value-type="date" office:date-value="2013-07-01T13:19:00"/>' +
        '<table:table-cell office:value-type="time" office:time-value="PT13H19M"/>' +
        '<table:table-cell office:value-type="boolean" office:boolean-value="true"/>' +
        '<table:table-cell office:value-type="percentage" office:value="0.15"/>' +
        '<table:table-cell office:value-type="string"><text:p>строка</text:p></table:table-cell>' +
        '<table:table-cell office:value-type="string"><text:p>два</text:p><text:p>абзаца</text:p></table:table-cell>' +
        '<table:table-cell office:value-type="string"><text:p>a</text:p><text:p>b<text:s text:c="3"/>c</text:p></table:table-cell>' +
        '<table:table-cell office:value-type="currency" office:value="8.50" office:currency="UAH"/>' +
        '</table:table-row>' +
        '</table:table>',
    )
    const sheets = await odsToSheets(await buildOds(content))
    const sheet = sheets[0].sheet
    expect(sheet.cells.get(cellKey(0, 0))).toBe('2015-09-01')
    // прежний путь через Date уезжал на −3 часа; теперь время как записано
    expect(sheet.cells.get(cellKey(0, 1))).toBe('2013-07-01 13:19')
    expect(sheet.cells.get(cellKey(0, 2))).toBe('13:19')
    expect(sheet.cells.get(cellKey(0, 3))).toBe('ИСТИНА')
    expect(sheet.cells.get(cellKey(0, 4))).toBe('0.15')
    expect(sheet.cells.get(cellKey(0, 5))).toBe('строка')
    expect(sheet.cells.get(cellKey(0, 6))).toBe('два\nабзаца')
    expect(sheet.cells.get(cellKey(0, 7))).toBe('a\nb   c')
    expect(sheet.cells.get(cellKey(0, 8))).toBe('8.5')
  })

  it('объединённая ячейка: covered-table-cell не создаёт значений; имена чистятся', async () => {
    const content = wrap(
      '<table:table table:name="Л/б?1">' +
        '<table:table-row>' +
        '<table:table-cell table:number-columns-spanned="2" office:value-type="string"><text:p>шапка</text:p></table:table-cell>' +
        '<table:covered-table-cell/>' +
        '<table:table-cell office:value-type="float" office:value="5"/>' +
        '</table:table-row>' +
        '</table:table>' +
        '<table:table table:name="Л/б?1"/>',
    )
    const sheets = await odsToSheets(await buildOds(content))
    expect(sheets.map((s) => s.name)).toEqual(['Л б 1', 'Л б 1 (2)'])
    const sheet = sheets[0].sheet
    expect(sheet.cells.get(cellKey(0, 0))).toBe('шапка')
    expect(sheet.cells.get(cellKey(0, 1))).toBeUndefined()
    expect(sheet.cells.get(cellKey(0, 2))).toBe('5')
  })
})
