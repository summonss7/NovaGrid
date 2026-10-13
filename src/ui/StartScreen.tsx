import { Clock, FileSpreadsheet, FilePlus2, FlaskConical, FolderOpen, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useT } from '../i18n'
import { deleteOpening, deleteSession, deleteUnnamedSessions, listOpenings, listRecents } from '../storage/db'
import { mergeRecents, type OpeningRow, type RecentItem } from '../storage/recents'
import type { SessionRow } from '../storage/db'
import { Logo } from './Logo'

interface StartScreenProps {
  onOpenFile: () => void
  onNewBook: () => void
  onOpenFixture: (url: string, name: string) => void
  onRestore: (row: SessionRow) => void
  /** переоткрытие файла из «Недавних» (novagrid-022) */
  onOpenRecent: (row: OpeningRow) => void
  /** занятость открытия — блокирует повторные клики */
  busy: string | null
}

/** Стартовый экран (Этап 2.4): Открыть · Новая · Недавние · демо-фикстуры. */
export function StartScreen(props: StartScreenProps) {
  const t = useT()
  const [recents, setRecents] = useState<RecentItem[] | null>(null)

  useEffect(() => {
    let alive = true
    // novagrid-026: вычищаем осиротевшие сессии несохранённых книг —
    // в списке их больше не показываем, базе они тоже не нужны
    void deleteUnnamedSessions().catch(() => undefined)
    void Promise.all([listOpenings(), listRecents()])
      .then(([openings, sessions]) => {
        if (alive) setRecents(mergeRecents(openings, sessions))
      })
      .catch(() => setRecents([]))
    return () => {
      alive = false
    }
  }, [])

  const forget = useCallback(async (item: RecentItem) => {
    const id = item.kind === 'open' ? item.opening.id : item.session.id
    if (id != null) {
      if (item.kind === 'open') await deleteOpening(id)
      else await deleteSession(id)
    }
    setRecents((rows) =>
      rows
        ? rows.filter((r) => {
            const rid = r.kind === 'open' ? r.opening.id : r.session.id
            return !(r.kind === item.kind && rid === id)
          })
        : rows,
    )
  }, [])

  return (
    <div className="start-screen">
      <div className="start-card">
        <div className="start-logo">
          <Logo />
        </div>
        <p className="start-tagline">{t.startTagline}</p>

        <div className="start-actions">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={props.onOpenFile}
            disabled={props.busy !== null}
          >
            <FolderOpen size={18} strokeWidth={1.5} aria-hidden />
            {t.openFileLabel}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-lg"
            onClick={props.onNewBook}
            disabled={props.busy !== null}
          >
            <FilePlus2 size={18} strokeWidth={1.5} aria-hidden />
            {t.newBook}
          </button>
        </div>

        <section className="start-section" aria-label={t.recentTitle}>
          <h2 className="start-section-title">
            <Clock size={14} strokeWidth={1.6} aria-hidden />
            {t.recentTitle}
          </h2>
          {recents === null && <div className="start-recent-skeleton" aria-hidden />}
          {recents !== null && recents.length === 0 && (
            <p className="start-empty">{t.recentEmpty}</p>
          )}
          {recents !== null && recents.length > 0 && (
            <ul className="start-recent-list">
              {recents.map((item) => {
                const name =
                  item.kind === 'open' ? item.opening.fileName : (item.session.fileName ?? null)
                return (
                  <li key={item.kind === 'open' ? `o${item.opening.id}` : `s${item.session.id}`} className="start-recent-item">
                    <button
                      type="button"
                      className="start-recent-open"
                      title={item.kind === 'open' ? item.opening.path : undefined}
                      onClick={() =>
                        item.kind === 'open'
                          ? props.onOpenRecent(item.opening)
                          : props.onRestore(item.session)
                      }
                      disabled={props.busy !== null}
                    >
                      <FileSpreadsheet size={16} strokeWidth={1.5} aria-hidden />
                      <span className="start-recent-name">{name ?? t.unsavedBook}</span>
                      <span className="start-recent-meta">
                        {item.kind === 'open'
                          ? t.recentOpenedAt(new Date(item.opening.openedAt))
                          : `${t.recentSavedAt(new Date(item.session.savedAt))} · ${t.recentCells(item.session.cells)}`}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon start-recent-forget"
                      aria-label={t.recentForgetTime}
                      title={t.recentForgetTime}
                      onClick={() => void forget(item)}
                    >
                      <X size={14} strokeWidth={1.7} aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="start-section" aria-label={t.demoSectionTitle}>
          <h2 className="start-section-title">
            <FlaskConical size={14} strokeWidth={1.6} aria-hidden />
            {t.demoSectionTitle}
          </h2>
          <div className="start-demo-row">
            <button
              type="button"
              className="start-demo-card"
              onClick={() => props.onOpenFixture('fixtures/demo-book.xlsx', 'demo-book.xlsx')}
              disabled={props.busy !== null}
            >
              <FileSpreadsheet size={20} strokeWidth={1.5} aria-hidden />
              <span className="start-demo-title">{t.demoBookTitle}</span>
              <span className="start-demo-hint">{t.demoBookHint}</span>
            </button>
            <button
              type="button"
              className="start-demo-card"
              onClick={() => props.onOpenFixture('fixtures/ods-book.ods', 'ods-book.ods')}
              disabled={props.busy !== null}
            >
              <FileSpreadsheet size={20} strokeWidth={1.5} aria-hidden />
              <span className="start-demo-title">{t.demoOdsTitle}</span>
              <span className="start-demo-hint">{t.demoOdsHint}</span>
            </button>
            <button
              type="button"
              className="start-demo-card"
              onClick={() => props.onOpenFixture('fixtures/stress-100k.csv', 'stress-100k.csv')}
              disabled={props.busy !== null}
            >
              <FlaskConical size={20} strokeWidth={1.5} aria-hidden />
              <span className="start-demo-title">{t.stressBookTitle}</span>
              <span className="start-demo-hint">{t.stressBookHint}</span>
            </button>
          </div>
        </section>

        <p className="start-privacy">{t.startPrivacy}</p>
      </div>
    </div>
  )
}
