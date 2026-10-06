import { describe, expect, it } from 'vitest'
import { average, sum } from './stats'

describe('sum', () => {
  it('складывает числа', () => {
    expect(sum([1, 2, 3])).toBe(6)
  })

  it('пустой массив даёт 0', () => {
    expect(sum([])).toBe(0)
  })
})

describe('average', () => {
  it('считает среднее', () => {
    expect(average([2, 4])).toBe(3)
  })

  it('пустой массив даёт 0', () => {
    expect(average([])).toBe(0)
  })
})
