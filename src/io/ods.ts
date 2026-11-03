/*
 * Чтение .ods (novagrid-040): собственный разбор content.xml вместо SheetJS.
 *
 * Причина: SheetJS CE читал ODS только значениями — формулы (table:formula)
 * терялись ещё на импорте (карточка novagrid-040: книга sales.ods лишилась
 * 108 тысяч формул при сохранении в .xlsx), а межлистовые ссылки [$Лист.A1]
 * молча выпадали вместе со значениями ячеек. Здесь читаются и значения, и
 * формулы: формула → текст «=…» в модели (строка формул, пересчёт движком),
 * результат из файла → formulaCache (страховка «∛» для того, что движок
 * не считает).
 *
 * Даты читаются из office:date-value как записаны («наивно», без таймзоны) —
 * прежний путь через Date уезжал на смещение локали в датах со временем.
 * Формулы ODF ([.A1], SUM([.A1:.B2]), «$» у абсолютных адресов) переводятся
 * в A1-синтаксис; межлистовые ссылки становятся «Лист!A1» — наш движок их
 * пока не вычисляет (показывается кэш «∛»), но текст корректен для Excel.
 *
 * Модуль без DOM: исполняется в IO-воркере и в юнит-тестах Node.
 */

import JSZip from 'jszip'
import type { MergeRect } from '../core/merges'
import { MIN_COLS, MIN_ROWS, cellKey, type SheetModel } from '../core/sheet'
import { sanitizeSheetName, uniqueTabName } from '../core/workbook'
import type { SheetWire } from './excel'

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
      const ep2 = odfEndpoint(sheet2, ref2)
      return ep2 ? `${ep1}:${ep2}` : whole
    },
  )
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
  /** объединённые ячейки (novagrid-047): master-ячейка с span-атрибутами */
  merges: MergeRect[]
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

/** content.xml → накопители листов (значения + формулы + кэш результатов). */
function parseContent(xml: string): SheetAcc[] {
  const sheets: SheetAcc[] = []
  let acc: SheetAcc | null = null
  let row = 0
  let rowNow = 0
  let colNow = 0

  // только теги table:*; «>» внутри атрибутов экранирован как &gt;, поэтому
  // граница «[^>]*>» надёжна; lookahead [\s>/] отличает table-cell от
  // table-cell-range и самозакрытые теги
  const tagRe = /<(\/?)table:(table|table-row|table-cell|covered-table-cell)(?=[\s>/])([^>]*)>/g
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
          merges: [],
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

    if (formula !== undefined || value !== undefined) {
      if (rowNow <= MAX_ROW) {
        for (let i = 0; i < rep && colNow + i <= MAX_COL; i++) {
          const key = cellKey(rowNow, colNow + i)
          if (formula !== undefined) {
            acc.cells.set(key, formula)
            if (value !== undefined) acc.formulaCache.set(key, value)
          } else {
            acc.cells.set(key, value!)
          }
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

  const out: SheetWire[] = []
  const used = new Set<string>()
  for (const acc of parseContent(xml)) {
    let name = sanitizeSheetName(acc.name)
    if (!name) name = `Лист ${out.length + 1}`
    if (used.has(name)) name = uniqueTabName([...used], name)
    used.add(name)
    out.push({
      name,
      sheet: {
        cells: acc.cells,
        styles: new Map(),
        ...(acc.merges.length > 0 ? { merges: acc.merges } : {}),
        ...(acc.formulaCache.size > 0 ? { formulaCache: acc.formulaCache } : {}),
        rows: Math.max(MIN_ROWS, acc.maxRow + 1),
        cols: Math.max(MIN_COLS, acc.maxCol + 1),
        maxRow: acc.maxRow,
        maxCol: acc.maxCol,
      } satisfies SheetModel,
    })
  }
  return out
}
