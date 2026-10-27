import { describe, expect, it } from 'vitest'
import { daysBetween, formatDay, parseDay, shiftDays } from './dates'

/*
 * Даты-строки (novagrid-038): строгий разбор ISO/русского формата,
 * календарный сдвиг «+день», разность дат в днях.
 */

describe('parseDay', () => {
  it('ISO и русский формат с любым паддингом', () => {
    expect(parseDay('2026-10-27')).toEqual({ y: 2026, m: 10, d: 27, time: null, ru: false })
    expect(parseDay('2026-1-5')).toEqual({ y: 2026, m: 1, d: 5, time: null, ru: false })
    expect(parseDay('27.10.2026')).toEqual({ y: 2026, m: 10, d: 27, time: null, ru: true })
    expect(parseDay('1.5.2026')).toEqual({ y: 2026, m: 5, d: 1, time: null, ru: true })
  })

  it('время «ЧЧ:ММ» сохраняется (его пишет импорт из Excel/ODS)', () => {
    expect(parseDay('2026-10-27 10:30')!.time).toBe('10:30')
    expect(parseDay('2026-10-27T09:05')!.time).toBe('09:05')
    expect(parseDay('27.10.2026 23:59')!.time).toBe('23:59')
    expect(parseDay('2026-10-27 24:00')).toBeNull()
    expect(parseDay('2026-10-27 10:60')).toBeNull()
  })

  it('несуществующие дни и мусор не даты', () => {
    expect(parseDay('2026-02-30')).toBeNull()
    expect(parseDay('2026-13-01')).toBeNull()
    expect(parseDay('1899-12-31')).toBeNull() // год от 1900 (как у DATE)
    expect(parseDay('привет')).toBeNull()
    expect(parseDay('2026.10.27')).toBeNull() // точки не в русском порядке
    expect(parseDay('1.2')).toBeNull() // это число, не дата
    expect(parseDay('')).toBeNull()
  })
})

describe('shiftDays', () => {
  it('«+1» — следующий календарный день, формат повторяет операнд', () => {
    expect(shiftDays('2026-10-27', 1)).toBe('2026-10-28')
    expect(shiftDays('27.10.2026', 1)).toBe('28.10.2026')
    expect(shiftDays('2026-10-27', 0)).toBe('2026-10-27')
  })

  it('переходы месяца, года и високосность', () => {
    expect(shiftDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDays('2024-02-28', 1)).toBe('2024-02-29') // високосный
    expect(shiftDays('2026-02-28', 1)).toBe('2026-03-01') // обычный год
    expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDays('2026-10-27', 100)).toBe('2027-02-04')
  })

  it('время сохраняется при сдвиге', () => {
    expect(shiftDays('2026-10-27 10:30', 1)).toBe('2026-10-28 10:30')
    expect(shiftDays('31.12.2026 08:00', 1)).toBe('01.01.2027 08:00')
  })

  it('не-дата даёт null', () => {
    expect(shiftDays('abc', 1)).toBeNull()
  })
})

describe('daysBetween', () => {
  it('разность дат в днях, в обе стороны', () => {
    expect(daysBetween('2026-10-28', '2026-10-27')).toBe(1)
    expect(daysBetween('2026-10-27', '2026-10-28')).toBe(-1)
    expect(daysBetween('2027-01-01', '06.01.2026')).toBe(360)
    expect(daysBetween('2026-10-27', '2026-10-27')).toBe(0)
  })

  it('с временем — дробные дни', () => {
    expect(daysBetween('2026-10-28 12:00', '2026-10-27 00:00')).toBe(1.5)
  })

  it('форматы смешиваются', () => {
    expect(daysBetween('28.10.2026', '2026-10-27')).toBe(1)
  })
})

describe('formatDay', () => {
  it('паддинг двухзначный в обоих форматах', () => {
    expect(formatDay({ y: 2026, m: 1, d: 5, time: null, ru: false })).toBe('2026-01-05')
    expect(formatDay({ y: 2026, m: 1, d: 5, time: '09:07', ru: true })).toBe('05.01.2026 09:07')
  })
})
