/*
 * Автодополнение формул (Этап 4.4, CONCEPT Ф6): подсказки имён функций при
 * вводе после «=» и подпись аргументов внутри вызова — «SUM(число1;
 * [число2]; …)» с выделением текущего аргумента. Чистые функции от текста
 * и позиции каретки; DOM-часть (попап) — ui/AssistPopup.
 */

import { FUNCTIONS, fnSignature } from './functions'

export interface AssistSuggestion {
  name: string
  sig: string
  desc: string
}

export interface ArgHint {
  name: string
  sig: string
  /** индекс аргумента, в котором стоит каретка */
  argIdx: number
  args: readonly string[]
}

export interface AssistInfo {
  suggestions: readonly AssistSuggestion[]
  /** [начало, конец) префикса имени в value — для подстановки */
  prefixStart: number
  prefixEnd: number
  argHint: ArgHint | null
}

const NAME_RE = /[A-Za-zА-Яа-яЁё0-9_.]/

/** Стоит ли каретка в «позиции имени» — сразу после «=», «(», разделителя или оператора. */
function atNamePosition(value: string, start: number): boolean {
  let i = start - 1
  while (i >= 0 && (value[i] === ' ' || value[i] === '\t')) i--
  if (i < 0) return false
  const ch = value[i]
  return ch === '=' || ch === '(' || ch === ';' || ch === ',' || '+-*/^&<>='.includes(ch)
}

/**
 * Подсказки для формулы: имена функций по префиксу + подпись аргументов
 * ближайшего незакрытого вызова. null — не в режиме формулы/нечего показать.
 */
export function computeAssist(value: string, caret: number): AssistInfo | null {
  // сам «=» уже повод показать список (Excel так же), дальше — по префиксу
  if (!value.startsWith('=') || value.length === 0) return null
  const pos = Math.min(Math.max(caret, 1), value.length)

  // префикс имени перед кареткой
  let start = pos
  while (start > 1 && NAME_RE.test(value[start - 1])) start--
  const prefix = value.slice(start, pos)
  const inNamePosition = atNamePosition(value, start)
  const plausible = /^[A-Za-zА-ЯЁё][A-Za-zА-ЯЁё0-9_.]*$/.test(prefix) || prefix === ''

  let suggestions: AssistSuggestion[] = []
  // «голый» список (без префикса) показываем только в самом начале формулы;
  // после «(» и разделителей главное — подпись аргументов, Enter должен
  // фиксировать формулу, а не подставлять функцию
  if (inNamePosition && plausible && (prefix !== '' || start === 1)) {
    const lower = prefix.toLowerCase()
    suggestions = [...FUNCTIONS.values()]
      .filter((d) => d.meta.name !== 'CONCATENATE')
      .map((d) => ({ name: d.meta.name, sig: fnSignature(d.meta), desc: d.meta.desc }))
      .filter((s) => s.name.toLowerCase().startsWith(lower))
      .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name, 'ru'))
      .slice(0, 8)
  }

  // подпись аргументов: ближайшая незакрытая «(» до каретки
  const argHint = argHintAt(value, pos)

  if (suggestions.length === 0 && !argHint) return null
  return { suggestions, prefixStart: start, prefixEnd: pos, argHint }
}

function argHintAt(value: string, caret: number): ArgHint | null {
  // сканируем слева, помня последнюю незакрытую скобку с именем функции
  const openStack: { name: string; argsStart: number }[] = []
  let i = 0
  let inStr = false
  while (i < caret) {
    const ch = value[i]
    if (inStr) {
      if (ch === '"') {
        if (value[i + 1] === '"') i++
        else inStr = false
      }
      i++
      continue
    }
    if (ch === '"') {
      inStr = true
      i++
      continue
    }
    if (ch === '(') {
      let j = i - 1
      while (j >= 0 && NAME_RE.test(value[j])) j--
      const name = value.slice(j + 1, i).toUpperCase()
      openStack.push({ name: NAME_RE.test(name) ? name : '', argsStart: i + 1 })
    } else if (ch === ')') {
      openStack.pop()
    }
    i++
  }
  const top = openStack[openStack.length - 1]
  if (!top || !top.name) return null
  const def = FUNCTIONS.get(top.name)
  if (!def) return null
  // номер аргумента: разделители глубины 0 между «(» и кареткой;
  // строки сканируем как в первом проходе — «;» в кавычках не разделитель
  let depth = 0
  let argIdx = 0
  let inString = false
  for (let k = top.argsStart; k < caret; k++) {
    const ch = value[k]
    if (inString) {
      if (ch === '"') {
        if (value[k + 1] === '"') k++
        else inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if ((ch === ';' || ch === ',') && depth === 0) argIdx++
  }
  return { name: def.meta.name, sig: fnSignature(def.meta), argIdx, args: def.meta.args }
}

/** Подстановка выбранной подсказки: «=SU|» → «=SUM(|». */
export function applySuggestion(
  value: string,
  prefixStart: number,
  prefixEnd: number,
  name: string,
): { value: string; caret: number } {
  const next = value.slice(0, prefixStart) + name + '(' + value.slice(prefixEnd)
  return { value: next, caret: prefixStart + name.length + 1 }
}
