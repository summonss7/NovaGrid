import { Clock, FileSpreadsheet, FilePlus2, FlaskConical, FolderOpen, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useT } from '../i18n'
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
  const t = useT()
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
              {recents.map((row) => (
                <li key={row.id} className="start-recent-item">
                  <button
                    type="button"
                    className="start-recent-open"
                    onClick={() => props.onRestore(row)}
                    disabled={props.busy !== null}
                  >
                    <FileSpreadsheet size={16} strokeWidth={1.5} aria-hidden />
                    <span className="start-recent-name">{row.fileName ?? t.unsavedBook}</span>
                    <span className="start-recent-meta">
                      {t.recentSavedAt(new Date(row.savedAt))} · {t.recentCells(row.cells)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon start-recent-forget"
                    aria-label={t.recentForgetTime}
                    title={t.recentForgetTime}
                    onClick={() => void forget(row.id!)}
                  >
                    <X size={14} strokeWidth={1.7} aria-hidden />
                  </button>
                </li>
              ))}
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
