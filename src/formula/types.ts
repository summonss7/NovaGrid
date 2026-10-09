/*
 * Общие типы движка формул (Этап 4). Значение ячейки — число, текст,
 * логическое или пусто; ошибка — отдельная разновидность с сообщением
 * человеческим языком (CONCEPT Ф6: не «#ERROR!», а «Не хватает закрывающей
 * скобки»). Ошибка — значение: распространяется по формуле, как в Excel.
 */

export type Scalar = number | string | boolean | null

/** null — пустая ячейка. */
export type CellValue = Scalar | FormulaError

export class FormulaError {
  constructor(readonly message: string) {}
}

export function isErr(v: CellValue): v is FormulaError {
  return v instanceof FormulaError
}
