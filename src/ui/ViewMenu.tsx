import { Check } from 'lucide-react'
import { useRef } from 'react'
import { useSettings, useT, type PanelKey, type TabsLayout } from '../i18n'
import { useMenuKeys } from './menuKeys'

/**
 * Меню «Вид» (novagrid-055): показать/скрыть области интерфейса — панель
 * форматирования (шрифт), строку формул, панель фильтров, список листов,
 * строку состояния — и раскладка вкладок листов: один ряд или несколькими
 * рядами по ширине окна (книги с десятками листов — без дальнего скролла).
 * Меню не закрывается на переключении: несколько галочек ставятся подряд,
 * закрытие — кликом по фону или Esc. Персист — novagrid-settings.
 */
export function ViewMenu(props: { onClose: () => void }) {
  const t = useT()
  const panels = useSettings((s) => s.panels)
  const tabsLayout = useSettings((s) => s.tabsLayout)
  const setPanel = useSettings((s) => s.setPanel)
  const setTabsLayout = useSettings((s) => s.setTabsLayout)
  const ref = useRef<HTMLDivElement>(null)
  useMenuKeys(ref, props.onClose, { itemSelector: '[role="menuitemcheckbox"]' })

  const items: readonly { key: PanelKey; label: string }[] = [
    { key: 'format', label: t.viewPanelFormat },
    { key: 'formula', label: t.viewPanelFormula },
    { key: 'filters', label: t.viewPanelFilters },
    { key: 'sheets', label: t.viewPanelSheets },
    { key: 'status', label: t.viewPanelStatus },
  ]
  const layouts: readonly { value: TabsLayout; label: string }[] = [
    { value: 'single', label: t.viewTabsSingle },
    { value: 'multi', label: t.viewTabsMulti },
  ]

  return (
    <>
      <div className="menu-backdrop" onClick={props.onClose} aria-hidden />
      <div ref={ref} className="tab-menu open-menu view-menu" role="menu" aria-label={t.viewMenuLabel}>
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            role="menuitemcheckbox"
            aria-checked={panels[it.key]}
            className="tab-menu-item"
            onClick={() => setPanel(it.key, !panels[it.key])}
          >
            <span className="view-check" aria-hidden>
              {panels[it.key] && <Check size={14} strokeWidth={1.7} />}
            </span>
            {it.label}
          </button>
        ))}
        <div className="view-menu-sep" aria-hidden />
        <div className="view-menu-row">
          <span className="view-menu-name">{t.viewTabsLayout}</span>
          <div className="settings-seg" role="group" aria-label={t.viewTabsLayout}>
            {layouts.map((l) => (
              <button
                key={l.value}
                type="button"
                className={`settings-seg-btn${tabsLayout === l.value ? ' is-active' : ''}`}
                aria-pressed={tabsLayout === l.value}
                onClick={() => setTabsLayout(l.value)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
