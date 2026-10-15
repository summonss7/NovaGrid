import { Clock, FileSpreadsheet, FolderOpen, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { deleteOpening, listOpenings } from '../storage/db'
import type { OpeningRow } from '../storage/recents'
import { useMenuKeys } from './menuKeys'

/**
 * Меню кнопки «Открыть» в режиме книги (novagrid-030): сверху пикер
 * «Открыть файл…» (прежнее поведение кнопки, Ctrl+O), ниже — ссылки на
 * последние открытые файлы. До карточки недавние были доступны только на
 * стартовом экране; теперь и при открытой книге. Показываем только openings —
 * реально открытые файлы: переоткрытие идёт через общий openRecent, который
 * на десктопе при открытой книге не занимает текущее окно, а открывает новое
 * (novagrid-025), — сессии автосейва сюда не влезают без этого правила.
 */

interface OpenMenuProps {
  /** выбор файла пикером — прежнее поведение кнопки «Открыть» */
  onBrowse: () => void
  /** переоткрытие недавнего файла (общий путь со стартовым экраном) */
  onOpenRecent: (row: OpeningRow) => void
  onClose: () => void
  /** мобильная нижняя панель: меню раскрывается вверх, а не вниз */
  up?: boolean
}

export function OpenMenu(props: OpenMenuProps) {
  const t = useT()
  const [openings, setOpenings] = useState<OpeningRow[] | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useMenuKeys(menuRef, props.onClose, { itemSelector: '[role="menuitem"]' })

  useEffect(() => {
    let alive = true
    void listOpenings()
      .then((rows) => {
        if (alive) setOpenings(rows)
      })
      .catch(() => {
        if (alive) setOpenings([])
      })
    return () => {
      alive = false
    }
  }, [])

  const forget = async (row: OpeningRow) => {
    if (row.id != null) await deleteOpening(row.id).catch(() => undefined)
    setOpenings((rows) => (rows ? rows.filter((r) => r.id !== row.id) : rows))
  }

  return (
    <>
      <div className="menu-backdrop" onClick={props.onClose} aria-hidden />
      <div
        ref={menuRef}
        className={`tab-menu open-menu${props.up ? ' open-menu-up' : ''}`}
        role="menu"
        aria-label={t.openMenuLabel}
      >
        <button
          type="button"
          role="menuitem"
          className="tab-menu-item open-menu-browse"
          onClick={() => {
            props.onClose()
            props.onBrowse()
          }}
        >
          <FolderOpen size={15} strokeWidth={1.5} aria-hidden />
          <span className="open-menu-browse-text">{t.openFileLabel}</span>
          <span className="open-menu-kbd" aria-hidden>
            Ctrl+O
          </span>
        </button>

        <div className="open-menu-title" aria-hidden>
          <Clock size={13} strokeWidth={1.6} />
          {t.recentTitle}
        </div>

        {openings === null && <div className="open-menu-skeleton" aria-hidden />}
        {openings !== null && openings.length === 0 && (
          <p className="open-menu-empty">{t.openMenuEmpty}</p>
        )}
        {openings !== null &&
          openings.map((row) => (
            <div key={row.id} className="open-menu-row">
              <button
                type="button"
                role="menuitem"
                className="open-menu-recent"
                title={row.path ?? row.fileName}
                onClick={() => {
                  props.onClose()
                  props.onOpenRecent(row)
                }}
              >
                <FileSpreadsheet size={15} strokeWidth={1.5} aria-hidden />
                <span className="open-menu-names">
                  <span className="open-menu-name">{row.fileName}</span>
                  <span className="open-menu-meta">{t.recentOpenedAt(new Date(row.openedAt))}</span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="btn btn-ghost btn-icon open-menu-forget"
                aria-label={t.recentForgetTime}
                title={t.recentForgetTime}
                onClick={() => void forget(row)}
              >
                <X size={13} strokeWidth={1.7} aria-hidden />
              </button>
            </div>
          ))}
      </div>
    </>
  )
}
