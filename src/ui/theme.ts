/*
 * Тёмная тема (Этап 7.2): применение настройки «Система / Светлая / Тёмная».
 *
 * data-theme='dark' на <html> включает тёмный набор токенов (tokens.css) —
 * CSS-поверхности перекрашиваются сами; канвас-грид подписан на resolvedTheme
 * стора настроек и перерисовывается темой из CSS-переменных без перезагрузки.
 * Первый кадр уже в верной теме: inline-скрипт index.html ставит data-theme
 * до отрисовки (логика зеркалит resolvedOf ниже).
 *
 * PWA: meta theme-color (окраска оболочки браузера/PWA) следует теме живьём;
 * манифест перекрашивается лучшим усилием (blob-копия с нужным theme_color) —
 * при офлайне/отсутствии манифеста тихо пропускается, это не критичный путь.
 */

import { useEffect } from 'react'
import { useSettings, type ResolvedTheme, type ThemePref } from '../i18n'

export const DARK_QUERY = '(prefers-color-scheme: dark)'

/** theme-color (оболочка браузера/PWA) = surface активной темы */
export const THEME_SURFACE: Record<ResolvedTheme, string> = { light: '#ededeb', dark: '#24282b' }
/** background_color манифеста (сплэш установки PWA) = bg активной темы */
export const THEME_BG: Record<ResolvedTheme, string> = { light: '#ffffff', dark: '#191c1e' }

/** Резолв настройки: «Система» смотрит prefers-color-scheme ОС. Чистая —
 *  юнит-тестируема без DOM; matchMedia-обёртка ниже — для живой реакции. */
export function resolvedOf(pref: ThemePref, prefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return prefersDark ? 'dark' : 'light'
  return pref
}

/** Минимальный DOM для applyTheme — юнит-тесты подставляют заглушку. */
export interface ThemeDocument {
  documentElement: { dataset: { theme?: string } }
  querySelector(selector: string): { content: string } | null
}

/** Поставить тему на корень: data-theme (токены) + meta theme-color (PWA). */
export function applyTheme(resolved: ResolvedTheme, doc: ThemeDocument = document): void {
  doc.documentElement.dataset.theme = resolved
  const meta = doc.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = THEME_SURFACE[resolved]
}

export interface SystemThemeWatch {
  stop(): void
}

/** Живая реакция на смену режима ОС (держится, пока тема = «Система»). */
export function watchSystemTheme(onChange: (prefersDark: boolean) => void): SystemThemeWatch {
  const mq = window.matchMedia(DARK_QUERY)
  const handler = () => onChange(mq.matches)
  mq.addEventListener('change', handler)
  return { stop: () => mq.removeEventListener('change', handler) }
}

let manifestJson: Record<string, unknown> | null = null
let manifestUrl = ''

/** PWA-манифест следует теме (лучшее усилие, см. шапку модуля). */
export async function patchManifestTheme(resolved: ResolvedTheme): Promise<void> {
  const link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null
  if (!link) return
  try {
    manifestJson ??= (await (await fetch(link.href)).json()) as Record<string, unknown>
    const patched = {
      ...manifestJson,
      theme_color: THEME_SURFACE[resolved],
      background_color: THEME_BG[resolved],
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(patched)], { type: 'application/manifest+json' }),
    )
    link.setAttribute('href', url)
    if (manifestUrl) URL.revokeObjectURL(manifestUrl)
    manifestUrl = url
  } catch {
    /* офлайн/нет манифеста — некритично, meta theme-color уже перекрашен */
  }
}

/** Реакция на настройку темы (вызывается из App): корень + PWA + resolvedTheme
 *  в сторе; «Система» слушает prefers-color-scheme через matchMedia живьём. */
export function useThemeSync(): void {
  const theme = useSettings((s) => s.theme)
  useEffect(() => {
    const apply = () => {
      const resolved = resolvedOf(theme, window.matchMedia(DARK_QUERY).matches)
      useSettings.setState({ resolvedTheme: resolved })
      applyTheme(resolved)
      void patchManifestTheme(resolved)
    }
    apply()
    if (theme !== 'system') return
    const watch = watchSystemTheme(() => apply())
    return () => watch.stop()
  }, [theme])
}
