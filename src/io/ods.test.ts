import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { cellKey, createSheet, withCell } from '../core/sheet'
import { cellIsFrozen, cellText, recalcSheet } from '../formula/engine'
import { a1FormulaToOdf, odfFormulaToA1, odsToSheets, sheetsToOds } from './ods'
import type { SheetWire } from '../core/workbook'

/* Сборка минимального .ods в тесте: SheetJS не пишет формулы в ODS, поэтому
 * content.xml рукописный — как его пишет LibreOffice (повторы, кэш, текст). */
async function buildOds(content: string, settings?: string): Promise<ArrayBuffer> {
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
  if (settings) zip.file('settings.xml', settings)
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

describe('ods: перевод формул A1 → ODF (novagrid-050, запись)', () => {
  it('ссылки, диапазоны, листы, абсолюты, колонки целиком', () => {
    expect(a1FormulaToOdf('SUM(A1:B2)')).toBe('SUM([.A1:.B2])')
    expect(a1FormulaToOdf('L1551*K1551')).toBe('[.L1551]*[.K1551]')
    expect(a1FormulaToOdf('$A$1+$B2')).toBe('[.$A$1]+[.$B2]')
    expect(a1FormulaToOdf('SUM(A:A)')).toBe('SUM([.A1:.A1048576])')
    expect(a1FormulaToOdf("SUM('Мой лист'!A1:B2)")).toBe("SUM([$'Мой лист'.A1:.B2])")
    expect(a1FormulaToOdf('Звонки!L1*2')).toBe('[$Звонки.L1]*2')
    expect(a1FormulaToOdf('IF(A1>1;"да";"A1 не трогается")')).toBe(
      'IF([.A1]>1;"да";"A1 не трогается")',
    )
  })

  it('round-trip текста формулы не меняет его: A1 → ODF → A1', () => {
    const src = ['SUM(A1:B2)', "'Мой лист'!A1+Звонки!L1*2", 'ROUNDDOWN(K2/3;0)', '$A$1+A:A']
    for (const f of src) expect(odfFormulaToA1('of:=' + a1FormulaToOdf(f))).toBe(f)
  })
})

describe('ods: запись и круг книга → файл → книга (novagrid-050)', () => {
  it('roundtrip: значения, все поля стиля, объединение, ширины, закрепление', async () => {
    let sheet = createSheet()
    sheet = withCell(sheet, 0, 0, 'Титул')
    sheet = withCell(sheet, 1, 0, '1200')
    sheet = withCell(sheet, 1, 1, 'переносимый\nтекст')
    sheet.styles.set(cellKey(0, 0), {
      bold: true,
      italic: true,
      underline: true,
      size: 14,
      fg: 'C00000',
      bg: 'E8F8EC',
      align: 'center',
      wrap: true,
      font: 'display',
    })
    sheet.styles.set(cellKey(1, 0), { fmt: 'money', align: 'right' })
    sheet.styles.set(cellKey(1, 1), { borders: { top: true, left: true } })
    sheet.merges = [{ r1: 0, c1: 0, r2: 0, c2: 1 }]

    const wire: SheetWire = {
      name: 'Отчёт',
      sheet,
      colWidths: new Map([
        [0, 150],
        [2, 40],
      ]),
      freeze: { rows: 1, cols: 1 },
    }
    const back = await odsToSheets(await sheetsToOds([wire]))

    expect(back.map((s) => s.name)).toEqual(['Отчёт'])
    const s = back[0].sheet
    expect(s.cells.get(cellKey(0, 0))).toBe('Титул')
    expect(s.cells.get(cellKey(1, 0))).toBe('1200')
    expect(s.cells.get(cellKey(1, 1))).toBe('переносимый\nтекст')
    expect(s.styles.get(cellKey(0, 0))).toEqual({
      bold: true,
      italic: true,
      underline: true,
      size: 14,
      fg: 'C00000',
      bg: 'E8F8EC',
      align: 'center',
      wrap: true,
      font: 'display',
    })
    expect(s.styles.get(cellKey(1, 0))).toEqual({ fmt: 'money', align: 'right' })
    expect(s.styles.get(cellKey(1, 1))).toEqual({ borders: { top: true, left: true } })
    expect(s.merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 1 }])
    expect(back[0].colWidths).toEqual(
      new Map([
        [0, 150],
        [2, 40],
      ]),
    )
    expect(back[0].freeze).toEqual({ rows: 1, cols: 1 })
  })

  it('roundtrip формулы: текст A1 сохраняется, значение движка едет office:value', async () => {
    let sheet = createSheet()
    sheet = withCell(sheet, 0, 0, '10')
    sheet = withCell(sheet, 0, 1, '25')
    sheet = withCell(sheet, 1, 0, '=SUM(A1:B1)')
    recalcSheet(sheet)

    const back = await odsToSheets(await sheetsToOds([{ name: 'L', sheet }]))
    const s = back[0].sheet
    expect(s.cells.get(cellKey(1, 0))).toBe('=SUM(A1:B1)')
    recalcSheet(s)
    expect(cellText(s, 1, 0)).toBe('35')
  })

  it('без закрепления settings.xml не пишется и файл открывается', async () => {
    let sheet = createSheet()
    sheet = withCell(sheet, 0, 0, 'x')
    const buffer = await sheetsToOds([{ name: 'L', sheet }])
    const zip = await JSZip.loadAsync(buffer)
    expect(zip.file('settings.xml')).toBeNull()
    const back = await odsToSheets(buffer)
    expect(back[0].freeze).toBeUndefined()
    expect(back[0].sheet.cells.get(cellKey(0, 0))).toBe('x')
  })
})

describe('ods: чтение чужого файла со стилями и закреплением (novagrid-050)', () => {
  it('автостили LibreOffice читаются: стили, ширины, объединение, закрепление', async () => {
    const auto =
      '<office:automatic-styles>' +
      '<number:currency-style style:name="N100"><number:number number:decimal-places="2"/></number:currency-style>' +
      '<style:style style:name="co1" style:family="table-column">' +
      '<style:table-column-properties style:column-width="112.5pt"/></style:style>' +
      '<style:style style:name="ce1" style:family="table-cell" style:data-style-name="N100">' +
      '<style:table-cell-properties fo:background-color="#e8f8ec" fo:border-top="0.75pt solid #000000" style:wrap-option="wrap"/>' +
      '<style:paragraph-properties fo:text-align="center"/>' +
      '<style:text-properties fo:font-weight="bold" fo:color="#c00000"/>' +
      '</style:style>' +
      '</office:automatic-styles>'
    const content =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      `<office:document-content ${NS} xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" office:version="1.3">` +
      auto +
      '<office:body><office:spreadsheet>' +
      '<table:table table:name="Продажи">' +
      '<table:table-column table:style-name="co1"/>' +
      '<table:table-row>' +
      '<table:table-cell table:style-name="ce1" table:number-columns-spanned="2" office:value-type="string"><text:p>шапка</text:p></table:table-cell>' +
      '<table:covered-table-cell/>' +
      '</table:table-row>' +
      '<table:table-row><table:table-cell table:style-name="ce1" office:value-type="float" office:value="1200"><text:p>1200</text:p></table:table-cell></table:table-row>' +
      '</table:table>' +
      '</office:spreadsheet></office:body></office:document-content>'
    const settings =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<office:document-settings xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0">' +
      '<office:settings><config:config-item-set config:name="ooo:configuration-settings">' +
      '<config:config-item-set config:name="ooo:view-settings">' +
      '<config:config-item-set config:name="Views">' +
      '<config:config-item-set config:name="View0">' +
      '<config:config-item-set config:name="Tables">' +
      '<config:config-item-set config:name="Продажи">' +
      '<config:config-item config:name="HorizontalSplitMode" config:type="short">2</config:config-item>' +
      '<config:config-item config:name="HorizontalSplitPosition" config:type="int">1</config:config-item>' +
      '<config:config-item config:name="VerticalSplitMode" config:type="short">2</config:config-item>' +
      '<config:config-item config:name="VerticalSplitPosition" config:type="int">1</config:config-item>' +
      '</config:config-item-set>' +
      '</config:config-item-set>' +
      '</config:config-item-set>' +
      '</config:config-item-set>' +
      '</config:config-item-set>' +
      '</office:settings></office:document-settings>'

    const sheets = await odsToSheets(await buildOds(content, settings))
    expect(sheets[0].freeze).toEqual({ rows: 1, cols: 1 })
    expect(sheets[0].colWidths).toEqual(new Map([[0, 150]])) // 112.5pt → 150px
    const sheet = sheets[0].sheet
    expect(sheet.styles.get(cellKey(0, 0))).toEqual({
      bold: true,
      fg: 'C00000',
      bg: 'E8F8EC',
      align: 'center',
      wrap: true,
      borders: { top: true },
      fmt: 'money',
    })
    expect(sheet.merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 1 }])
  })
})
