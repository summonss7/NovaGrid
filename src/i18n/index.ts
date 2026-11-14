/*
 * i18n и настройки пользователя (Этап 6.3): язык интерфейса ru/en (CONCEPT
 * §8: «русский основной + английский, переключатель в настройках»), размер
 * таблицы (масштаб шрифта/ячеек — применяется через зум Этапа 5.3) и
 * разделитель CSV по умолчанию для «Сохранить как…».
 *
 * Словарь — React-хук useT(): компонент перерисуется при смене языка.
 * Настройки живут в localStorage (persist): переживают перезагрузку и
 * офлайн-PWA. Импорт CSV продолжает авто-детект разделителя — настройка
 * касается только экспорта.
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ru, type RuDict } from './ru'
import { en } from './en'
import { ro } from './ro'
import { sk } from './sk'
import { ar } from './ar'

/** ru/en — Этап 6.3; ro/sk/ar — novagrid-070 */
export type Lang = 'ru' | 'en' | 'ro' | 'sk' | 'ar'
export type CsvDelimiter = ';' | ',' | '\t'
/** масштаб таблицы: применяется к зуму (5.3) при старте и смене настройки */
export type TableSize = 's' | 'm' | 'l' | 'xl'
/** тема интерфейса (7.2): «Система» следует prefers-color-scheme живьём */
export type ThemePref = 'system' | 'light' | 'dark'
/** тема после разрешения «Системы» — то, что реально стоит на <html> */
export type ResolvedTheme = 'light' | 'dark'
/**
 * Области интерфейса для меню «Вид» (novagrid-055): показать/скрыть.
 * format — панель шрифта/форматирования, formula — строка формул,
 * filters — панель активных фильтров, sheets — список листов,
 * status — строка состояния.
 */
export type PanelKey = 'format' | 'formula' | 'filters' | 'sheets' | 'status'
/** Вкладки листов (novagrid-055): один горизонтальный ряд или несколько. */
export type TabsLayout = 'single' | 'multi'

export const TABLE_SIZE_SCALE: Record<TableSize, number> = { s: 0.85, m: 1, l: 1.15, xl: 1.3 }

interface SettingsState {
  lang: Lang
  tableSize: TableSize
  csvDelimiter: CsvDelimiter
  theme: ThemePref
  /** видимость областей интерфейса — меню «Вид» (novagrid-055) */
  panels: Record<PanelKey, boolean>
  /** раскладка вкладок листов (novagrid-055): ряд или несколько рядов */
  tabsLayout: TabsLayout
  /** автоширина колонок по тексту (novagrid-067): режим вида, не данные */
  autoFitCols: boolean
  /** вычисленная тема (runtime, не персистится): на неё подписан канвас-грид */
  resolvedTheme: ResolvedTheme
  setLang: (lang: Lang) => void
  setTableSize: (size: TableSize) => void
  setCsvDelimiter: (d: CsvDelimiter) => void
  setTheme: (theme: ThemePref) => void
  setPanel: (key: PanelKey, visible: boolean) => void
  setTabsLayout: (layout: TabsLayout) => void
  setAutoFitCols: (on: boolean) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      lang: 'ru',
      tableSize: 'm',
      csvDelimiter: ';',
      theme: 'system',
      panels: { format: true, formula: true, filters: true, sheets: true, status: true },
      tabsLayout: 'single',
      autoFitCols: false,
      resolvedTheme: 'light',
      setLang: (lang) => set({ lang }),
      setTableSize: (tableSize) => set({ tableSize }),
      setCsvDelimiter: (csvDelimiter) => set({ csvDelimiter }),
      setTheme: (theme) => set({ theme }),
      setPanel: (key, visible) => set((s) => ({ panels: { ...s.panels, [key]: visible } })),
      setTabsLayout: (tabsLayout) => set({ tabsLayout }),
      setAutoFitCols: (autoFitCols) => set({ autoFitCols }),
    }),
    {
      name: 'novagrid-settings',
      // resolvedTheme — runtime-значение (считается из theme + ОС), не храним
      partialize: (s) => ({
        lang: s.lang,
        tableSize: s.tableSize,
        csvDelimiter: s.csvDelimiter,
        theme: s.theme,
        panels: s.panels,
        tabsLayout: s.tabsLayout,
        autoFitCols: s.autoFitCols,
      }),
    },
  ),
)

const DICTS: Record<Lang, RuDict> = { ru, en, ro, sk, ar }

/** Словарь текущего языка (вне React — по текущему состоянию стора). */
export function dict(): RuDict {
  return DICTS[useSettings.getState().lang]
}

/** Словарь интерфейса для компонентов: меняется со сменой языка (6.3). */
export function useT(): RuDict {
  const lang = useSettings((s) => s.lang)
  return DICTS[lang]
}

/** document.lang/dir для скринридеров/IME вслед за языком интерфейса;
 *  арабский разворачивает интерфейс справа налево (novagrid-070) —
 *  канвас-грид остаётся LTR (dir="ltr" на .grid-area): координаты мыши
 *  и колонки A1+ в RTL не переезжают. */
export function useDocumentLang(): void {
  const lang = useSettings((s) => s.lang)
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])
}
