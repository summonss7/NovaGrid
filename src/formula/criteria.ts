/*
 * Критерии SUMIF/COUNTIF/AVERAGEIF: значение, сравнение (">100", "<>х")
 * и джокеры * / ?. Числа сравниваются числово, текст — без учёта регистра.
 */

import type { CellValue } from './types'
import { isErr } from './types'

export type CellPredicate = (v: CellValue) => boolean

interface Comparator {
  op: '=' | '<>' | '<' | '>' | '<=' | '>='
  operand: string
}

/** «>100» → {op:'>', operand:'100'}; без префикса — точное совпадение. */
function splitComparator(crit: string): Comparator | null {
  const m = /^(<=|>=|<>|=|<|>)(.*)$/s.exec(crit)
  if (!m) return null
  return { op: m[1] as Comparator['op'], operand: m[2] }
}

function wildcardToRegExp(pattern: string): RegExp {
  let re = '^'
  for (const ch of pattern) {
    if (ch === '*') re += '.*'
    else if (ch === '?') re += '.'
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(re + '$', 'i')
}

function compare(op: Comparator['op'], a: number, b: number): boolean
function compare(op: Comparator['op'], a: string, b: string): boolean
function compare(op: Comparator['op'], a: number | string, b: number | string): boolean {
  switch (op) {
    case '=':
      return a === b
    case '<>':
      return a !== b
    case '<':
      return a < b
    case '>':
      return a > b
    case '<=':
      return a <= b
    case '>=':
      return a >= b
  }
}

/**
 * Предикат ячейки по критерию. Пустой критерий совпадает с пустой ячейкой;
 * ошибки в ячейках никогда не совпадают (Excel так же их пропускает).
 */
export function criterionPredicate(crit: CellValue): CellPredicate {
  if (isErr(crit)) return () => false
  if (crit === null) return (v) => v === null || v === ''
  if (typeof crit === 'boolean') return (v) => v === crit
  if (typeof crit === 'number') return (v) => typeof v === 'number' && v === crit

  const cmp = splitComparator(crit)
  if (!cmp) {
    // точное совпадение с джокерами: «Иван*»
    if (/[*?]/.test(crit)) {
      const re = wildcardToRegExp(crit)
      return (v) => typeof v === 'string' && re.test(v)
    }
    const num = Number(crit.replace(',', '.'))
    if (crit.trim() !== '' && Number.isFinite(num))
      return (v) => (typeof v === 'number' ? v === num : typeof v === 'string' && v.toLowerCase() === crit.toLowerCase())
    const lower = crit.toLowerCase()
    return (v) => typeof v === 'string' && v.toLowerCase() === lower
  }
  const { op, operand } = cmp
  if (operand === '') return (v) => (op === '=' ? v === null || v === '' : op === '<>' ? v !== null && v !== '' : false)
  const num = Number(operand.replace(',', '.'))
  if (Number.isFinite(num) && operand.trim() !== '')
    return (v) => typeof v === 'number' && compare(op, v, num)
  const opText = operand.toLowerCase()
  if (/[*?]/.test(operand) && (op === '=' || op === '<>')) {
    const re = wildcardToRegExp(operand)
    return (v) => {
      const hit = typeof v === 'string' && re.test(v)
      return op === '=' ? hit : !hit && typeof v === 'string'
    }
  }
  return (v) => typeof v === 'string' && compare(op, v.toLowerCase(), opText)
}
