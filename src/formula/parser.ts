/*
 * Парсер формул (Этап 4.1): токенайзер + рекурсивный спуск → AST.
 * Чистый модуль без DOM и состояния — кэшируется движком по исходному тексту.
 *
 * Синтаксис: числа (12, 1.5, 1,5 — по локали ввода), строки "в кавычках",
 * адреса A1 / $A$1, диапазоны A2:A5 и колонки целиком A:A, вызовы функций,
 * операторы + - * / ^ % и сравнения = <> < > <= >=, & — склейка текста.
 * Разделитель аргументов — «;» (русская локаль Excel) или «,»: если в формуле
 * есть «;», запятая считается десятичной, иначе — разделителем аргументов.
 *
 * Ошибки — сразу человеческим языком (Ф6): «Не хватает закрывающей скобки»,
 * «Диапазон A5:A2 записан снизу вверх — нужно A2:A5» и т.п.
 */

import { FormulaError } from './types'

export type BinOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>='

export type FormulaNode =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'ref'; row: number; col: number }
  | { t: 'range'; r1: number; c1: number; r2: number; c2: number }
  | { t: 'call'; name: string; args: FormulaNode[] }
  | { t: 'bin'; op: BinOp; l: FormulaNode; r: FormulaNode }
  | { t: 'neg'; e: FormulaNode }
  | { t: 'percent'; e: FormulaNode }

/** Прямоугольники зависимостей формулы (ссылки — вырожденные 1×1). */
export interface DepRect {
  r1: number
  c1: number
  r2: number
  c2: number
}

export interface CompiledFormula {
  ast: FormulaNode
  deps: DepRect[]
}

export interface RefName {
  row: number
  col: number
}

/** 0 → A, 25 → Z, 26 → AA (каноничное имя колонки). */
export function colLetters(col: number): string {
  let n = col
  let name = ''
  do {
    name = String.fromCharCode(65 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return name
}

/** Имя ячейки: (0,0) → A1. */
export function refName(row: number, col: number): string {
  return `${colLetters(col)}${row + 1}`
}

const MAX_REF_ROW = 1_048_575
const MAX_REF_COL = 16384

/** «A1» / «$B$12» → индексы с нуля; null — не похоже на адрес. */
export function parseCellRef(token: string): RefName | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(token)
  if (!m) return null
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  col -= 1
  const row = Number(m[2]) - 1
  if (row < 0 || row > MAX_REF_ROW || col < 0 || col > MAX_REF_COL) return null
  return { row, col }
}

/* ── токенайзер ─────────────────────────────────────────────────────── */

type TokKind = 'num' | 'str' | 'name' | 'op' | 'sep' | 'lparen' | 'rparen'

interface Token {
  kind: TokKind
  text: string
  /** числовое значение токена-числа */
  num?: number
  pos: number
}

const NAME_CHARS = /[A-Za-zА-Яа-яЁё0-9_.$]/

/** Есть ли «;» вне строк — тогда запятая десятичная, иначе разделитель. */
function commaIsDecimal(src: string): boolean {
  let inStr = false
  for (const ch of src) {
    if (ch === '"') inStr = !inStr
    else if (ch === ';' && !inStr) return true
  }
  return false
}

export function tokenize(src: string): Token[] {
  const commaDecimal = commaIsDecimal(src)
  const toks: Token[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    if (ch === '"') {
      let s = ''
      i++
      for (;;) {
        if (i >= n) throw new FormulaError('Не закрылась кавычка в тексте — добавьте "')
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"'
            i += 2
            continue
          }
          i++
          break
        }
        s += src[i]
        i++
      }
      toks.push({ kind: 'str', text: s, pos: i })
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let s = ''
      let dots = 0
      while (i < n) {
        const c = src[i]
        if (/[0-9]/.test(c)) s += c
        else if ((c === '.' || (c === ',' && commaDecimal)) && /[0-9]/.test(src[i + 1] ?? '')) {
          if (++dots > 1) break
          s += '.'
        } else break
        i++
      }
      toks.push({ kind: 'num', text: s, num: Number(s), pos: i })
      continue
    }
    if (NAME_CHARS.test(ch)) {
      let s = ''
      while (i < n && NAME_CHARS.test(src[i])) {
        s += src[i]
        i++
      }
      toks.push({ kind: 'name', text: s, pos: i })
      continue
    }
    const two = src.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '<>') {
      toks.push({ kind: 'op', text: two, pos: i })
      i += 2
      continue
    }
    if ('+-*/^&=<>%:'.includes(ch)) {
      toks.push({ kind: 'op', text: ch, pos: i })
      i++
      continue
    }
    if (ch === '(') {
      toks.push({ kind: 'lparen', text: ch, pos: i })
      i++
      continue
    }
    if (ch === ')') {
      toks.push({ kind: 'rparen', text: ch, pos: i })
      i++
      continue
    }
    if (ch === ';') {
      toks.push({ kind: 'sep', text: ch, pos: i })
      i++
      continue
    }
    if (ch === ',') {
      if (commaDecimal) throw new FormulaError('Запятая внутри числа — разделитель аргументов здесь «;»')
      toks.push({ kind: 'sep', text: ch, pos: i })
      i++
      continue
    }
    throw new FormulaError(`Непонятный символ «${ch}»`)
  }
  return toks
}

/* ── парсер ─────────────────────────────────────────────────────────── */

class Parser {
  private pos = 0

  constructor(private readonly toks: readonly Token[]) {}

  private peek(): Token | undefined {
    return this.toks[this.pos]
  }

  private next(): Token | undefined {
    return this.toks[this.pos++]
  }

  private expectOp(op: BinOp | '(' | ')'): void {
    const t = this.next()
    const want = op === '(' ? 'lparen' : op === ')' ? 'rparen' : 'op'
    if (!t || t.kind !== want || t.text !== op)
      throw new FormulaError(`Ожидался «${op}», а найдено «${t?.text ?? 'конец формулы'}»`)
  }

  parse(): FormulaNode {
    const e = this.expr()
    const rest = this.peek()
    if (rest)
      throw new FormulaError(
        rest.kind === 'rparen' ? 'Лишняя закрывающая скобка' : 'После формулы остались лишние символы',
      )
    return e
  }

  private expr(): FormulaNode {
    let l = this.concat()
    for (;;) {
      const t = this.peek()
      if (t?.kind === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.text)) {
        this.next()
        const r = this.concat()
        l = { t: 'bin', op: t.text as BinOp, l, r }
      } else return l
    }
  }

  private concat(): FormulaNode {
    let l = this.additive()
    for (;;) {
      const t = this.peek()
      if (t?.kind === 'op' && t.text === '&') {
        this.next()
        l = { t: 'bin', op: '&', l, r: this.additive() }
      } else return l
    }
  }

  private additive(): FormulaNode {
    let l = this.multiplicative()
    for (;;) {
      const t = this.peek()
      if (t?.kind === 'op' && (t.text === '+' || t.text === '-')) {
        this.next()
        l = { t: 'bin', op: t.text as BinOp, l, r: this.multiplicative() }
      } else return l
    }
  }

  private multiplicative(): FormulaNode {
    let l = this.power()
    for (;;) {
      const t = this.peek()
      if (t?.kind === 'op' && (t.text === '*' || t.text === '/')) {
        this.next()
        l = { t: 'bin', op: t.text as BinOp, l, r: this.power() }
      } else return l
    }
  }

  private power(): FormulaNode {
    let l = this.unary()
    for (;;) {
      const t = this.peek()
      if (t?.kind === 'op' && t.text === '^') {
        this.next()
        l = { t: 'bin', op: '^', l, r: this.unary() }
      } else return l
    }
  }

  private unary(): FormulaNode {
    const t = this.peek()
    if (t?.kind === 'op' && t.text === '-') {
      this.next()
      return { t: 'neg', e: this.unary() }
    }
    if (t?.kind === 'op' && t.text === '+') {
      this.next()
      return this.unary()
    }
    return this.postfix()
  }

  private postfix(): FormulaNode {
    let e = this.primary()
    const t = this.peek()
    if (t?.kind === 'op' && t.text === '%') {
      this.next()
      e = { t: 'percent', e }
    }
    return e
  }

  private primary(): FormulaNode {
    const t = this.next()
    if (!t) throw new FormulaError('Формула не закончена — не хватает значения или скобки')
    if (t.kind === 'num') return { t: 'num', v: t.num! }
    if (t.kind === 'str') return { t: 'str', v: t.text }
    if (t.kind === 'lparen') {
      const e = this.expr()
      const closing = this.peek()
      if (!closing) throw new FormulaError('Не хватает закрывающей скобки')
      this.expectOp(')')
      return e
    }
    if (t.kind === 'name') {
      const upper = t.text.toUpperCase()
      const next = this.peek()
      // вызов функции
      if (next?.kind === 'lparen') {
        this.next()
        const args: FormulaNode[] = []
        if (this.peek()?.kind === 'rparen') {
          this.next()
          return { t: 'call', name: upper, args }
        }
        for (;;) {
          if (!this.peek()) throw new FormulaError('Не хватает закрывающей скобки')
          args.push(this.expr())
          const sep = this.peek()
          if (sep?.kind === 'sep') {
            this.next()
            continue
          }
          if (sep?.kind === 'rparen') {
            this.next()
            return { t: 'call', name: upper, args }
          }
          throw new FormulaError(
            sep ? `Между аргументами «${upper}» нужен разделитель «;»` : 'Не хватает закрывающей скобки',
          )
        }
      }
      if (upper === 'ИСТИНА' || upper === 'TRUE') return { t: 'bool', v: true }
      if (upper === 'ЛОЖЬ' || upper === 'FALSE') return { t: 'bool', v: false }
      // диапазон A2:B5 или колонка A:A — до разбора одиночной ссылки:
      // «A» сам по себе не адрес, но в «A:A» — валидная колонка
      const after = this.peek()
      if (after?.kind === 'op' && after.text === ':') {
        this.next()
        const endTok = this.next()
        if (!endTok || endTok.kind !== 'name')
          throw new FormulaError(`После «:» в «${t.text}:» нужен адрес ячейки`)
        const startRef = parseCellRef(t.text)
        const endRef = parseCellRef(endTok.text)
        if (startRef && endRef) {
          if (startRef.row > endRef.row)
            throw new FormulaError(
              `Диапазон ${t.text}:${endTok.text} записан снизу вверх — нужно ${refName(endRef.row, endRef.col)}:${refName(startRef.row, startRef.col)}`,
            )
          if (startRef.col > endRef.col)
            throw new FormulaError(
              `Диапазон ${t.text}:${endTok.text} записан справа налево — нужно ${refName(startRef.row, endRef.col)}:${refName(endRef.row, startRef.col)}`,
            )
          return { t: 'range', r1: startRef.row, c1: startRef.col, r2: endRef.row, c2: endRef.col }
        }
        const c1 = columnIndexOf(t.text)
        const c2 = columnIndexOf(endTok.text)
        // «A1:B» и «A:B2» — недописанные границы; честно лечим только «A:A»/«A:B»
        if (c1 >= 0 && c2 >= 0 && !startRef && !endRef) {
          if (c1 > c2)
            throw new FormulaError(
              `Диапазон ${t.text}:${endTok.text} записан справа налево — нужно ${endTok.text}:${t.text}`,
            )
          // колонка целиком: 0..границы контента (движок ограничит по maxRow)
          return { t: 'range', r1: 0, c1, r2: -1, c2 }
        }
        throw new FormulaError(`«${t.text}:${endTok.text}» не похоже на диапазон — проверьте адреса`)
      }
      const ref = parseCellRef(t.text)
      if (ref) return { t: 'ref', row: ref.row, col: ref.col }
      throw new FormulaError(`Неизвестное имя «${t.text}» — это не адрес ячейки и не функция`)
    }
    throw new FormulaError(`Не ожидал здесь «${t.text}»`)
  }
}

/** «B» / «$B» → индекс колонки; −1 — не одна буква-имя. */
function columnIndexOf(token: string): number {
  const m = /^\$?([A-Za-z]{1,3})$/.exec(token)
  if (!m) return -1
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return col - 1
}

/** Компиляция: AST + список прямоугольников зависимостей. */
export function compileFormula(src: string): CompiledFormula {
  const ast = new Parser(tokenize(src)).parse()
  const deps: DepRect[] = []
  const walk = (node: FormulaNode): void => {
    switch (node.t) {
      case 'ref':
        deps.push({ r1: node.row, c1: node.col, r2: node.row, c2: node.col })
        break
      case 'range':
        deps.push({ r1: node.r1, c1: node.c1, r2: node.r2, c2: node.c2 })
        break
      case 'call':
        node.args.forEach(walk)
        break
      case 'bin':
        walk(node.l)
        walk(node.r)
        break
      case 'neg':
      case 'percent':
        walk(node.e)
        break
      default:
        break
    }
  }
  walk(ast)
  return { ast, deps }
}

/** Канонический текст AST: «,» между аргументами, «.» в числах (для .xlsx). */
export function formatAst(node: FormulaNode): string {
  switch (node.t) {
    case 'num':
      return String(node.v)
    case 'str':
      return `"${node.v.replaceAll('"', '""')}"`
    case 'bool':
      return node.v ? 'TRUE' : 'FALSE'
    case 'ref':
      return refName(node.row, node.col)
    case 'range':
      return node.r2 < 0
        ? `${colLetters(node.c1)}:${colLetters(node.c2)}`
        : `${refName(node.r1, node.c1)}:${refName(node.r2, node.c2)}`
    case 'call':
      return `${node.name}(${node.args.map(formatAst).join(',')})`
    case 'bin':
      return `${formatAst(node.l)}${node.op}${formatAst(node.r)}`
    case 'neg':
      return `-${formatAst(node.e)}`
    case 'percent':
      return `${formatAst(node.e)}%`
  }
}
