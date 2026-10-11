import { X } from 'lucide-react'
import { useRef } from 'react'
import {
  TABLE_SIZE_SCALE,
  useSettings,
  useT,
  type CsvDelimiter,
  type Lang,
  type TableSize,
  type ThemePref,
} from '../i18n'
import { zoomStore } from '../grid/zoom'
import { gridStore } from '../core/store'
import { useMenuKeys } from './menuKeys'

/**
 * Настройки (Этап 6.3): язык интерфейса ru/en, размер таблицы (масштаб
 * ячеек/шрифта через зум 5.3 — переживает перезагрузку), разделитель CSV
 * по умолчанию для «Сохранить как…». Этап 7.2 добавляет тему
 * «Система / Светлая / Тёмная» (применяется живьём, см. ui/theme.ts).
 * Персист — localStorage (novagrid-settings).
 */
export function SettingsDialog(props: { onClose: () => void }) {
  const t = useT()
  const { lang, tableSize, csvDelimiter, theme, setLang, setTableSize, setCsvDelimiter, setTheme } =
    useSettings()
  const ref = useRef<HTMLDivElement>(null)
  useMenuKeys(ref, props.onClose, { itemSelector: null, autoFocusSelector: '.settings-close' })

  const pickSize = (size: TableSize) => {
    setTableSize(size)
    zoomStore.getState().setZoom(TABLE_SIZE_SCALE[size])
  }

  /** разделитель применяется и в текущую книгу (открытие файла вернёт детект) */
  const pickDelimiter = (d: CsvDelimiter) => {
    setCsvDelimiter(d)
    gridStore.getState().setCsvDelimiter(d)
  }

  const langs: readonly { value: Lang; label: string }[] = [
    { value: 'ru', label: 'Русский' },
    { value: 'en', label: 'English' },
  ]
  const themes: readonly { value: ThemePref; label: string }[] = [
    { value: 'system', label: t.settingsThemeSystem },
    { value: 'light', label: t.settingsThemeLight },
    { value: 'dark', label: t.settingsThemeDark },
  ]
  const sizes: readonly { value: TableSize; label: string }[] = [
    { value: 's', label: t.settingsSizeS },
    { value: 'm', label: t.settingsSizeM },
    { value: 'l', label: t.settingsSizeL },
    { value: 'xl', label: t.settingsSizeXL },
  ]
  const delims: readonly { value: CsvDelimiter; label: string }[] = [
    { value: ';', label: t.semicolon },
    { value: ',', label: t.comma },
    { value: '\t', label: t.tab },
  ]
  const seg = (active: boolean) => `settings-seg-btn${active ? ' is-active' : ''}`

  return (
    <div className="menu-backdrop" onContextMenu={(e) => e.preventDefault()}>
      <div ref={ref} className="settings-dialog" role="dialog" aria-modal="true" aria-label={t.settingsTitle}>
        <div className="settings-head">
          <h2>{t.settingsTitle}</h2>
          <button
            type="button"
            className="btn btn-ghost btn-icon settings-close"
            aria-label={t.settingsClose}
            onClick={props.onClose}
          >
            <X size={16} strokeWidth={1.7} aria-hidden />
          </button>
        </div>

        <label className="settings-row">
          <span className="settings-name">{t.settingsLang}</span>
          <div className="settings-seg" role="group" aria-label={t.settingsLang}>
            {langs.map((l) => (
              <button
                key={l.value}
                type="button"
                className={seg(lang === l.value)}
                aria-pressed={lang === l.value}
                onClick={() => setLang(l.value)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </label>

        <label className="settings-row">
          <span className="settings-name">{t.settingsTheme}</span>
          <div className="settings-seg" role="group" aria-label={t.settingsTheme}>
            {themes.map((th) => (
              <button
                key={th.value}
                type="button"
                className={seg(theme === th.value)}
                aria-pressed={theme === th.value}
                onClick={() => setTheme(th.value)}
              >
                {th.label}
              </button>
            ))}
          </div>
        </label>

        <label className="settings-row">
          <span className="settings-name">{t.settingsTableSize}</span>
          <div className="settings-seg" role="group" aria-label={t.settingsTableSize}>
            {sizes.map((s) => (
              <button
                key={s.value}
                type="button"
                className={seg(tableSize === s.value)}
                aria-pressed={tableSize === s.value}
                onClick={() => pickSize(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </label>

        <label className="settings-row">
          <span className="settings-name">{t.settingsCsvDelimiter}</span>
          <div className="settings-seg" role="group" aria-label={t.settingsCsvDelimiter}>
            {delims.map((d) => (
              <button
                key={d.value}
                type="button"
                className={seg(csvDelimiter === d.value)}
                aria-pressed={csvDelimiter === d.value}
                onClick={() => pickDelimiter(d.value)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </label>
      </div>
    </div>
  )
}
