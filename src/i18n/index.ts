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

export type Lang = 'ru' | 'en'
export type CsvDelimiter = ';' | ',' | '\t'
/** масштаб таблицы: применяется к зуму (5.3) при старте и смене настройки */
export type TableSize = 's' | 'm' | 'l' | 'xl'

export const TABLE_SIZE_SCALE: Record<TableSize, number> = { s: 0.85, m: 1, l: 1.15, xl: 1.3 }

interface SettingsState {
  lang: Lang
  tableSize: TableSize
  csvDelimiter: CsvDelimiter
  setLang: (lang: Lang) => void
  setTableSize: (size: TableSize) => void
  setCsvDelimiter: (d: CsvDelimiter) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      lang: 'ru',
      tableSize: 'm',
      csvDelimiter: ';',
      setLang: (lang) => set({ lang }),
      setTableSize: (tableSize) => set({ tableSize }),
      setCsvDelimiter: (csvDelimiter) => set({ csvDelimiter }),
    }),
    { name: 'novagrid-settings' },
  ),
)

const DICTS: Record<Lang, RuDict> = { ru, en }

/** Словарь текущего языка (вне React — по текущему состоянию стора). */
export function dict(): RuDict {
  return DICTS[useSettings.getState().lang]
}

/** Словарь интерфейса для компонентов: меняется со сменой языка (6.3). */
export function useT(): RuDict {
  const lang = useSettings((s) => s.lang)
  return DICTS[lang]
}

/** document.lang для скринридеров/IME вслед за языком интерфейса. */
export function useDocumentLang(): void {
  const lang = useSettings((s) => s.lang)
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
}
