/*
 * Чтение и запись .ods — собственный разбор/генерация ODF вместо SheetJS
 * (novagrid-040/novagrid-050).
 *
 * Чтение (novagrid-040): SheetJS CE читал ODS только значениями — формулы
 * (table:formula) терялись ещё на импорте (карточка novagrid-040: книга
 * sales.ods лишилась 108 тысяч формул), а межлистовые ссылки [$Лист.A1]
 * молча выпадали вместе со значениями ячеек. Здесь читаются значения, формулы
 * (результат → formulaCache, страховка «∛»), а с novagrid-050 — ещё стили
 * ячеек, ширины колонок и закрепление областей.
 *
 * Запись (novagrid-050): свой writer в пределах поддержки формата — значения
 * (типизированные), формулы в ODF-синтаксисе, стили (начертания, шрифт/
 * размер, цвета, выравнивание, перенос, границы, форматы чисел), объединения,
 * ширины колонок и закрепление (settings.xml, понимает LibreOffice; Excel
 * закрепление из .ods не читает — ограничение описано в справке F1).
 *
 * Даты читаются из office:date-value как записаны («наивно», без таймзоны) —
 * прежний путь через Date уезжал на смещение локали в датах со временем.
 * Формулы ODF ([.A1], SUM([.A1:.B2]), «$» у абсолютных адресов) переводятся
 * в A1-синтаксис и обратно; межлистовые ссылки становятся «Лист!A1» — наш
 * движок их пока не вычисляет (показывается кэш «∛»), но текст корректен.
 *
 * Модуль без DOM: исполняется в IO-воркере и в юнит-тестах Node.
 */

import JSZip from 'jszip'
import type { MergeRect } from '../core/merges'
import {
  BASE_COL_W,
  COL_W_MAX,
  COL_W_MIN,
} from '../grid/geometry'
import {
  MIN_COLS,
  MIN_ROWS,
  cellKey,
  normalizeCellSize,
  parseNumber,
  type CellBorders,
  type CellFormat,
  type CellStyle,
  type SheetModel,
} from '../core/sheet'
import { sanitizeSheetName, uniqueTabName, type SheetWire } from '../core/workbook'
import { formulaResultForSave, isFormulaRaw } from '../formula/engine'

/* ── XML-утилиты ─────────────────────────────────────────────────────── */

/** Сущности XML («&amp;», «&#1071;») → символы. */
function xmlDecode(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (whole, name: string) => {
    switch (name) {
      case 'amp':
        return '&'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      default: {
        const hex = name.startsWith('#x') || name.startsWith('#X')
        const code = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
    }
  })
}

interface Attributes {
  [name: string]: string
}

/** Атрибуты открывающего тега: name="value" | name='value' → словарь. */
function parseAttrs(s: string): Attributes {
  const out: Attributes = {}
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out[m[1]] = xmlDecode(m[2] ?? m[3] ?? '')
  return out
}

/** Текст/атрибут → XML: сущности и вырез control-символов (кроме \t\n\r). */
export function xmlEncode(s: string): string {
  return s
    // \P{C} — «не control» (Unicode-категория), литеральные коды в регэкспе
    // линтер запрещает; астральные символы (эмодзи) проходят
    .replace(/[^\t\n\r\P{C}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/* ── значения ячеек ──────────────────────────────────────────────────── */

/** office:date-value → ISO «как отображается»: дата, при ненулевом времени — «дата чч:мм». */
function dateValueToIso(v: string): string {
  const date = v.slice(0, 10)
  if (v.length <= 10) return date
  const time = v.slice(11, 16)
  return time === '00:00' ? date : `${date} ${time}`
}

/** office:time-value («PT13H19M») → «чч:мм». */
function timeValueToHm(v: string): string {
  const m = /^-?PT(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?$/.exec(v.trim())
  if (!m) return v
  const h = Number(m[1] ?? 0)
  const min = Number(m[2] ?? 0)
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** Число из office:value → короткая строка без артефактов («8.50» → «8.5»). */
function numberToString(v: string): string {
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : v
}

/** Текстовое содержимое ячейки: абзацы text:p → строки, text:s/tab/line-break. */
function cellText(chunk: string): string {
  const paragraphs: string[] = []
  const pRe = /<text:p(?:\s[^>]*)?>([\s\S]*?)<\/text:p>|<text:p(?:\s[^>]*)?\/>/g
  let m: RegExpExecArray | null
  while ((m = pRe.exec(chunk))) {
    const inner = m[1] ?? ''
    const s = inner
      .replace(/<text:tab(?:\s[^>]*)?\/?>/g, '\t')
      .replace(/<text:line-break(?:\s[^>]*)?\/?>/g, '\n')
      .replace(/<text:s(?:\s[^>]*)?\/>/g, (tag) => {
        const c = /text:c="(\d+)"/.exec(tag)
        return ' '.repeat(Math.min(Number(c?.[1] ?? 1), 4096))
      })
      .replace(/<[^>]*>/g, '')
    paragraphs.push(xmlDecode(s))
  }
  return paragraphs.join('\n')
}

/* ── формулы ODF → A1 ────────────────────────────────────────────────── */

/** Нужно ли брать имя листа в кавычки: буквы/цифры/«_» и не начинается с цифры. */
function sheetRefName(sheet: string): string {
  // уже кавыченное ODF-имя — экранирование «''» совпадает с Excel
  if (/^'.*'$/.test(sheet)) return sheet
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(sheet) ? sheet : `'${sheet.replaceAll("'", "''")}'`
}

/** Половина ссылки ODF («Лист.$A$1» | «.B2») → «Лист!$A$1» | «B2»; null — не ссылка. */
function odfEndpoint(sheet: string, ref: string): string | null {
  if (!/^\$?[A-Za-z]{1,3}\$?\d{1,7}$/.test(ref)) return null
  return sheet === '' ? ref : `${sheetRefName(sheet)}!${ref}`
}

/**
 * Формула ODF («of:=[.A1]*[.B2]», «SUM([.A1:.A9])») → текст A1 без «=».
 * Непонятные ссылки остаются как есть — формула станет «чужой» (∛ кэш),
 * но текст не теряется и сохраняется в файл дословно.
 */
export function odfFormulaToA1(formula: string): string {
  let body = formula.trim()
  for (const prefix of ['of:=', 'oooc:=', 'msoxl:=', 'of:', 'oooc:']) {
    if (body.startsWith(prefix)) {
      body = body.slice(prefix.length)
      break
    }
  }
  if (body.startsWith('=')) body = body.slice(1)
  // [.A1] [.A1:.B2] [$Лист.A1] [$Лист.A1:.B2] [.'Имя с пробелом'.A1] — «$»
  // перед листом и «.» перед именем — маркеры абсолютного/относительного листа
  return body.replace(
    /\[\$?\.?([^[\]:.]*)\.([^[\]:.]+)(?::\$?\.?([^[\]:.]*)\.([^[\]:.]+))?\]/g,
    (whole, sheet1: string, ref1: string, sheet2: string, ref2: string) => {
      const ep1 = odfEndpoint(sheet1, ref1)
      if (!ep1) return whole
      if (ref2 === undefined) return ep1
      // колоночный диапазон [.A1:.A1048576] → «A:A»: так пишет наш writer
      // из «A:A», и LibreOffice пишет так же — круг не меняет текст формулы
      const colRange = /^([A-Za-z]{1,3})1$/.exec(ref1)
      if (sheet1 === '' && sheet2 === '' && colRange && ref2 === `${colRange[1]}1048576`)
        return `${colRange[1]}:${colRange[1]}`
      const ep2 = odfEndpoint(sheet2, ref2)
      return ep2 ? `${ep1}:${ep2}` : whole
    },
  )
}

/* ── запись .ods (novagrid-050) ──────────────────────────────────────── */

const ODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet'

/** Имена пространств имён content.xml/settings.xml (минимум валидного ODF). */
const NS_ROOT =
  ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"' +
  ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"' +
  ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"' +
  ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"' +
  ' xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"' +
  ' xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"' +
  ' xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"'

/** Префикс имён наших автоматических стилей — не пересекается с LibreOffice. */
const CE_PREFIX = 'nv-ce-'
const CO_PREFIX = 'nv-co-'
const NS_PREFIX = 'nv-n-'

/** Формат числа → имя стиля данных ODF. */
function dataStyleName(fmt: CellFormat): string {
  return NS_PREFIX + (fmt === 'money' ? 'm' : fmt === 'percent' ? 'p' : 'n')
}

/** Элемент number:* для формата числа (десятичные 2, как отображает грид). */
function dataStyleXml(fmt: CellFormat): string {
  const num =
    '<number:number number:decimal-places="2" number:min-decimal-places="2"' +
    ' number:min-integer-digits="1"'
  if (fmt === 'percent')
    return `<number:percentage-style style:name="${dataStyleName(fmt)}">${num}/><number:text>%</number:text></number:percentage-style>`
  if (fmt === 'money')
    return (
      `<number:currency-style style:name="${dataStyleName(fmt)}">${num}/>` +
      '<number:text>\u00a0</number:text><number:currency-symbol>₽</number:currency-symbol>' +
      '</number:currency-style>'
    )
  return `<number:number-style style:name="${dataStyleName(fmt)}">${num} number:grouping="true"/></number:number-style>`
}

/** Базовые единицы грида (px) → длина ODF (pt, 2 знака). */
function pxToOdfLength(px: number): string {
  return `${(px * 0.75).toFixed(2)}pt`
}

/** Side границы → fo:border-… (тонкая чёрная, как рендерит грид). */
const ODF_THIN = '0.75pt solid #000000'

function cellBordersXml(borders: CellBorders): string {
  const out: string[] = []
  if (borders.top) out.push(`fo:border-top="${ODF_THIN}"`)
  if (borders.right) out.push(`fo:border-right="${ODF_THIN}"`)
  if (borders.bottom) out.push(`fo:border-bottom="${ODF_THIN}"`)
  if (borders.left) out.push(`fo:border-left="${ODF_THIN}"`)
  return out.join(' ')
}

/** Стиль ячейки модели → элемент style:style семейства table-cell. */
function cellStyleXml(name: string, style: CellStyle): string {
  const parts: string[] = []
  const cellProps = [
    ...(style.bg ? [`fo:background-color="#${style.bg}"`] : []),
    ...(style.wrap ? ['style:wrap-option="wrap"'] : []),
    ...(style.borders ? [cellBordersXml(style.borders)] : []),
  ]
    .filter((p) => p !== '')
    .join(' ')
  if (cellProps) parts.push(`<style:table-cell-properties ${cellProps}/>`)
  if (style.align)
    parts.push(
      `<style:paragraph-properties fo:text-align="${style.align === 'left' ? 'start' : style.align === 'right' ? 'end' : 'center'}"/>`,
    )
  const textProps = [
    ...(style.bold ? ['fo:font-weight="bold"'] : []),
    ...(style.italic ? ['fo:font-style="italic"'] : []),
    ...(style.underline
      ? [
          'style:text-underline-style="solid"',
          'style:text-underline-width="auto"',
          'style:text-underline-color="font-color"',
        ]
      : []),
    ...(style.size !== undefined ? [`fo:font-size="${style.size}pt"`] : []),
    ...(style.fg ? [`fo:color="#${style.fg}"`] : []),
    ...(style.font === 'display' ? ['style:font-name="Montserrat"'] : []),
  ].join(' ')
  if (textProps) parts.push(`<style:text-properties ${textProps}/>`)
  return (
    `<style:style style:name="${name}" style:family="table-cell"` +
    ` style:parent-style-name="Default"` +
    (style.fmt ? ` style:data-style-name="${dataStyleName(style.fmt)}"` : '') +
    `>${parts.join('')}</style:style>`
  )
}

/** Текст ячейки → тело text:p (абзацы по «\n», таб — text:tab). */
function odfTextBody(raw: string): string {
  return raw
    .split('\n')
    .map((line) => `<text:p>${xmlEncode(line).replace(/\t/g, '<text:tab/>') || ''}</text:p>`)
    .join('')
}

/** Имя листа внутри ODF-ссылки: словарное — как есть, иначе в кавычках. */
function odfSheetRef(sheet: string): string {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(sheet)
    ? sheet
    : `'${sheet.replaceAll("'", "''")}'`
}

const ODF_MAX_ROW_REF = 1_048_576

/** ODF-ссылка одной точки: [$]COL[$]ROW → .$A$1 / .A1. */
function odfRefPart(colAbs: string, col: string, rowAbs: string, row: string): string {
  return `.${colAbs}${col}${rowAbs}${row}`
}

/**
 * Формула A1 («SUM(A1:B2)», «Лист!A1», «A:A») → тело ODF («SUM([.A1:.B2])»,
 * «[$'Лист'.A1]», «[.A1:.A1048576]») без префикса «of:=». Строки «…» не
 * трогаются; не-ссылки остаются как есть. Обратная сторона пары —
 * odfFormulaToA1: round-trip своей книги не меняет текст.
 */
export function a1FormulaToOdf(body: string): string {
  // нарезка на строковые литералы «…» (в них «""» — кавычка) и остальное
  const pieces: { text: string; literal: boolean }[] = []
  let buf = ''
  let inStr = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '"') {
      if (inStr && body[i + 1] === '"') {
        buf += '""'
        i++
        continue
      }
      pieces.push({ text: buf, literal: inStr })
      pieces.push({ text: '"', literal: false })
      buf = ''
      inStr = !inStr
      continue
    }
    buf += ch
  }
  pieces.push({ text: buf, literal: inStr })
  return pieces
    .map((p) =>
      p.literal
        ? p.text
        : p.text
            // ссылка (с листом или без): [$]COL[$]ROW[:[$]COL[$]ROW];
            // словарное имя листа — только буквы/цифры/«_» (иначе «+Звонки!»
            // впитало бы оператор в имя)
            .replace(
              /(?:'((?:[^']|'')+)'!|([\p{L}\p{N}_]+)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?::(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7}))?(?![A-Za-z0-9_(])/gu,
              (
                _whole: string,
                qSheet: string | undefined,
                uSheet: string | undefined,
                c1a: string,
                col1: string,
                r1a: string,
                row1: string,
                c2a?: string,
                col2?: string,
                r2a?: string,
                row2?: string,
              ) => {
                const ref1 = odfRefPart(c1a, col1, r1a, row1)
                const ref2 =
                  row2 !== undefined && col2 !== undefined
                    ? odfRefPart(c2a ?? '', col2, r2a ?? '', row2)
                    : undefined
                const local = ref2 === undefined ? ref1 : `${ref1}:${ref2}`
                if (qSheet === undefined && uSheet === undefined) return `[${local}]`
                const sheet =
                  qSheet !== undefined ? qSheet.replaceAll("''", "'") : (uSheet ?? '')
                return `[$${odfSheetRef(sheet)}${local}]`
              },
            )
            // колонка целиком A:A → [.A1:.A1048576] (после ссылок — не задело)
            .replace(
              /(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_(])/g,
              (_whole: string, c1a: string, col1: string, c2a: string, col2: string) =>
                `[${odfRefPart(c1a, col1, '', '1')}:${odfRefPart(c2a, col2, '', String(ODF_MAX_ROW_REF))}]`,
            ),
    )
    .join('')
}

/** Карта листа для записи: покрытие объединений, габариты стилей/контента. */
interface SheetPlan {
  /** master-ячейки объединений: ключ → spans */
  masters: Map<string, { rows: number; cols: number }>
  /** покрытые ячейки (не master) */
  covered: Set<string>
  extentRow: number
  extentCol: number
}

function planSheet(
  sheet: SheetModel,
  colWidths: ReadonlyMap<number, number> | undefined,
): SheetPlan {
  const masters = new Map<string, { rows: number; cols: number }>()
  const covered = new Set<string>()
  let extentRow = Math.max(sheet.maxRow, 0)
  let extentCol = Math.max(sheet.maxCol, 0)
  for (const key of sheet.styles.keys()) {
    const sep = key.indexOf(':')
    const r = Number(key.slice(0, sep))
    const c = Number(key.slice(sep + 1))
    if (r > extentRow) extentRow = r
    if (c > extentCol) extentCol = c
  }
  for (const m of sheet.merges ?? []) {
    masters.set(cellKey(m.r1, m.c1), { rows: m.r2 - m.r1 + 1, cols: m.c2 - m.c1 + 1 })
    for (let r = m.r1; r <= m.r2; r++)
      for (let c = m.c1; c <= m.c2; c++)
        if (r !== m.r1 || c !== m.c1) covered.add(cellKey(r, c))
    if (m.r2 > extentRow) extentRow = m.r2
    if (m.c2 > extentCol) extentCol = m.c2
  }
  for (const c of colWidths?.keys() ?? []) if (c > extentCol) extentCol = c
  return { masters, covered, extentRow, extentCol }
}

/**
 * Книга → буфер .ods (novagrid-050): минимальный валидный ODF-пакет
 * (mimetype первым без сжатия, manifest, styles, content, settings — при
 * закреплениях). Поддержка — в пределах формата, см. справку F1.
 */
export async function sheetsToOds(sheets: readonly SheetWire[]): Promise<ArrayBuffer> {
  // дедупликация стилей по сигнатуре: имя_ce → xml, сигнатура → имя
  const styleNames = new Map<string, string>() // sig → ceName
  const styleXmls = new Map<string, string>() // ceName → xml
  const fmtsUsed = new Set<CellFormat>()
  const widthNames = new Map<number, string>() // px → coName

  const styleNameOf = (style: CellStyle | undefined): string | undefined => {
    if (!style || Object.keys(style).length === 0) return undefined
    const sig = JSON.stringify(style)
    const known = styleNames.get(sig)
    if (known) return known
    const name = `${CE_PREFIX}${styleNames.size + 1}`
    styleNames.set(sig, name)
    styleXmls.set(name, cellStyleXml(name, style))
    if (style.fmt) fmtsUsed.add(style.fmt)
    return name
  }
  const widthNameOf = (px: number): string => {
    const known = widthNames.get(px)
    if (known) return known
    const name = `${CO_PREFIX}${widthNames.size + 1}`
    widthNames.set(px, name)
    return name
  }

  const used = new Set<string>()
  const sheetXmls: string[] = []
  const freezes: { name: string; rows: number; cols: number }[] = []
  for (const { name, sheet, colWidths, freeze } of sheets) {
    let shName = sanitizeSheetName(name) || `Лист ${used.size + 1}`
    if (used.has(shName)) shName = uniqueTabName([...used], shName)
    used.add(shName)

    const plan = planSheet(sheet, colWidths)
    // — колонки: прогоны одинаковой ширины (undefined — стандартная) ————
    const cols: string[] = []
    let c = 0
    while (c <= plan.extentCol) {
      const px = colWidths?.get(c)
      const styleAttr = px !== undefined ? ` table:style-name="${widthNameOf(px)}"` : ''
      let run = 1
      while (c + run <= plan.extentCol && colWidths?.get(c + run) === px) run++
      cols.push(
        `<table:table-column${styleAttr}${run > 1 ? ` table:number-columns-repeated="${run}"` : ''}/>`,
      )
      c += run
    }
    // — строки: пустые прогоны сжимаются number-rows-repeated ————————————
    const rowsXml: string[] = []
    let pendingEmpty = 0
    const flushEmpty = () => {
      if (pendingEmpty > 0) {
        rowsXml.push(
          `<table:table-row${pendingEmpty > 1 ? ` table:number-rows-repeated="${pendingEmpty}"` : ''}>` +
            '<table:table-cell/></table:table-row>',
        )
        pendingEmpty = 0
      }
    }
    for (let r = 0; r <= plan.extentRow; r++) {
      const cellsXml: string[] = []
      let emptyRun = 0
      let rowIsEmpty = true
      const flushCells = () => {
        if (emptyRun > 0)
          cellsXml.push(
            `<table:table-cell${emptyRun > 1 ? ` table:number-columns-repeated="${emptyRun}"` : ''}/>`,
          )
        emptyRun = 0
      }
      for (let cc = 0; cc <= plan.extentCol; cc++) {
        const key = cellKey(r, cc)
        const raw = sheet.cells.get(key) ?? ''
        const styleName = styleNameOf(sheet.styles.get(key))
        const master = plan.masters.get(key)
        const isCovered = plan.covered.has(key)
        if (raw === '' && !styleName && !master && !isCovered) {
          emptyRun++
          continue
        }
        rowIsEmpty = false
        flushCells()
        const styleAttr = styleName ? ` table:style-name="${styleName}"` : ''
        if (isCovered) {
          cellsXml.push(`<table:covered-table-cell${styleAttr}/>`)
          continue
        }
        const spans =
          master && (master.rows > 1 || master.cols > 1)
            ? ` table:number-rows-spanned="${master.rows}" table:number-columns-spanned="${master.cols}"`
            : ''
        if (raw === '') {
          cellsXml.push(`<table:table-cell${styleAttr}${spans}/>`)
          continue
        }
        if (isFormulaRaw(raw)) {
          // формула: канонический текст → ODF, результат движка — office:value
          const { result, canonical } = formulaResultForSave(sheet, r, cc)
          const odf = a1FormulaToOdf(canonical ?? raw.slice(1))
          const formulaAttr = ` table:formula="of:=${xmlEncode(odf)}"`
          if (typeof result === 'number' && Number.isFinite(result))
            cellsXml.push(
              `<table:table-cell${styleAttr}${spans}${formulaAttr} office:value-type="float" office:value="${result}">${odfTextBody(String(result))}</table:table-cell>`,
            )
          else if (typeof result === 'boolean')
            cellsXml.push(
              `<table:table-cell${styleAttr}${spans}${formulaAttr} office:value-type="boolean" office:boolean-value="${result}">${odfTextBody(result ? 'ИСТИНА' : 'ЛОЖЬ')}</table:table-cell>`,
            )
          else
            cellsXml.push(
              `<table:table-cell${styleAttr}${spans}${formulaAttr} office:value-type="string">${odfTextBody(String(result))}</table:table-cell>`,
            )
          continue
        }
        const num = parseNumber(raw)
        if (num !== null)
          cellsXml.push(
            `<table:table-cell${styleAttr}${spans} office:value-type="float" office:value="${num}">${odfTextBody(raw)}</table:table-cell>`,
          )
        else if (raw === 'ИСТИНА' || raw === 'ЛОЖЬ')
          cellsXml.push(
            `<table:table-cell${styleAttr}${spans} office:value-type="boolean" office:boolean-value="${raw === 'ИСТИНА'}">${odfTextBody(raw)}</table:table-cell>`,
          )
        else
          cellsXml.push(
            `<table:table-cell${styleAttr}${spans} office:value-type="string">${odfTextBody(raw)}</table:table-cell>`,
          )
      }
      flushCells()
      if (rowIsEmpty) {
        pendingEmpty++
        continue
      }
      flushEmpty()
      rowsXml.push(`<table:table-row>${cellsXml.join('')}</table:table-row>`)
    }
    flushEmpty()
    sheetXmls.push(
      `<table:table table:name="${xmlEncode(shName)}">${cols.join('')}${rowsXml.join('')}</table:table>`,
    )
    if (freeze && (freeze.rows > 0 || freeze.cols > 0)) freezes.push({ name: shName, ...freeze })
  }

  const autoStyles = [
    ...[...fmtsUsed].map((f) => dataStyleXml(f)),
    ...[...widthNames.entries()].map(
      ([px, name]) =>
        `<style:style style:name="${name}" style:family="table-column">` +
        `<style:table-column-properties style:column-width="${pxToOdfLength(px)}"/></style:style>`,
    ),
    ...styleXmls.values(),
  ].join('')

  const contentXml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<office:document-content${NS_ROOT} office:version="1.2">` +
    '<office:font-face-decls>' +
    '<style:font-face style:name="Open Sans"/><style:font-face style:name="Montserrat"/>' +
    '</office:font-face-decls>' +
    `<office:automatic-styles>${autoStyles}</office:automatic-styles>` +
    '<office:body><office:spreadsheet>' +
    sheetXmls.join('') +
    '</office:spreadsheet></office:body></office:document-content>'

  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<office:document-styles${NS_ROOT} office:version="1.2">` +
    '<office:styles>' +
    '<style:default-style style:family="table-cell">' +
    '<style:paragraph-properties style:tab-stop-distance="0.5in"/>' +
    '<style:text-properties style:font-name="Open Sans"/>' +
    '</style:default-style>' +
    '<style:style style:name="Default" style:family="table-cell">' +
    '<style:text-properties style:font-name="Open Sans"/>' +
    '</style:style>' +
    '</office:styles>' +
    '<office:automatic-styles>' +
    '<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="8.27in" fo:page-height="11.69in" style:print-orientation="portrait"/></style:page-layout>' +
    '</office:automatic-styles>' +
    '<office:master-styles><style:master-page style:name="Default" style:page-layout-name="pm1"/></office:master-styles>' +
    '</office:document-styles>'

  // закрепление — стандартный блок LibreOffice в settings.xml (Excel из .ods
  // его не читает — ограничение формата, описано в справке F1)
  const settingsXml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<office:document-settings${NS_ROOT} xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" office:version="1.2">` +
    '<office:settings><config:config-item-set config:name="ooo:configuration-settings">' +
    '<config:config-item-set config:name="ooo:view-settings">' +
    '<config:config-item-set config:name="Views">' +
    '<config:config-item-set config:name="View0">' +
    '<config:config-item-set config:name="Tables">' +
    freezes
      .map(
        (f) =>
          `<config:config-item-set config:name="${xmlEncode(f.name)}">` +
          (f.cols > 0
            ? '<config:config-item config:name="HorizontalSplitMode" config:type="short">2</config:config-item>' +
              `<config:config-item config:name="HorizontalSplitPosition" config:type="int">${f.cols}</config:config-item>`
            : '') +
          (f.rows > 0
            ? '<config:config-item config:name="VerticalSplitMode" config:type="short">2</config:config-item>' +
              `<config:config-item config:name="VerticalSplitPosition" config:type="int">${f.rows}</config:config-item>`
            : '') +
          '<config:config-item config:name="ActiveSplitRange" config:type="short">2</config:config-item>' +
          '</config:config-item-set>',
      )
      .join('') +
    '</config:config-item-set>' +
    '</config:config-item-set>' +
    '</config:config-item-set>' +
    '</config:config-item-set>' +
    '</config:config-item-set>' +
    '</office:settings></office:document-settings>'

  const manifestXml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
    `<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${ODS_MIME}"/>` +
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
    (freezes.length > 0
      ? '<manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/>'
      : '') +
    '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>' +
    '</manifest:manifest>'

  const zip = new JSZip()
  zip.file('mimetype', ODS_MIME, { compression: 'STORE' })
  zip.file('META-INF/manifest.xml', manifestXml)
  if (freezes.length > 0) zip.file('settings.xml', settingsXml)
  zip.file('styles.xml', stylesXml)
  zip.file('content.xml', contentXml)
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}

/* ── разбор content.xml ──────────────────────────────────────────────── */

const MAX_ROW = 1_048_575
const MAX_COL = 16_383
/** Предел раскрытия повторов ячейки/строки (дальше файл считается битым). */
const MAX_REPEAT = 16_384

interface SheetAcc {
  name: string
  cells: Map<string, string>
  formulaCache: Map<string, string>
  /** стили ячеек (novagrid-050): table:style-name → стиль модели */
  styles: Map<string, CellStyle>
  /** объединённые ячейки (novagrid-047): master-ячейка с span-атрибутами */
  merges: MergeRect[]
  /** ширины колонок (novagrid-050): индекс → базовые единицы */
  colWidths: Map<number, number>
  maxRow: number
  maxCol: number
}

function valueOfCell(attrs: Attributes, text: () => string): string {
  switch (attrs['office:value-type']) {
    case 'float':
    case 'percentage':
    case 'currency':
      return attrs['office:value'] !== undefined ? numberToString(attrs['office:value']) : text()
    case 'date':
      return attrs['office:date-value'] !== undefined
        ? dateValueToIso(attrs['office:date-value'])
        : text()
    case 'time':
      return attrs['office:time-value'] !== undefined
        ? timeValueToHm(attrs['office:time-value'])
        : text()
    case 'boolean':
      return attrs['office:boolean-value'] === 'true' ? 'ИСТИНА' : 'ЛОЖЬ'
    case 'string':
      return attrs['office:string-value'] ?? text()
    default:
      return text()
  }
}

/* ── чтение стилей/ширин/закрепления (novagrid-050) ──────────────────── */

/** Цвет ODF «#RRGGBB» → RRGGBB; непохожее и совпадающее с фоном — undefined. */
function odsColor(v: string | undefined, def: string): string | undefined {
  if (!v || !/^#[0-9a-fA-F]{6}$/.test(v)) return undefined
  const hex = v.slice(1).toUpperCase()
  return hex === def ? undefined : hex
}

/** Значение границы ODF («0.75pt solid #000000» | «none») → есть/нет. */
function odsBorderSide(v: string | undefined): boolean {
  return !!v && !/^(none|hidden|\s*)$/i.test(v)
}

/** Длина ODF («2.54cm», «123.4pt», «1in») → базовые единицы грида (px). */
export function odsLengthToPx(v: string | undefined): number | undefined {
  if (!v) return undefined
  const m = /^([\d.]+)\s*(mm|cm|in|pt|pc)?\s*$/.exec(v.trim())
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n)) return undefined
  const unit = m[2] ?? 'cm'
  const inchPx =
    unit === 'pt' ? n / 72 : unit === 'pc' ? n / 6 : unit === 'mm' ? n / 25.4 : unit === 'in' ? n : n / 2.54
  const px = Math.round(inchPx * 96)
  return Math.min(COL_W_MAX, Math.max(COL_W_MIN, px))
}

/** Автостили content.xml: имена ячеек/колонок → стиль модели / ширина px. */
interface OdsAutoStyles {
  cells: Map<string, CellStyle>
  columns: Map<string, number>
}

function parseAutoStyles(xml: string): OdsAutoStyles {
  // стили чисел: имя → формат модели (наш round-trip + эвристика LibreOffice,
  // novagrid-051: процент/валюта бывают и обычным number-style с number:text)
  const dataFmts = new Map<string, CellFormat>()
  const dataRe =
    /<number:(number-style|currency-style|percentage-style)\b([^>]*)>([\s\S]*?)<\/number:\1>/g
  let dm: RegExpExecArray | null
  while ((dm = dataRe.exec(xml))) {
    const attrs = parseAttrs(dm[2])
    const name = attrs['style:name']
    if (!name) continue
    if (dm[1] === 'currency-style') dataFmts.set(name, 'money')
    else if (dm[1] === 'percentage-style') dataFmts.set(name, 'percent')
    else {
      const texts = dm[3].replace(/<[^>]+>/g, '')
      if (texts.includes('%')) dataFmts.set(name, 'percent')
      else if (/[₽$€]/.test(texts)) dataFmts.set(name, 'money')
      else if (/number:grouping="true"/.test(dm[3])) dataFmts.set(name, 'number')
    }
  }

  const out: OdsAutoStyles = { cells: new Map(), columns: new Map() }
  const styleRe = /<style:style\b([^>]*)>([\s\S]*?)<\/style:style>/g
  let sm: RegExpExecArray | null
  while ((sm = styleRe.exec(xml))) {
    const attrs = parseAttrs(sm[1])
    const inner = sm[2]
    const name = attrs['style:name']
    if (!name) continue
    if (attrs['style:family'] === 'table-column') {
      const props = /<style:table-column-properties\b([^>]*?)(?:\/>|>)/.exec(inner)?.[1] ?? ''
      const px = odsLengthToPx(parseAttrs(props)['style:column-width'])
      if (px !== undefined && px !== BASE_COL_W) out.columns.set(name, px)
      continue
    }
    if (attrs['style:family'] !== 'table-cell') continue
    const style: CellStyle = {}
    const cellProps =
      parseAttrs(/<style:table-cell-properties\b([^>]*?)(?:\/>|>)/.exec(inner)?.[1] ?? '')
    const bg = odsColor(cellProps['fo:background-color'], 'FFFFFF')
    if (bg) style.bg = bg
    if (cellProps['style:wrap-option'] === 'wrap') style.wrap = true
    const borders: CellBorders = {}
    if (odsBorderSide(cellProps['fo:border-top'])) borders.top = true
    if (odsBorderSide(cellProps['fo:border-right'])) borders.right = true
    if (odsBorderSide(cellProps['fo:border-bottom'])) borders.bottom = true
    if (odsBorderSide(cellProps['fo:border-left'])) borders.left = true
    if (cellProps['fo:border'] && odsBorderSide(cellProps['fo:border'])) {
      borders.top = borders.right = borders.bottom = borders.left = true
    }
    if (Object.keys(borders).length > 0) style.borders = borders
    const align = parseAttrs(
      /<style:paragraph-properties\b([^>]*?)(?:\/>|>)/.exec(inner)?.[1] ?? '',
    )['fo:text-align']
    if (align === 'center') style.align = 'center'
    else if (align === 'end' || align === 'right') style.align = 'right'
    else if (align === 'start' || align === 'left') style.align = 'left'
    const textProps = parseAttrs(
      /<style:text-properties\b([^>]*?)(?:\/>|>)/.exec(inner)?.[1] ?? '',
    )
    if (textProps['fo:font-weight'] === 'bold') style.bold = true
    if (textProps['fo:font-style'] === 'italic') style.italic = true
    if (textProps['style:text-underline-style'] === 'solid') style.underline = true
    const sizeMatch = /^([\d.]+)pt/.exec(textProps['fo:font-size'] ?? '')
    if (sizeMatch) {
      const pt = normalizeCellSize(Number(sizeMatch[1]))
      if (pt !== undefined) style.size = pt
    }
    const fg = odsColor(textProps['fo:color'], '000000')
    if (fg) style.fg = fg
    if (textProps['style:font-name'] === 'Montserrat') style.font = 'display'
    const dataName = attrs['style:data-style-name']
    if (dataName) {
      const fmt = dataFmts.get(dataName)
      if (fmt) style.fmt = fmt
    }
    if (Object.keys(style).length > 0) out.cells.set(name, style)
  }
  return out
}

/**
 * Закрепление из settings.xml (novagrid-050): блок Tables → по листу
 * позиции сплитов (режим 2 = закрепление, как пишет LibreOffice).
 */
async function parseFreezes(zip: JSZip): Promise<Map<string, { rows: number; cols: number }>> {
  const out = new Map<string, { rows: number; cols: number }>()
  const entry = zip.file('settings.xml')
  if (!entry) return out
  const xml = await entry.async('string')
  const structural = new Set([
    'ooo:configuration-settings',
    'ooo:view-settings',
    'Views',
    'View0',
    'Tables',
  ])
  const tokenRe =
    /<config:config-item-set config:name="([^"]*)"[^>]*>|<config:config-item config:name="([^"]*)" config:type="(\w+)"[^>]*>([^<]*)<\/config:config-item>|<\/config:config-item-set>/g
  let table: string | null = null
  const cells = new Map<string, string>() // name → value текущего листа
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(xml))) {
    if (m[1] !== undefined) {
      const name = xmlDecode(m[1])
      if (!structural.has(name)) {
        table = name
        cells.clear()
      }
      continue
    }
    if (m[0].startsWith('</')) {
      if (table !== null && !structural.has(table)) {
        const hMode = Number(cells.get('HorizontalSplitMode') ?? 0)
        const vMode = Number(cells.get('VerticalSplitMode') ?? 0)
        const cols = hMode !== 0 ? Math.max(0, Number(cells.get('HorizontalSplitPosition') ?? 0)) : 0
        const rows = vMode !== 0 ? Math.max(0, Number(cells.get('VerticalSplitPosition') ?? 0)) : 0
        if (rows > 0 || cols > 0) out.set(table, { rows, cols })
        table = null
      }
      continue
    }
    if (table !== null && m[2]) cells.set(xmlDecode(m[2]), xmlDecode(m[4] ?? ''))
  }
  return out
}

/** content.xml → накопители листов (значения + формулы + стили + ширины). */
function parseContent(xml: string, auto: OdsAutoStyles): SheetAcc[] {
  const sheets: SheetAcc[] = []
  let acc: SheetAcc | null = null
  let row = 0
  let rowNow = 0
  let colNow = 0

  // только теги table:*; «>» внутри атрибутов экранирован как &gt;, поэтому
  // граница «[^>]*>» надёжна; lookahead [\s>/] отличает table-cell от
  // table-cell-range и самозакрытые теги
  const tagRe =
    /<(\/?)table:(table|table-row|table-column|table-cell|covered-table-cell)(?=[\s>/])([^>]*)>/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(xml))) {
    const closing = m[1] === '/'
    const tag = m[2]
    if (tag === 'table') {
      if (closing) {
        acc = null
      } else {
        const attrs = parseAttrs(m[3])
        acc = {
          name: attrs['table:name'] ?? '',
          cells: new Map<string, string>(),
          formulaCache: new Map<string, string>(),
          styles: new Map<string, CellStyle>(),
          merges: [],
          colWidths: new Map<number, number>(),
          maxRow: -1,
          maxCol: -1,
        }
        sheets.push(acc)
        row = 0
        rowNow = 0
        colNow = 0
      }
      continue
    }
    if (!acc) continue
    if (tag === 'table-column') {
      // ширины колонок (novagrid-050): стиль семейства table-column + повторы
      if (!closing) {
        const attrs = parseAttrs(m[3])
        const repAttr = Number(attrs['table:number-columns-repeated'] ?? 1)
        const rep = Number.isFinite(repAttr) && repAttr > 0 ? Math.min(repAttr, MAX_REPEAT) : 1
        const px = attrs['table:style-name'] ? auto.columns.get(attrs['table:style-name']) : undefined
        if (px !== undefined) {
          for (let i = 0; i < rep && colNow + i <= 1023; i++) acc.colWidths.set(colNow + i, px)
        }
        colNow += rep
      }
      continue
    }
    if (tag === 'table-row') {
      if (!closing) {
        const rep = Number(parseAttrs(m[3])['table:number-rows-repeated'] ?? 1)
        rowNow = row
        row += Number.isFinite(rep) && rep > 0 ? Math.min(rep, MAX_REPEAT) : 1
        colNow = 0
      }
      continue
    }
    if (closing) continue
    // table-cell / covered-table-cell; covered — продолжение объединения сверху
    const attrs = parseAttrs(m[3])
    const covered = tag === 'covered-table-cell'
    const selfClosed = m[3].trimEnd().endsWith('/')
    const repAttr = Number(attrs['table:number-columns-repeated'] ?? 1)
    const rep = Number.isFinite(repAttr) && repAttr > 0 ? Math.min(repAttr, MAX_REPEAT) : 1

    // объединение ячеек (novagrid-047): master-ячейка несёт span-атрибуты;
    // covered-ячейки в следующих строках — её продолжение
    if (!covered) {
      const spanR = Number(attrs['table:number-rows-spanned'] ?? 1)
      const spanC = Number(attrs['table:number-columns-spanned'] ?? 1)
      const rows = Number.isFinite(spanR) ? Math.max(1, Math.min(spanR, MAX_ROW - rowNow + 1)) : 1
      const cols = Number.isFinite(spanC) ? Math.max(1, Math.min(spanC, MAX_COL - colNow + 1)) : 1
      if (rows > 1 || cols > 1)
        acc.merges.push({
          r1: rowNow,
          c1: colNow,
          r2: rowNow + rows - 1,
          c2: Math.min(colNow + cols - 1, MAX_COL),
        })
    }

    let value: string | undefined
    let formula: string | undefined
    // текст ячейки лежит между открывающим и закрывающим тегом; ячейки не
    // вкладываются, поэтому первый «</table:table-cell>» после открывающего — её
    const text = (): string => {
      if (selfClosed) return ''
      const close = xml.indexOf('</table:table-cell>', tagRe.lastIndex)
      if (close < 0) return ''
      return cellText(xml.slice(tagRe.lastIndex, close))
    }
    if (!covered) {
      if (attrs['table:formula'] !== undefined)
        formula = `=${odfFormulaToA1(attrs['table:formula'])}`
      const v = valueOfCell(attrs, text) // text() ленив: дергается только когда нужен
      if (v !== '') value = v
    }

    // стиль ячейки (novagrid-050): и у пустых, и у covered — границы/заливка
    // объединений живут в том числе на скрытых координатах
    const style = attrs['table:style-name'] ? auto.cells.get(attrs['table:style-name']) : undefined

    if (formula !== undefined || value !== undefined || style !== undefined) {
      if (rowNow <= MAX_ROW) {
        for (let i = 0; i < rep && colNow + i <= MAX_COL; i++) {
          const key = cellKey(rowNow, colNow + i)
          if (formula !== undefined) {
            acc.cells.set(key, formula)
            if (value !== undefined) acc.formulaCache.set(key, value)
          } else if (value !== undefined) {
            acc.cells.set(key, value)
          }
          if (style !== undefined) acc.styles.set(key, style)
        }
        const c = Math.min(colNow + rep - 1, MAX_COL)
        if (rowNow > acc.maxRow) acc.maxRow = rowNow
        if (c > acc.maxCol) acc.maxCol = c
      }
    }
    colNow += rep
  }
  return sheets
}

/* ── публичная точка входа ───────────────────────────────────────────── */

export async function odsToSheets(buffer: ArrayBuffer): Promise<SheetWire[]> {
  const zip = await JSZip.loadAsync(buffer)
  const entry = zip.file('content.xml') ?? zip.file(/(^|\/)content\.xml$/i)[0]
  if (!entry) throw new Error('Это не .ods: внутри нет content.xml')
  const xml = await entry.async('string')
  const auto = parseAutoStyles(xml)
  const freezes = await parseFreezes(zip)

  const out: SheetWire[] = []
  const used = new Set<string>()
  for (const acc of parseContent(xml, auto)) {
    let name = sanitizeSheetName(acc.name)
    if (!name) name = `Лист ${out.length + 1}`
    if (used.has(name)) name = uniqueTabName([...used], name)
    used.add(name)
    // закрепление ищем и под сырым, и под санитизированным именем (мы пишем
    // санитизированное; LibreOffice может хранить произвольное)
    const freeze =
      freezes.get(name) ?? freezes.get(sanitizeSheetName(acc.name)) ?? freezes.get(acc.name)
    out.push({
      name,
      sheet: {
        cells: acc.cells,
        styles: acc.styles,
        ...(acc.merges.length > 0 ? { merges: acc.merges } : {}),
        ...(acc.formulaCache.size > 0 ? { formulaCache: acc.formulaCache } : {}),
        rows: Math.max(MIN_ROWS, acc.maxRow + 1),
        cols: Math.max(MIN_COLS, acc.maxCol + 1),
        maxRow: acc.maxRow,
        maxCol: acc.maxCol,
      } satisfies SheetModel,
      ...(acc.colWidths.size > 0 ? { colWidths: acc.colWidths } : {}),
      ...(freeze ? { freeze } : {}),
    })
  }
  return out
}
