/*
 * Даты-строки для арифметики формул (novagrid-038): ячейка-дата — это
 * текст «ГГГГ-ММ-ДД» (так пишут импорт и DATE/TODAY) или «ДД.ММ.ГГГГ»
 * (русская привычка). «дата + 1» / «дата − 1» сдвигают день по календарю,
 * «дата − дата» даёт дни между датами. Формат результата повторяет формат
 * операнда-даты, время «ЧЧ:ММ» (его пишет импорт) сохраняется.
 *
 * Чистый TS без DOM: разбор строгий (полное совпадение), день проверяется
 * по календарю — «2026-02-30» датой не считается.
 */

export interface DayParts {
  y: number
  m: number
  d: number
  /** «ЧЧ:ММ» или null (день без времени) */
  time: string | null
  /** true — «ДД.ММ.ГГГГ», false — ISO «ГГГГ-ММ-ДД» */
  ru: boolean
}

/** ISO «2026-10-27» / с временем «2026-10-27 10:30» (или через T). */
const ISO_DAY_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/
/** Русский формат «27.10.2026» / «27.10.2026 10:30». */
const RU_DAY_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/

const DAY_MS = 86_400_000

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** «ЧЧ:ММ» из групп разбора; null — времени нет; false — время неверное. */
function timeOf(h: string, mm: string): string | null | false {
  const hh = Number(h)
  const m = Number(mm)
  if (hh > 23 || m > 59) return false
  return `${pad2(hh)}:${pad2(m)}`
}

/** Разбор дня-строки; null — это не дата (или неверное время/день). */
export function parseDay(text: string): DayParts | null {
  const iso = ISO_DAY_RE.exec(text)
  const m = iso ?? RU_DAY_RE.exec(text)
  if (!m) return null
  const y = Number(iso ? m[1] : m[3])
  const mo = Number(m[2])
  const d = Number(iso ? m[3] : m[1])
  const time = m[4] !== undefined ? timeOf(m[4], m[5]!) : null
  if (time === false) return null
  if (y < 1900 || y > 9999) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
    return null
  return { y, m: mo, d, time, ru: !iso }
}

/** Дата в формате операнда (ISO или русский, время сохраняется). */
export function formatDay(p: DayParts): string {
  const day = p.ru ? `${pad2(p.d)}.${pad2(p.m)}.${p.y}` : `${p.y}-${pad2(p.m)}-${pad2(p.d)}`
  return p.time ? `${day} ${p.time}` : day
}

function utcOf(p: DayParts): number {
  const ms = Date.UTC(p.y, p.m - 1, p.d)
  return p.time
    ? ms + Number(p.time.slice(0, 2)) * 3_600_000 + Number(p.time.slice(3)) * 60_000
    : ms
}

/** «дата ± дни» по календарю (месяцы/годы переходятся честно); null — не дата. */
export function shiftDays(text: string, days: number): string | null {
  const p = parseDay(text)
  if (!p) return null
  const shifted = new Date(utcOf(p) + days * DAY_MS)
  // целые сдвиги время не трогают (00:00 не показываем), дробные —
  // честно меняют часы/минуты результата
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  return formatDay({
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    time: minutes === 0 ? null : `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`,
    ru: p.ru,
  })
}

/** «дата a − дата b» в днях (с временем — дробное); null — не даты. */
export function daysBetween(a: string, b: string): number | null {
  const pa = parseDay(a)
  const pb = parseDay(b)
  if (!pa || !pb) return null
  return (utcOf(pa) - utcOf(pb)) / DAY_MS
}
