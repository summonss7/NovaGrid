/*
 * Движок формул (Этап 4.2): вычисление значений ячеек-формул и пересчёт
 * при правках. Значения — производные листа: WeakMap по (иммутабельному)
 * объекту SheetModel, поэтому любой потребитель (канвас, поиск, фильтры,
 * сохранение) читает согласованное состояние без знания о пересчёте.
 *
 * Пересчёт инкрементальный: после правок (delta-история даёт список
 * изменённых ячеек) пересчитываются только формулы, чьи прямоугольники
 * зависимостей задеты, изменения значений распространяются по цепочке
 * зависимых. Полный пересчёт — при загрузке книги и как запасной путь.
 *
 * Чужие формулы (Ф6, 4.6): если формулу не удаётся разобрать или функция
 * не из списка, а в sheet.formulaCache есть значение из файла — показываем
 * его с признаком frozen («∛ не пересчитывается»); в файл формула
 * сохраняется как есть.
 */

import type { CellChange } from '../core/history'
import { cellKey, getCell, parseNumber, type SheetModel } from '../core/sheet'
import { FUNCTIONS, type Arg, type FnCtx, type RangeArg } from './functions'
import {
  type CompiledFormula,
  type FormulaNode,
  compileFormula,
  formatAst,
  refName,
} from './parser'
import { FormulaError, type CellValue } from './types'

/** Результат формулы в ячейке (для отображения и пересчёта). */
export interface FormulaCellState {
  /** что показывать в гриде/CSV (для ошибок — сообщение) */
  display: string
  /** числовое значение (Σ, фильтры-числа); null — не число */
  num: number | null
  /** сообщение об ошибке человеческим языком; null — ошибки нет */
  error: string | null
  /** чужая формула: показан кэш из файла, пересчёта нет (∛) */
  frozen: boolean
}

export type FormulaValues = Map<string, FormulaCellState>

/** Лимит ячеек одного диапазона — защита от A:A на гигантских листах. */
const RANGE_CELL_LIMIT = 2_000_000

export function isFormulaRaw(raw: string): boolean {
  return raw.startsWith('=') && raw.trim().length > 1
}

/** Каноническая строка числа без артефактов плавающей точки (0.1+0.2 → 0.3). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return ''
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toPrecision(12)))
}

/* ── кэши ───────────────────────────────────────────────────────────── */

const valuesCache = new WeakMap<SheetModel, FormulaValues>()
const compileCache = new Map<string, CompiledFormula | FormulaError>()

function compiled(src: string): CompiledFormula | FormulaError {
  let c = compileCache.get(src)
  if (!c) {
    try {
      c = compileFormula(src)
    } catch (e) {
      c = e instanceof FormulaError ? e : new FormulaError('Не удалось разобрать формулу')
    }
    compileCache.set(src, c)
  }
  return c
}

/** Канонический текст формулы для .xlsx (аргументы через запятую); null — не парсится. */
export function canonicalFormulaText(src: string): string | null {
  const c = compiled(src.startsWith('=') ? src.slice(1) : src)
  return c instanceof FormulaError ? null : formatAst(c.ast)
}

/* ── скаляры листа ──────────────────────────────────────────────────── */

function scalarOf(raw: string): CellValue {
  if (raw === '') return null
  const n = parseNumber(raw)
  if (n !== null) return n
  const u = raw.trim().toUpperCase()
  if (u === 'ИСТИНА' || u === 'TRUE') return true
  if (u === 'ЛОЖЬ' || u === 'FALSE') return false
  return raw
}

function stateToValue(st: FormulaCellState): CellValue {
  if (st.error) return new FormulaError(st.error)
  if (st.num !== null) return st.num
  return st.display === '' ? null : st.display
}

function formatState(v: CellValue): FormulaCellState {
  if (v instanceof FormulaError) return { display: v.message, num: null, error: v.message, frozen: false }
  if (v === null) return { display: '', num: null, error: null, frozen: false }
  if (typeof v === 'number') return { display: formatNumber(v), num: v, error: null, frozen: false }
  if (typeof v === 'boolean')
    return { display: v ? 'ИСТИНА' : 'ЛОЖЬ', num: null, error: null, frozen: false }
  return { display: v, num: null, error: null, frozen: false }
}

/* ── вычисление ─────────────────────────────────────────────────────── */

interface EvalState {
  sheet: SheetModel
  values: FormulaValues
  chain: Set<string>
}

function cellValueOf(st: EvalState, row: number, col: number): CellValue {
  const raw = getCell(st.sheet, row, col)
  if (raw === '') return null
  if (!isFormulaRaw(raw)) return scalarOf(raw)
  const key = cellKey(row, col)
  const memo = st.values.get(key)
  if (memo) return stateToValue(memo)
  if (st.chain.has(key))
    return new FormulaError(`Циклическая ссылка: ${refName(row, col)} участвует в собственном вычислении`)
  const state = evaluateInto(st, key, row, col, raw)
  return stateToValue(state)
}

/** Вычислить формулу ячейки с записью результата в st.values. */
function evaluateInto(
  st: EvalState,
  key: string,
  row: number,
  col: number,
  raw: string,
): FormulaCellState {
  const cached = st.values.get(key)
  if (cached) return cached
  // не смогли вычислить, а из файла есть значение — чужая формула (Ф6):
  // показываем кэш с признаком «не пересчитывается»
  const frozenFromCache = (): FormulaCellState | null => {
    const fileCache = st.sheet.formulaCache?.get(key)
    if (fileCache === undefined) return null
    return { display: fileCache, num: parseNumber(fileCache), error: null, frozen: true }
  }
  const finalize = (v: Arg): FormulaCellState => {
    if (isRangeArg(v)) return formatState(new FormulaError('Формула не может состоять из одного диапазона'))
    if (v instanceof FormulaError) {
      const frozen = frozenFromCache()
      if (frozen) return frozen
    }
    return formatState(v)
  }
  const c = compiled(raw.slice(1))
  let state: FormulaCellState
  if (c instanceof FormulaError) {
    const frozen = frozenFromCache()
    state = frozen ?? formatState(c)
  } else {
    st.chain.add(key)
    try {
      state = finalize(evalNode(st, c.ast, row, col))
    } catch {
      state = frozenFromCache() ?? formatState(new FormulaError('Не удалось вычислить формулу'))
    } finally {
      st.chain.delete(key)
    }
  }
  st.values.set(key, state)
  return state
}

function rangeArgOf(st: EvalState, r1: number, c1: number, r2: number, c2: number): Arg {
  const bottom = r2 < 0 ? Math.max(st.sheet.maxRow, r1) : r2
  const rows = bottom - r1 + 1
  const cols = c2 - c1 + 1
  if (rows <= 0 || cols <= 0) return { values: [], r1, c1, r2: bottom, c2 }
  if (rows * cols > RANGE_CELL_LIMIT)
    return new FormulaError(`Диапазон ${refName(r1, c1)}:${refName(bottom, c2)} слишком большой`)
  const values: CellValue[] = []
  for (let r = r1; r <= bottom; r++)
    for (let c = c1; c <= c2; c++) values.push(cellValueOf(st, r, c))
  return { values, r1, c1, r2: bottom, c2 }
}

function toOpNum(v: CellValue): number | string {
  if (v instanceof FormulaError) return 0
  if (v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = Number(v.trim().replace(',', '.'))
  return v.trim() !== '' && Number.isFinite(n) ? n : v.toLowerCase()
}

function compareOp(op: '=' | '<>' | '<' | '>' | '<=' | '>=', l: CellValue, r: CellValue): CellValue {
  if (l instanceof FormulaError) return l
  if (r instanceof FormulaError) return r
  const ln = toOpNum(l)
  const rn = toOpNum(r)
  // числа меньше текста (как в Excel при сравнении разнотипных значений)
  const lt = typeof ln === 'string' ? 1 : 0
  const rt = typeof rn === 'string' ? 1 : 0
  const cmp = lt !== rt ? lt - rt : ln < rn ? -1 : ln > rn ? 1 : 0
  switch (op) {
    case '=':
      return cmp === 0
    case '<>':
      return cmp !== 0
    case '<':
      return cmp < 0
    case '>':
      return cmp > 0
    case '<=':
      return cmp <= 0
    case '>=':
      return cmp >= 0
  }
}

function isRangeArg(v: Arg): v is RangeArg {
  return typeof v === 'object' && v !== null && 'values' in v
}

function evalNode(st: EvalState, node: FormulaNode, selfRow: number, selfCol: number): Arg {
  switch (node.t) {
    case 'num':
      return node.v
    case 'str':
      return node.v
    case 'bool':
      return node.v
    case 'ref':
      return cellValueOf(st, node.row, node.col)
    case 'range':
      return rangeArgOf(st, node.r1, node.c1, node.r2, node.c2)
    case 'neg': {
      const v = evalNode(st, node.e, selfRow, selfCol)
      if (v instanceof FormulaError) return v
      if (isRangeArg(v)) return new FormulaError('Нельзя менять знак диапазона')
      if (v === null) return 0
      if (typeof v === 'number') return -v
      if (typeof v === 'boolean') return v ? -1 : 0
      const n = Number(v.replace(',', '.'))
      return Number.isFinite(n) ? -n : new FormulaError(`«${v}» — не число`)
    }
    case 'percent': {
      const v = evalNode(st, node.e, selfRow, selfCol)
      if (v instanceof FormulaError) return v
      if (typeof v !== 'number') return new FormulaError('Процент применим к числу')
      return v / 100
    }
    case 'bin': {
      const l = evalNode(st, node.l, selfRow, selfCol)
      const r = evalNode(st, node.r, selfRow, selfCol)
      if (l instanceof FormulaError) return l
      if (r instanceof FormulaError) return r
      if (node.op === '&') {
        if (isRangeArg(l) || isRangeArg(r))
          return new FormulaError('Склеивать можно отдельные значения — диапазон содержит много ячеек')
        return `${textOf(l)}${textOf(r)}`
      }
      if (isRangeArg(l) || isRangeArg(r))
        return new FormulaError('С диапазоном нельзя делать арифметику — сначала SUM/AVERAGE')
      if (['=', '<>', '<', '>', '<=', '>='].includes(node.op))
        return compareOp(node.op as '=' | '<>' | '<' | '>' | '<=' | '>=', l, r)
      const ln = numOrNull(l)
      const rn = numOrNull(r)
      if (ln === null || rn === null) return new FormulaError(`«${ln === null ? textOf(l) : textOf(r)}» — не число`)
      switch (node.op) {
        case '+':
          return ln + rn
        case '-':
          return ln - rn
        case '*':
          return ln * rn
        case '/':
          if (rn === 0) return new FormulaError('Деление на ноль')
          return ln / rn
        case '^': {
          const p = Math.pow(ln, rn)
          return Number.isFinite(p) ? p : new FormulaError('Не получилось возвести в степень')
        }
        default:
          return new FormulaError('Неизвестная операция')
      }
    }
    case 'call': {
      const def = FUNCTIONS.get(node.name)
      if (!def)
        return new FormulaError(
          `Неизвестная функция ${node.name} — проверьте написание или откройте справочник «?»`,
        )
      if (node.args.length < def.minArgs || node.args.length > def.maxArgs) {
        const need =
          def.maxArgs === Infinity
            ? `хотя бы ${def.minArgs}`
            : def.minArgs === def.maxArgs
              ? `ровно ${def.minArgs}`
              : `от ${def.minArgs} до ${def.maxArgs}`
        return new FormulaError(
          `${node.name}: аргументов нужно ${need}, а передано ${node.args.length}`,
        )
      }
      const args: Arg[] = node.args.map((a) => evalNode(st, a, selfRow, selfCol))
      const ctx: FnCtx = {
        cell: (row, col) => cellValueOf(st, row, col),
        selfRow,
        selfCol,
      }
      return def.impl(args, ctx)
    }
  }
}

function numOrNull(v: CellValue): number | null {
  if (v instanceof FormulaError) return null
  if (v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = Number(v.trim().replace(',', '.'))
  return v.trim() !== '' && Number.isFinite(n) ? n : null
}

function textOf(v: CellValue): string {
  if (v instanceof FormulaError) return v.message
  if (v === null) return ''
  if (typeof v === 'number') return formatNumber(v)
  if (typeof v === 'boolean') return v ? 'ИСТИНА' : 'ЛОЖЬ'
  return v
}

/* ── пересчёт ───────────────────────────────────────────────────────── */

function formulaKeysOf(sheet: SheetModel): string[] {
  const keys: string[] = []
  for (const [key, raw] of sheet.cells) if (isFormulaRaw(raw)) keys.push(key)
  return keys
}

/** Полный пересчёт листа; результат кэшируется в WeakMap. */
export function recalcSheet(sheet: SheetModel): FormulaValues {
  const values: FormulaValues = new Map()
  const keys = formulaKeysOf(sheet)
  if (keys.length > 0) {
    const st: EvalState = { sheet, values, chain: new Set() }
    for (const key of keys) {
      const { row, col } = keyRowCol(key)
      evaluateInto(st, key, row, col, getCell(sheet, row, col))
    }
  }
  valuesCache.set(sheet, values)
  return values
}

function keyRowCol(key: string): { row: number; col: number } {
  const i = key.indexOf(':')
  return { row: Number(key.slice(0, i)), col: Number(key.slice(i + 1)) }
}

function sameState(a: FormulaCellState | undefined, b: FormulaCellState | undefined): boolean {
  if (!a || !b) return a === b
  return a.display === b.display && a.error === b.error && a.frozen === b.frozen
}

function rectContains(rect: { r1: number; c1: number; r2: number; c2: number }, row: number, col: number): boolean {
  if (rect.c2 < rect.c1) return false
  if (col < rect.c1 || col > rect.c2) return false
  return rect.r2 < 0 ? true : row >= rect.r1 && row <= rect.r2
}

function depsOf(raw: string): { r1: number; c1: number; r2: number; c2: number }[] {
  const c = compiled(raw.slice(1))
  return c instanceof FormulaError ? [] : c.deps
}

/**
 * Инкрементальный пересчёт после правок: prev — лист до изменений (его
 * значения уже вычислены), next — после, changes — изменённые ячейки.
 * Пересчитываются только задетые формулы и их зависимые; нетронутые
 * значения переносятся. Результат кэшируется для next.
 */
export function applyFormulaChanges(
  prev: SheetModel,
  next: SheetModel,
  changes: readonly CellChange[],
): FormulaValues {
  if (valuesCache.get(next)) return valuesCache.get(next)!
  const prevValues = valuesCache.get(prev)
  if (!prevValues || changes.length === 0) return recalcSheet(next)

  const keys = formulaKeysOf(next)
  // зависимости каждой формулы нового листа (после правок адреса те же)
  const depsByKey = new Map<string, ReturnType<typeof depsOf>>()
  for (const key of keys) {
    const { row, col } = keyRowCol(key)
    depsByKey.set(key, depsOf(getCell(next, row, col)))
  }
  const values: FormulaValues = new Map()
  for (const key of keys) {
    const old = prevValues.get(key)
    if (old) values.set(key, old)
  }
  const st: EvalState = { sheet: next, values, chain: new Set() }

  // семена пересчёта: формулы в изменённых ячейках и ссылающиеся на них
  const queue: string[] = []
  const queued = new Set<string>()
  const pushIfDepends = (row: number, col: number): void => {
    for (const key of keys) {
      if (queued.has(key)) continue
      const rc = keyRowCol(key)
      const hit = (rc.row === row && rc.col === col) || depsByKey.get(key)!.some((rect) => rectContains(rect, row, col))
      if (hit) {
        queue.push(key)
        queued.add(key)
      }
    }
  }
  for (const ch of changes) pushIfDepends(ch.row, ch.col)

  const processed = new Set<string>()
  while (queue.length > 0) {
    const key = queue.shift()!
    if (processed.has(key)) continue
    processed.add(key)
    const { row, col } = keyRowCol(key)
    const before = values.get(key)
    // мемо здесь — перенесённое старое значение; убираем, чтобы
    // evaluateInto пересчитал принудительно (читатели выше по цепочке
    // уже увидят новое)
    values.delete(key)
    evaluateInto(st, key, row, col, getCell(next, row, col))
    if (!sameState(before, values.get(key))) {
      // значение формулы изменилось — пересчитать зависящие от этой ячейки
      pushIfDepends(row, col)
    }
  }
  valuesCache.set(next, values)
  return values
}

/* ── публичные доступы ──────────────────────────────────────────────── */

export function getValues(sheet: SheetModel): FormulaValues {
  return valuesCache.get(sheet) ?? recalcSheet(sheet)
}

/** Отображаемый текст ячейки: формула → вычисленное значение/ошибка. */
export function cellText(sheet: SheetModel, row: number, col: number): string {
  const raw = getCell(sheet, row, col)
  if (!isFormulaRaw(raw)) return raw
  return getValues(sheet).get(cellKey(row, col))?.display ?? ''
}

/** Числовое значение ячейки (Σ/метрики/сортировка): формула → результат. */
export function cellNumber(sheet: SheetModel, row: number, col: number): number | null {
  const raw = getCell(sheet, row, col)
  if (!isFormulaRaw(raw)) return parseNumber(raw)
  return getValues(sheet).get(cellKey(row, col))?.num ?? null
}

/** Сообщение об ошибке формулы (человеческим языком); null — ошибки нет. */
export function cellError(sheet: SheetModel, row: number, col: number): string | null {
  const raw = getCell(sheet, row, col)
  if (!isFormulaRaw(raw)) return null
  return getValues(sheet).get(cellKey(row, col))?.error ?? null
}

/** Чужая формула в ячейке (∛ не пересчитывается)? */
export function cellIsFrozen(sheet: SheetModel, row: number, col: number): boolean {
  const raw = getCell(sheet, row, col)
  if (!isFormulaRaw(raw)) return false
  return getValues(sheet).get(cellKey(row, col))?.frozen ?? false
}

/** Полное состояние формулы в ячейке (строка формул, тесты); null — не формула. */
export function formulaStateAt(
  sheet: SheetModel,
  row: number,
  col: number,
): FormulaCellState | null {
  const raw = getCell(sheet, row, col)
  if (!isFormulaRaw(raw)) return null
  return getValues(sheet).get(cellKey(row, col)) ?? null
}

/**
 * Разовое вычисление формулы в контексте листа без записи в кэш — живые
 * примеры справочника «?» (Этап 4.5).
 */
export function evalStandalone(
  sheet: SheetModel,
  src: string,
  selfRow = 0,
  selfCol = 0,
): CellValue {
  const c = compiled(src.startsWith('=') ? src.slice(1) : src)
  if (c instanceof FormulaError) return c
  const st: EvalState = { sheet, values: new Map(), chain: new Set() }
  const v = evalNode(st, c.ast, selfRow, selfCol)
  return isRangeArg(v)
    ? new FormulaError('Формула не может состоять из одного диапазона')
    : v
}

/** Значение формулы для записи в .xlsx (result): число или строка. */
export function formulaResultForSave(
  sheet: SheetModel,
  row: number,
  col: number,
): { result: number | string | boolean; canonical: string | null } {
  const raw = getCell(sheet, row, col)
  const state = getValues(sheet).get(cellKey(row, col))
  const canonical = canonicalFormulaText(raw)
  if (state?.frozen) {
    const cached = sheet.formulaCache?.get(cellKey(row, col)) ?? state.display
    const n = parseNumber(cached)
    return { result: n !== null ? n : cached, canonical: raw.slice(1) }
  }
  if (!state) return { result: raw, canonical }
  if (state.num !== null) return { result: state.num, canonical }
  if (state.display === 'ИСТИНА') return { result: true, canonical }
  if (state.display === 'ЛОЖЬ') return { result: false, canonical }
  return { result: state.error ?? state.display, canonical }
}
