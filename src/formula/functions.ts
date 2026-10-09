/*
 * Библиотека функций формул (Этап 4.1, список Ф6 из CONCEPT): ~30 функций
 * математики, логики, текста, дат и поиска. Здесь же метаданные для
 * автодополнения и справочника «?» (Этап 4.4/4.5) — имя, сигнатура
 * с аргументами («[…]» — необязательный), описание, группа.
 *
 * Соглашения как в Excel: текст в диапазонах агрегатами игнорируется,
 * числа-строки в прямых аргументах приводятся, пустая ячейка — 0 в
 * арифметике. Ошибки — сообщения человеческим языком (FormulaError).
 */

import { criterionPredicate } from './criteria'
import { FormulaError, type CellValue } from './types'

export interface FnMeta {
  name: string
  /** имена аргументов; «[…]» — необязательный, «…» — сколько угодно */
  args: readonly string[]
  desc: string
  group: 'Математика' | 'Логика' | 'Текст' | 'Поиск' | 'Дата'
}

/** Значение диапазона: плоский массив по строкам + геометрия (VLOOKUP). */
export interface RangeArg {
  values: CellValue[]
  r1: number
  c1: number
  r2: number
  c2: number
}

export type Arg = CellValue | RangeArg

export interface FnCtx {
  /** значение любой ячейки листа (формулы уже вычислены) */
  cell(row: number, col: number): CellValue
  selfRow: number
  selfCol: number
}

export interface FnDef {
  meta: FnMeta
  minArgs: number
  maxArgs: number
  impl(args: readonly Arg[], ctx: FnCtx): CellValue
}

const err = (message: string): FormulaError => new FormulaError(message)

function isRange(a: Arg): a is RangeArg {
  return typeof a === 'object' && a !== null && 'values' in a
}

/** Приведение к числу: пусто→0, логическое→1/0, «1,5»/«1.5»→1.5. */
function toNum(v: CellValue): number | FormulaError {
  if (v instanceof FormulaError) return v
  if (v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = Number(v.trim().replace(',', '.'))
  if (v.trim() !== '' && Number.isFinite(n)) return n
  return err(`«${v}» — не число`)
}

function toText(v: CellValue): string {
  if (v instanceof FormulaError) return v.message
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'ИСТИНА' : 'ЛОЖЬ'
  if (typeof v === 'number') return String(v)
  return v
}

function toBool(v: CellValue): boolean | FormulaError {
  if (v instanceof FormulaError) return v
  if (v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const s = v.trim().toLowerCase()
  if (s === 'истина' || s === 'true') return true
  if (s === 'ложь' || s === 'false' || s === '') return false
  const n = Number(s.replace(',', '.'))
  if (Number.isFinite(n)) return n !== 0
  return err(`«${v}» — не условие (нужно число или ИСТИНА/ЛОЖЬ)`)
}

/**
 * Числа аргументов: прямые аргументы приводятся (ошибка, если не число),
 * ячейки диапазона-тексты пропускаются — как SUM в Excel.
 */
function collectNumbers(args: readonly Arg[]): number[] | FormulaError {
  const out: number[] = []
  for (const a of args) {
    if (isRange(a)) {
      for (const v of a.values) if (typeof v === 'number') out.push(v)
    } else {
      const n = toNum(a)
      if (n instanceof FormulaError) return n
      out.push(n)
    }
  }
  return out
}

function scalar(a: Arg, fname: string): CellValue {
  if (isRange(a)) return err(`${fname}: здесь нужна одна ячейка или число, а не диапазон`)
  return a
}

function needRange(a: Arg, fname: string): RangeArg | FormulaError {
  if (!isRange(a)) return err(`${fname}: этот аргумент должен быть диапазоном, например A2:A10`)
  return a
}

/** Плоский индекс ячейки диапазона. */
function at(range: RangeArg, row: number, col: number): CellValue {
  const w = range.c2 - range.c1 + 1
  return range.values[(row - range.r1) * w + (col - range.c1)] ?? null
}

/* ── реализации ─────────────────────────────────────────────────────── */

const defSum: FnDef = {
  meta: {
    name: 'SUM',
    args: ['число1', '[число2]', '…'],
    desc: 'Складывает числа: напрямую, из диапазона или из нескольких диапазонов.',
    group: 'Математика',
  },
  minArgs: 1,
  maxArgs: Infinity,
  impl: (args) => {
    const nums = collectNumbers(args)
    if (nums instanceof FormulaError) return err(`SUM: ${nums.message}`)
    return nums.reduce((acc, v) => acc + v, 0)
  },
}

const defSumif: FnDef = {
  meta: {
    name: 'SUMIF',
    args: ['диапазон', 'критерий', '[диапазон_суммирования]'],
    desc: 'Суммирует ячейки, удовлетворяющие условию: «Иванов», «>1000», «<>Москва».',
    group: 'Математика',
  },
  minArgs: 2,
  maxArgs: 3,
  impl: (args) => {
    const range = needRange(args[0], 'SUMIF')
    if (range instanceof FormulaError) return range
    const crit = scalar(args[1], 'SUMIF')
    if (crit instanceof FormulaError) return crit
    const sumRange =
      args.length > 2 ? needRange(args[2], 'SUMIF') : (range as RangeArg | FormulaError)
    if (sumRange instanceof FormulaError) return sumRange
    const matches = criterionPredicate(crit)
    let total = 0
    for (let i = 0; i < range.values.length; i++) {
      if (!matches(range.values[i])) continue
      const v = sumRange.values[i] ?? null
      if (typeof v === 'number') total += v
    }
    return total
  },
}

const defSumifs: FnDef = {
  meta: {
    name: 'SUMIFS',
    args: ['диапазон_суммирования', 'диапазон_критерия1', 'критерий1', '…'],
    desc: 'Суммирует ячейки, подходящие сразу нескольким условиям: =SUMIFS(C:C;A:A;"Иванов";C:C;10000).',
    group: 'Математика',
  },
  minArgs: 3,
  maxArgs: Infinity,
  impl: (args) => {
    if (args.length % 2 === 0)
      return err('SUMIFS: пары «диапазон; критерий» должны заканчиваться критерием')
    const sumRange = needRange(args[0], 'SUMIFS')
    if (sumRange instanceof FormulaError) return sumRange
    const pairs: { range: RangeArg; matches: (v: CellValue) => boolean }[] = []
    for (let i = 1; i < args.length; i += 2) {
      const range = needRange(args[i], 'SUMIFS')
      if (range instanceof FormulaError) return range
      const crit = scalar(args[i + 1], 'SUMIFS')
      if (crit instanceof FormulaError) return crit
      pairs.push({ range, matches: criterionPredicate(crit) })
    }
    let total = 0
    for (let i = 0; i < sumRange.values.length; i++) {
      if (pairs.every((p) => p.matches(p.range.values[i] ?? null))) {
        const v = sumRange.values[i]
        if (typeof v === 'number') total += v
      }
    }
    return total
  },
}

const defAverage: FnDef = {
  meta: {
    name: 'AVERAGE',
    args: ['число1', '[число2]', '…'],
    desc: 'Среднее арифметическое чисел (текст в диапазонах не считается).',
    group: 'Математика',
  },
  minArgs: 1,
  maxArgs: Infinity,
  impl: (args) => {
    const nums = collectNumbers(args)
    if (nums instanceof FormulaError) return err(`AVERAGE: ${nums.message}`)
    if (nums.length === 0) return err('AVERAGE: нет чисел для среднего')
    return nums.reduce((acc, v) => acc + v, 0) / nums.length
  },
}

const defAverageif: FnDef = {
  meta: {
    name: 'AVERAGEIF',
    args: ['диапазон', 'критерий', '[диапазон_среднего]'],
    desc: 'Среднее по ячейкам, удовлетворяющим условию.',
    group: 'Математика',
  },
  minArgs: 2,
  maxArgs: 3,
  impl: (args) => {
    const range = needRange(args[0], 'AVERAGEIF')
    if (range instanceof FormulaError) return range
    const crit = scalar(args[1], 'AVERAGEIF')
    if (crit instanceof FormulaError) return crit
    const avgRange =
      args.length > 2 ? needRange(args[2], 'AVERAGEIF') : (range as RangeArg | FormulaError)
    if (avgRange instanceof FormulaError) return avgRange
    const matches = criterionPredicate(crit)
    let total = 0
    let n = 0
    for (let i = 0; i < range.values.length; i++) {
      if (!matches(range.values[i])) continue
      const v = avgRange.values[i] ?? null
      if (typeof v === 'number') {
        total += v
        n++
      }
    }
    if (n === 0) return err('AVERAGEIF: нет ячеек, удовлетворяющих условию')
    return total / n
  },
}

const defCount: FnDef = {
  meta: {
    name: 'COUNT',
    args: ['значение1', '[значение2]', '…'],
    desc: 'Количество чисел (пустые и текст не считаются).',
    group: 'Математика',
  },
  minArgs: 1,
  maxArgs: Infinity,
  impl: (args) => {
    const nums = collectNumbers(args)
    if (nums instanceof FormulaError) return err(`COUNT: ${nums.message}`)
    return nums.length
  },
}

const defCounta: FnDef = {
  meta: {
    name: 'COUNTA',
    args: ['значение1', '[значение2]', '…'],
    desc: 'Количество непустых ячеек: числа, текст, логические.',
    group: 'Математика',
  },
  minArgs: 1,
  maxArgs: Infinity,
  impl: (args) => {
    let n = 0
    for (const a of args) {
      if (isRange(a)) {
        for (const v of a.values) if (v !== null && v !== '') n++
      } else if (a !== null && a !== '') n++
    }
    return n
  },
}

const defCountblank: FnDef = {
  meta: {
    name: 'COUNTBLANK',
    args: ['диапазон'],
    desc: 'Количество пустых ячеек в диапазоне.',
    group: 'Математика',
  },
  minArgs: 1,
  maxArgs: 1,
  impl: (args) => {
    const range = needRange(args[0], 'COUNTBLANK')
    if (range instanceof FormulaError) return range
    let n = 0
    for (const v of range.values) if (v === null || v === '') n++
    return n
  },
}

const defCountif: FnDef = {
  meta: {
    name: 'COUNTIF',
    args: ['диапазон', 'критерий'],
    desc: 'Количество ячеек, удовлетворяющих условию: «Иванов», «>1000», «П*».',
    group: 'Математика',
  },
  minArgs: 2,
  maxArgs: 2,
  impl: (args) => {
    const range = needRange(args[0], 'COUNTIF')
    if (range instanceof FormulaError) return range
    const crit = scalar(args[1], 'COUNTIF')
    if (crit instanceof FormulaError) return crit
    const matches = criterionPredicate(crit)
    let n = 0
    for (const v of range.values) if (matches(v)) n++
    return n
  },
}

const defMin: FnDef = {
  meta: {
    name: 'MIN',
    args: ['число1', '[число2]', '…'],
    desc: 'Наименьшее число из аргументов и диапазонов.',
    group: 'Математика',
  },
  minArgs: 1,
  maxArgs: Infinity,
  impl: (args) => {
    const nums = collectNumbers(args)
    if (nums instanceof FormulaError) return err(`MIN: ${nums.message}`)
    return nums.length === 0 ? 0 : Math.min(...nums)
  },
}

const defMax: FnDef = {
  meta: {
    name: 'MAX',
    args: ['число1', '[число2]', '…'],
    desc: 'Наибольшее число из аргументов и диапазонов.',
    group: 'Математика',
  },
  minArgs: 1,
  maxArgs: Infinity,
  impl: (args) => {
    const nums = collectNumbers(args)
    if (nums instanceof FormulaError) return err(`MAX: ${nums.message}`)
    return nums.length === 0 ? 0 : Math.max(...nums)
  },
}

const defIf: FnDef = {
  meta: {
    name: 'IF',
    args: ['условие', 'значение_если_да', '[значение_если_нет]'],
    desc: 'Выбор по условию: =IF(C2>10000;"крупная";"обычная").',
    group: 'Логика',
  },
  minArgs: 2,
  maxArgs: 3,
  impl: (args) => {
    const cond = toBool(scalar(args[0], 'IF'))
    if (cond instanceof FormulaError) return err(`IF: ${cond.message}`)
    if (cond) return scalar(args[1], 'IF')
    return args.length > 2 ? scalar(args[2], 'IF') : false
  },
}

const defIfs: FnDef = {
  meta: {
    name: 'IFS',
    args: ['условие1', 'значение1', 'условие2', 'значение2', '…'],
    desc: 'Первое выполненное условие выбирает своё значение.',
    group: 'Логика',
  },
  minArgs: 2,
  maxArgs: Infinity,
  impl: (args) => {
    if (args.length % 2 !== 0) return err('IFS: условия и значения идут парами — нужно чётное число аргументов')
    for (let i = 0; i < args.length; i += 2) {
      const cond = toBool(scalar(args[i], 'IFS'))
      if (cond instanceof FormulaError) return err(`IFS: ${cond.message}`)
      if (cond) return scalar(args[i + 1], 'IFS')
    }
    return err('IFS: ни одно условие не выполнено')
  },
}

const defAnd: FnDef = {
  meta: {
    name: 'AND',
    args: ['логическое1', '[логическое2]', '…'],
    desc: 'ИСТИНА, если все условия истинны.',
    group: 'Логика',
  },
  minArgs: 1,
  maxArgs: Infinity,
  impl: (args) => {
    let seen = false
    let result = true
    for (const a of args) {
      const collect = (v: CellValue): void => {
        if (typeof v === 'boolean' || typeof v === 'number') {
          seen = true
          if (!toBool(v)) result = false
        }
      }
      if (isRange(a)) a.values.forEach(collect)
      else {
        const b = toBool(a)
        if (b instanceof FormulaError) return err(`AND: ${b.message}`)
        seen = true
        if (!b) result = false
      }
    }
    if (!seen) return err('AND: нет логических значений')
    return result
  },
}

const defOr: FnDef = {
  meta: {
    name: 'OR',
    args: ['логическое1', '[логическое2]', '…'],
    desc: 'ИСТИНА, если хотя бы одно условие истинно.',
    group: 'Логика',
  },
  minArgs: 1,
  maxArgs: Infinity,
  impl: (args) => {
    let seen = false
    let result = false
    for (const a of args) {
      const collect = (v: CellValue): void => {
        if (typeof v === 'boolean' || typeof v === 'number') {
          seen = true
          if (toBool(v)) result = true
        }
      }
      if (isRange(a)) a.values.forEach(collect)
      else {
        const b = toBool(a)
        if (b instanceof FormulaError) return err(`OR: ${b.message}`)
        seen = true
        if (b) result = true
      }
    }
    if (!seen) return err('OR: нет логических значений')
    return result
  },
}

const defNot: FnDef = {
  meta: {
    name: 'NOT',
    args: ['логическое'],
    desc: 'Меняет ИСТИНА на ЛОЖЬ и наоборот.',
    group: 'Логика',
  },
  minArgs: 1,
  maxArgs: 1,
  impl: (args) => {
    const b = toBool(scalar(args[0], 'NOT'))
    if (b instanceof FormulaError) return err(`NOT: ${b.message}`)
    return !b
  },
}

const defConcat: FnDef = {
  meta: {
    name: 'CONCAT',
    args: ['текст1', '[текст2]', '…'],
    desc: 'Склеивает текст: =CONCAT(A2;" ";B2). Диапазоны — подряд.',
    group: 'Текст',
  },
  minArgs: 1,
  maxArgs: Infinity,
  impl: (args) => {
    let out = ''
    for (const a of args) {
      if (isRange(a)) {
        for (const v of a.values) out += toText(v)
      } else out += toText(a)
    }
    return out
  },
}

function textArg(a: Arg, fname: string): string | FormulaError {
  const v = scalar(a, fname)
  if (v instanceof FormulaError) return v
  return toText(v)
}

function countArg(a: Arg | undefined, fname: string, min: number): number | FormulaError {
  if (a === undefined) return min
  const n = toNum(scalar(a, fname))
  if (n instanceof FormulaError) return err(`${fname}: ${n.message}`)
  if (!Number.isInteger(n) || n < 0)
    return err(`${fname}: количество символов должно быть целым и не меньше 0`)
  return n
}

const defLeft: FnDef = {
  meta: {
    name: 'LEFT',
    args: ['текст', '[количество]'],
    desc: 'Первые символы текста (по умолчанию один).',
    group: 'Текст',
  },
  minArgs: 1,
  maxArgs: 2,
  impl: (args) => {
    const s = textArg(args[0], 'LEFT')
    if (s instanceof FormulaError) return s
    const n = countArg(args[1], 'LEFT', 1)
    if (n instanceof FormulaError) return n
    return [...s].slice(0, n).join('')
  },
}

const defRight: FnDef = {
  meta: {
    name: 'RIGHT',
    args: ['текст', '[количество]'],
    desc: 'Последние символы текста (по умолчанию один).',
    group: 'Текст',
  },
  minArgs: 1,
  maxArgs: 2,
  impl: (args) => {
    const s = textArg(args[0], 'RIGHT')
    if (s instanceof FormulaError) return s
    const n = countArg(args[1], 'RIGHT', 1)
    if (n instanceof FormulaError) return n
    const chars = [...s]
    return n === 0 ? '' : chars.slice(Math.max(0, chars.length - n)).join('')
  },
}

const defMid: FnDef = {
  meta: {
    name: 'MID',
    args: ['текст', 'начало', 'количество'],
    desc: 'Часть текста с заданной позиции: =MID("Иванов";2;3) → «ван».',
    group: 'Текст',
  },
  minArgs: 3,
  maxArgs: 3,
  impl: (args) => {
    const s = textArg(args[0], 'MID')
    if (s instanceof FormulaError) return s
    const start = toNum(scalar(args[1], 'MID'))
    if (start instanceof FormulaError) return err(`MID: ${start.message}`)
    const n = countArg(args[2], 'MID', 0)
    if (n instanceof FormulaError) return n
    if (!Number.isInteger(start) || start < 1)
      return err('MID: начальная позиция — целое число от 1')
    return [...s].slice(start - 1, start - 1 + n).join('')
  },
}

const defLen: FnDef = {
  meta: {
    name: 'LEN',
    args: ['текст'],
    desc: 'Длина текста в символах.',
    group: 'Текст',
  },
  minArgs: 1,
  maxArgs: 1,
  impl: (args) => {
    const s = textArg(args[0], 'LEN')
    if (s instanceof FormulaError) return s
    return [...s].length
  },
}

const defTrim: FnDef = {
  meta: {
    name: 'TRIM',
    args: ['текст'],
    desc: 'Убирает лишние пробелы: по краям и двойные внутри.',
    group: 'Текст',
  },
  minArgs: 1,
  maxArgs: 1,
  impl: (args) => {
    const s = textArg(args[0], 'TRIM')
    if (s instanceof FormulaError) return s
    return s.trim().replaceAll(/\s+/g, ' ')
  },
}

const defUpper: FnDef = {
  meta: {
    name: 'UPPER',
    args: ['текст'],
    desc: 'Верхний регистр: «иванов» → «ИВАНОВ».',
    group: 'Текст',
  },
  minArgs: 1,
  maxArgs: 1,
  impl: (args) => {
    const s = textArg(args[0], 'UPPER')
    if (s instanceof FormulaError) return s
    return s.toUpperCase()
  },
}

const defLower: FnDef = {
  meta: {
    name: 'LOWER',
    args: ['текст'],
    desc: 'Нижний регистр: «ИВАНОВ» → «иванов».',
    group: 'Текст',
  },
  minArgs: 1,
  maxArgs: 1,
  impl: (args) => {
    const s = textArg(args[0], 'LOWER')
    if (s instanceof FormulaError) return s
    return s.toLowerCase()
  },
}

const defRound: FnDef = {
  meta: {
    name: 'ROUND',
    args: ['число', '[знаков]'],
    desc: 'Округление: =ROUND(12550;-3) → 13000. Половина — от нуля.',
    group: 'Математика',
  },
  minArgs: 1,
  maxArgs: 2,
  impl: (args) => {
    const n = toNum(scalar(args[0], 'ROUND'))
    if (n instanceof FormulaError) return err(`ROUND: ${n.message}`)
    const digits = args.length > 1 ? toNum(scalar(args[1], 'ROUND')) : 0
    if (digits instanceof FormulaError) return err(`ROUND: ${digits.message}`)
    if (!Number.isInteger(digits)) return err('ROUND: число знаков должно быть целым')
    const f = Math.pow(10, digits)
    return (Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9)) / f
  },
}

const defAbs: FnDef = {
  meta: {
    name: 'ABS',
    args: ['число'],
    desc: 'Модуль числа: =ABS(-500) → 500.',
    group: 'Математика',
  },
  minArgs: 1,
  maxArgs: 1,
  impl: (args) => {
    const n = toNum(scalar(args[0], 'ABS'))
    if (n instanceof FormulaError) return err(`ABS: ${n.message}`)
    return Math.abs(n)
  },
}

const defVlookup: FnDef = {
  meta: {
    name: 'VLOOKUP',
    args: ['искомое', 'диапазон', 'номер_колонки', '[точное_совпадение]'],
    desc: 'Ищет значение в первой колонке диапазона и возвращает ячейку найденной строки. Точное совпадение включено по умолчанию.',
    group: 'Поиск',
  },
  minArgs: 3,
  maxArgs: 4,
  impl: (args) => {
    const key = scalar(args[0], 'VLOOKUP')
    if (key instanceof FormulaError) return key
    const table = needRange(args[1], 'VLOOKUP')
    if (table instanceof FormulaError) return table
    const colIdx = toNum(scalar(args[2], 'VLOOKUP'))
    if (colIdx instanceof FormulaError) return err(`VLOOKUP: ${colIdx.message}`)
    if (!Number.isInteger(colIdx) || colIdx < 1)
      return err('VLOOKUP: номер колонки — целое число от 1')
    const width = table.c2 - table.c1 + 1
    if (colIdx > width)
      return err(`VLOOKUP: в диапазоне ${width} колонк(и), а запрошена ${colIdx}-я`)
    let exact = true
    if (args.length > 3) {
      const e = toBool(scalar(args[3], 'VLOOKUP'))
      if (e instanceof FormulaError) return err(`VLOOKUP: ${e.message}`)
      exact = e
    }
    const keyNum = typeof key === 'string' ? Number(key.replace(',', '.')) : null
    const matchesKey = (v: CellValue): boolean => {
      if (typeof key === 'number') return typeof v === 'number' && v === key
      if (typeof key === 'string') {
        if (typeof v !== 'string') return false
        if (v.toLowerCase() === key.toLowerCase()) return true
        return exact === false && keyNum !== null && Number.isFinite(keyNum)
          ? Number(v.replace(',', '.')) === keyNum
          : false
      }
      return v === key
    }
    if (exact) {
      for (let r = table.r1; r <= table.r2; r++) {
        if (matchesKey(at(table, r, table.c1))) return at(table, r, table.c1 + colIdx - 1)
      }
      return err(`VLOOKUP: «${toText(key)}» нет в первой колонке диапазона`)
    }
    // приближенный режим: последняя строка, где первая колонка ≤ искомого
    let best: CellValue = null
    let found = false
    for (let r = table.r1; r <= table.r2; r++) {
      const v = at(table, r, table.c1)
      const vn = typeof v === 'number' ? v : null
      if (vn === null) continue
      if (typeof key === 'number' && vn <= key) {
        best = at(table, r, table.c1 + colIdx - 1)
        found = true
      }
    }
    if (!found) return err(`VLOOKUP: «${toText(key)}» меньше первого значения диапазона`)
    return best
  },
}

/* ── даты: строки ISO «ГГГГ-ММ-ДД» (так их читает и пишет импорт) ────── */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/

function dateParts(v: Arg, fname: string): [number, number, number] | FormulaError {
  const s = scalar(v, fname)
  if (s instanceof FormulaError) return s
  const text = typeof s === 'number' ? String(Math.trunc(s)) : typeof s === 'string' ? s : ''
  const m = ISO_RE.exec(text.trim())
  if (!m) return err(`${fname}: нужна дата вида 2026-10-09`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

const defDate: FnDef = {
  meta: {
    name: 'DATE',
    args: ['год', 'месяц', 'день'],
    desc: 'Дата из чисел: =DATE(2026;10;9) → 2026-10-09.',
    group: 'Дата',
  },
  minArgs: 3,
  maxArgs: 3,
  impl: (args) => {
    const parts: number[] = []
    for (let i = 0; i < 3; i++) {
      const n = toNum(scalar(args[i], 'DATE'))
      if (n instanceof FormulaError) return err(`DATE: ${n.message}`)
      if (!Number.isInteger(n)) return err('DATE: год, месяц и день — целые числа')
      parts.push(n)
    }
    const [y, mo, d] = parts
    if (y < 1900 || y > 9999) return err('DATE: год от 1900 до 9999')
    const dt = new Date(Date.UTC(y, mo - 1, d))
    if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
      return err('DATE: такого дня в этом месяце нет')
    return dt.toISOString().slice(0, 10)
  },
}

const defToday: FnDef = {
  meta: {
    name: 'TODAY',
    args: [],
    desc: 'Сегодняшняя дата (пересчитывается при следующем открытии).',
    group: 'Дата',
  },
  minArgs: 0,
  maxArgs: 0,
  impl: () => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  },
}

function dateField(index: 0 | 1 | 2, fname: string): FnDef['impl'] {
  return (args) => {
    const p = dateParts(args[0], fname)
    if (p instanceof FormulaError) return p
    return p[index]
  }
}

const defYear: FnDef = {
  meta: {
    name: 'YEAR',
    args: ['дата'],
    desc: 'Год из даты: =YEAR("2026-10-09") → 2026.',
    group: 'Дата',
  },
  minArgs: 1,
  maxArgs: 1,
  impl: dateField(0, 'YEAR'),
}

const defMonth: FnDef = {
  meta: {
    name: 'MONTH',
    args: ['дата'],
    desc: 'Номер месяца из даты: =MONTH("2026-10-09") → 10.',
    group: 'Дата',
  },
  minArgs: 1,
  maxArgs: 1,
  impl: dateField(1, 'MONTH'),
}

const defDay: FnDef = {
  meta: {
    name: 'DAY',
    args: ['дата'],
    desc: 'День месяца из даты: =DAY("2026-10-09") → 9.',
    group: 'Дата',
  },
  minArgs: 1,
  maxArgs: 1,
  impl: dateField(2, 'DAY'),
}

/* ── реестр ─────────────────────────────────────────────────────────── */

const DEFS: readonly FnDef[] = [
  defSum,
  defSumif,
  defSumifs,
  defAverage,
  defAverageif,
  defCount,
  defCounta,
  defCountblank,
  defCountif,
  defMin,
  defMax,
  defRound,
  defAbs,
  defIf,
  defIfs,
  defAnd,
  defOr,
  defNot,
  defConcat,
  defLeft,
  defRight,
  defMid,
  defLen,
  defTrim,
  defUpper,
  defLower,
  defVlookup,
  defDate,
  defToday,
  defYear,
  defMonth,
  defDay,
]

/** CONCATENATE — синоним CONCAT (пишут в старых файлах). */
const defConcatenate: FnDef = { ...defConcat, meta: { ...defConcat.meta, name: 'CONCATENATE' } }

export const FUNCTIONS: ReadonlyMap<string, FnDef> = new Map<string, FnDef>([
  ...DEFS.map((d) => [d.meta.name, d] as [string, FnDef]),
  ['CONCATENATE', defConcatenate],
])

/** Сигнатура для подсказок: SUM(число1; [число2]; …). */
export function fnSignature(meta: FnMeta): string {
  return `${meta.name}(${meta.args.join('; ')})`
}

export function functionNames(): string[] {
  return [...FUNCTIONS.keys()].sort((a, b) => a.localeCompare(b, 'ru'))
}
