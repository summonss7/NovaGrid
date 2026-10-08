import { Clock, FileSpreadsheet, FilePlus2, FlaskConical, FolderOpen, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ru } from '../i18n/ru'
import { deleteSession, listRecents, type SessionRow } from '../storage/db'
import { Logo } from './Logo'

interface StartScreenProps {
  onOpenFile: () => void
  onNewBook: () => void
  onOpenFixture: (url: string, name: string) => void
  onRestore: (row: SessionRow) => void
  /** занятость открытия — блокирует повторные клики */
  busy: string | null
}

/** Стартовый экран (Этап 2.4): Открыть · Новая · Недавние · демо-фикстуры. */
export function StartScreen(props: StartScreenProps) {
  const [recents, setRecents] = useState<SessionRow[] | null>(null)

  useEffect(() => {
    let alive = true
    void listRecents()
      .then((rows) => {
        if (alive) setRecents(rows)
      })
      .catch(() => setRecents([]))
    return () => {
      alive = false
    }
  }, [])

  const forget = useCallback(async (id: number) => {
    await deleteSession(id)
    setRecents((rows) => (rows ? rows.filter((r) => r.id !== id) : rows))
  }, [])

  return (
    <div className="start-screen">
      <div className="start-card">
        <div className="start-logo">
          <Logo />
        </div>
        <p className="start-tagline">{ru.startTagline}</p>

        <div className="start-actions">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={props.onOpenFile}
            disabled={props.busy !== null}
          >
            <FolderOpen size={18} strokeWidth={1.5} aria-hidden />
            {ru.openFileLabel}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-lg"
            onClick={props.onNewBook}
            disabled={props.busy !== null}
          >
            <FilePlus2 size={18} strokeWidth={1.5} aria-hidden />
            {ru.newBook}
          </button>
        </div>

        <section className="start-section" aria-label={ru.recentTitle}>
          <h2 className="start-section-title">
            <Clock size={14} strokeWidth={1.6} aria-hidden />
            {ru.recentTitle}
          </h2>
          {recents === null && <div className="start-recent-skeleton" aria-hidden />}
          {recents !== null && recents.length === 0 && (
            <p className="start-empty">{ru.recentEmpty}</p>
          )}
          {recents !== null && recents.length > 0 && (
            <ul className="start-recent-list">
              {recents.map((row) => (
                <li key={row.id} className="start-recent-item">
                  <button
                    type="button"
                    className="start-recent-open"
                    onClick={() => props.onRestore(row)}
                    disabled={props.busy !== null}
                  >
                    <FileSpreadsheet size={16} strokeWidth={1.5} aria-hidden />
                    <span className="start-recent-name">{row.fileName ?? ru.unsavedBook}</span>
                    <span className="start-recent-meta">
                      {ru.recentSavedAt(new Date(row.savedAt))} · {ru.recentCells(row.cells)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon start-recent-forget"
                    aria-label={ru.recentForgetTime}
                    title={ru.recentForgetTime}
                    onClick={() => void forget(row.id!)}
                  >
                    <X size={14} strokeWidth={1.7} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="start-section" aria-label={ru.demoSectionTitle}>
          <h2 className="start-section-title">
            <FlaskConical size={14} strokeWidth={1.6} aria-hidden />
            {ru.demoSectionTitle}
          </h2>
          <div className="start-demo-row">
            <button
              type="button"
              className="start-demo-card"
              onClick={() => props.onOpenFixture('fixtures/demo-book.xlsx', 'demo-book.xlsx')}
              disabled={props.busy !== null}
            >
              <FileSpreadsheet size={20} strokeWidth={1.5} aria-hidden />
              <span className="start-demo-title">{ru.demoBookTitle}</span>
              <span className="start-demo-hint">{ru.demoBookHint}</span>
            </button>
            <button
              type="button"
              className="start-demo-card"
              onClick={() => props.onOpenFixture('fixtures/stress-100k.csv', 'stress-100k.csv')}
              disabled={props.busy !== null}
            >
              <FlaskConical size={20} strokeWidth={1.5} aria-hidden />
              <span className="start-demo-title">{ru.stressBookTitle}</span>
              <span className="start-demo-hint">{ru.stressBookHint}</span>
            </button>
          </div>
        </section>

        <p className="start-privacy">{ru.startPrivacy}</p>
      </div>
    </div>
  )
}
