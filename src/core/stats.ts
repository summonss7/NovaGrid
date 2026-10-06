/** Сумма чисел (основа будущей кнопки Σ и статус-бара). */
export function sum(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0)
}

/** Среднее (x̄ в статус-баре). Пустой массив даёт 0. */
export function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length
}
