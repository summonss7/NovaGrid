import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  DARK_QUERY,
  resolvedOf,
  THEME_BG,
  THEME_SURFACE,
  watchSystemTheme,
  type ThemeDocument,
} from './theme'
import { useSettings } from '../i18n'

/*
 * Этап 7.2 «Тёмная тема» — юнит: резолв «Системы», применение темы к корню
 * (data-theme + meta theme-color), живая подписка на prefers-color-scheme,
 * стор настроек. DOM/matchMedia — заглушки (среда тестов node); живое
 * переключение в браузере проверяет tests/theme.spec.ts (e2e).
 */

function stubDoc(): { doc: ThemeDocument; dataset: { theme?: string }; meta: { content: string } } {
  const dataset: { theme?: string } = {}
  const meta = { content: '#ededeb' }
  const doc: ThemeDocument = {
    documentElement: { dataset },
    querySelector: (sel) => (sel === 'meta[name="theme-color"]' ? meta : null),
  }
  return { doc, dataset, meta }
}

/** mq-заглушка с ручным «изменением режима ОС» */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  const queried = { q: '' }
  const mq = {
    matches,
    addEventListener: (_type: string, h: () => void) => listeners.add(h),
    removeEventListener: (_type: string, h: () => void) => listeners.delete(h),
    fire: () => {
      for (const h of [...listeners]) h()
    },
  }
  vi.stubGlobal('window', {
    matchMedia: (q: string) => {
      queried.q = q
      return mq
    },
  })
  return { mq, queried }
}

afterEach(() => {
  vi.unstubAllGlobals()
  useSettings.setState({ theme: 'system', resolvedTheme: 'light' })
})

describe('resolvedOf: настройка → тема', () => {
  it('явные темы проходят как есть', () => {
    expect(resolvedOf('light', true)).toBe('light')
    expect(resolvedOf('dark', false)).toBe('dark')
  })

  it('«Система» следует prefers-color-scheme', () => {
    expect(resolvedOf('system', true)).toBe('dark')
    expect(resolvedOf('system', false)).toBe('light')
  })
})

describe('applyTheme: корень + PWA theme-color', () => {
  it('тёмная: data-theme=dark и meta = тёмный surface', () => {
    const { doc, dataset, meta } = stubDoc()
    applyTheme('dark', doc)
    expect(dataset.theme).toBe('dark')
    expect(meta.content).toBe(THEME_SURFACE.dark)
  })

  it('светлая: data-theme=light и meta = светлый surface', () => {
    const { doc, dataset, meta } = stubDoc()
    applyTheme('dark', doc)
    applyTheme('light', doc)
    expect(dataset.theme).toBe('light')
    expect(meta.content).toBe(THEME_SURFACE.light)
  })

  it('карты PWA-цветов согласованы с токенами (surface/bg обеих тем)', () => {
    expect(THEME_SURFACE).toEqual({ light: '#ededeb', dark: '#24282b' })
    expect(THEME_BG).toEqual({ light: '#ffffff', dark: '#191c1e' })
  })
})

describe('watchSystemTheme: живая реакция на режим ОС', () => {
  it('слушает prefers-color-scheme и снимается stop()', () => {
    const { mq, queried } = stubMatchMedia(true)
    const seen: boolean[] = []
    const watch = watchSystemTheme((dark) => seen.push(dark))

    expect(queried.q).toBe(DARK_QUERY)
    expect(seen).toEqual([]) // смена приходит только событием, не при подписке

    mq.fire()
    expect(seen).toEqual([true])

    watch.stop()
    mq.fire()
    expect(seen).toEqual([true]) // после stop больше не приходит
  })
})

describe('стор настроек: тема', () => {
  it('по умолчанию «Система»', () => {
    expect(useSettings.getState().theme).toBe('system')
  })

  it('setTheme меняет настройку, не трогая runtime-резолв', () => {
    useSettings.getState().setTheme('dark')
    expect(useSettings.getState().theme).toBe('dark')
    expect(useSettings.getState().resolvedTheme).toBe('light') // считает useThemeSync
  })
})
