import { useCallback, useEffect, useRef, useState } from 'react'
import { gridStore } from '../core/store'
import { ru } from '../i18n/ru'
import { installAutosave } from '../storage/autosave'
import type { SessionRow } from '../storage/db'
import {
  buildBookBuffer,
  csvMime,
  downloadBuffer,
  extToFormat,
  isFsaAvailable,
  openFixture,
  pickOpenFile,
  readBookFile,
  writeToHandle,
  xlsxMime,
} from '../io/fileActions'
import { FormulaBar } from '../ui/FormulaBar'
import { GridCanvas } from '../grid/GridCanvas'
import { SaveAsDialog, type SaveAsChoice, type SaveAsFormat } from '../ui/SaveAsDialog'
import { SheetsBar } from '../ui/SheetsBar'
import { StartScreen } from '../ui/StartScreen'
import { StatusBar } from '../ui/StatusBar'
import { Toolbar } from '../ui/Toolbar'

type Mode = 'boot' | 'start' | 'book'

interface Toast {
  text: string
  kind: 'ok' | 'error'
}

/**
 * Главный экран NovaGrid (один экран — роутинга в v1 нет, ARCHITECTURE §6).
 * Этап 2 добавляет стартовый экран «Недавние» и файловый цикл: открытие
 * (кнопка/перетаскивание), сохранение (прямая запись FSA или скачивание),
 * автосохранение сессии. Раскладка книги: тулбар → строка формул → грид →
 * панель листов → статус-бар (DESIGN-SYSTEM §6).
 */
export default function App() {
  const [mode, setMode] = useState<Mode>('boot')
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [dropping, setDropping] = useState(false)
  const bootedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef(0)

  const showToast = useCallback((text: string, kind: Toast['kind']) => {
    setToast({ text, kind })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4000)
  }, [])

  /** Файл → конвейер → книга на экране. Общий путь для input, drop, FSA, фикстур. */
  const openFile = useCallback(
    async (file: File) => {
      setBusy(ru.openingFile)
      try {
        await readBookFile(file)
        setMode('book')
      } catch (err) {
        showToast(
          `${ru.openErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        )
      } finally {
        setBusy(null)
      }
    },
    [showToast],
  )

  const onOpenClicked = useCallback(async () => {
    if (isFsaAvailable()) {
      try {
        const file = await pickOpenFile()
        if (file) await openFile(file)
      } catch (err) {
        // пикер недоступен/отменён — штатный input
        if (!(err instanceof DOMException && err.name === 'AbortError'))
          fileInputRef.current?.click()
      }
      return
    }
    fileInputRef.current?.click()
  }, [openFile])

  /** Ctrl+S: прямая запись в открытый файл, иначе — «Сохранить как…». */
  const save = useCallback(async () => {
    const st = gridStore.getState()
    if (st.edit) st.commitEdit('none')
    if (st.fileHandle && st.fileFormat && st.fileFormat !== 'xls') {
      setBusy(ru.savingFile)
      try {
        const buffer = await buildBookBuffer(
          st.fileFormat === 'csv' ? 'csv' : 'xlsx',
          st.csvDelimiter,
        )
        await writeToHandle(st.fileHandle, buffer)
        gridStore.getState().markSaved()
        showToast(ru.savedToast(st.fileName ?? ''), 'ok')
      } catch (err) {
        showToast(
          `${ru.saveErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        )
      } finally {
        setBusy(null)
      }
      return
    }
    setSaveAsOpen(true)
  }, [showToast])

  const saveAsChosen = useCallback(
    async (choice: SaveAsChoice) => {
      setSaveAsOpen(false)
      setBusy(ru.savingFile)
      try {
        const buffer = await buildBookBuffer(choice.format, choice.delimiter)
        if (isFsaAvailable()) {
          const handle = await window.showSaveFilePicker!({
            suggestedName: choice.fileName,
            types: [
              choice.format === 'xlsx'
                ? {
                    description: 'Excel (.xlsx)',
                    accept: { [xlsxMime()]: ['.xlsx'] },
                  }
                : { description: 'CSV (.csv)', accept: { [csvMime()]: ['.csv'] } },
            ],
          })
          await writeToHandle(handle, buffer)
          gridStore.getState().setFileHandle(handle)
        } else {
          downloadBuffer(choice.fileName, buffer, choice.format === 'csv' ? csvMime() : xlsxMime())
        }
        gridStore
          .getState()
          .markSaved(choice.fileName, { fileFormat: choice.format, csvDelimiter: choice.delimiter })
        showToast(ru.savedToast(choice.fileName), 'ok')
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return // отмена пикера
        showToast(
          `${ru.saveErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        )
      } finally {
        setBusy(null)
      }
    },
    [showToast],
  )

  const restoreSession = useCallback((row: SessionRow) => {
    gridStore
      .getState()
      .loadBook(
        { sheets: row.sheets },
        { fileName: row.fileName, fileFormat: extToFormat(row.fileName ?? '') },
      )
    // правки сессии не записаны в файл на диске — честно показываем ●
    gridStore.setState({ dirty: true })
    setMode('book')
  }, [])

  const openFixtureCard = useCallback(
    async (url: string, name: string) => {
      setBusy(ru.openingFile)
      try {
        await openFixture(new URL(url, document.baseURI).href, name)
        setMode('book')
      } catch (err) {
        showToast(
          `${ru.openErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        )
      } finally {
        setBusy(null)
      }
    },
    [showToast],
  )

  // ── старт: разбор режима (демо/стресс/стартовый экран) ───────────────
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    const params = new URLSearchParams(window.location.search)
    if (params.has('stress')) {
      const stress = params.get('stress')
      gridStore.getState().seedStress(Math.max(1, Math.trunc(Number(stress)) || 1000), 30)
      setMode('book')
    } else if (params.has('test')) {
      // детерминированный режим e2e Этапа 1: демо-лист без стартового экрана
      gridStore.getState().seedDemo()
      setMode('book')
    } else {
      setMode('start')
    }
  }, [])

  // ── автосохранение сессии (отдельный эффект: переживёт StrictMode) ──
  useEffect(() => installAutosave(), [])

  // ── горячие клавиши файлов (в режиме книги) ─────────────────────────
  useEffect(() => {
    if (mode !== 'book') return
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.code === 'KeyS') {
        e.preventDefault()
        if (e.shiftKey) setSaveAsOpen(true)
        else void save()
      } else if (e.code === 'KeyO') {
        e.preventDefault()
        void onOpenClicked()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, save, onOpenClicked])

  const suggestedName = gridStore.getState().fileName ?? ru.unsavedBook
  const defaultFormat: SaveAsFormat = gridStore.getState().fileFormat === 'csv' ? 'csv' : 'xlsx'

  return (
    <div
      className={`app-root${dropping ? ' app-root-dropping' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        const file = e.dataTransfer.files[0]
        if (file) void openFile(file)
      }}
    >
      {/* общий вход открытия: input живёт всегда — и на старте, и в книге */}
      <input
        ref={fileInputRef}
        id="nv-file-input"
        type="file"
        hidden
        accept=".xlsx,.xlsm,.xls,.csv,.tsv"
        aria-label={ru.fileInputLabel}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void openFile(file)
          e.target.value = ''
        }}
      />

      {mode === 'start' && (
        <StartScreen
          onOpenFile={() => void onOpenClicked()}
          onNewBook={() => {
            gridStore.getState().newBook()
            setMode('book')
          }}
          onOpenFixture={(url, name) => void openFixtureCard(url, name)}
          onRestore={restoreSession}
          busy={busy}
        />
      )}

      {mode === 'book' && (
        <div className="app-shell">
          <Toolbar
            onOpen={() => void onOpenClicked()}
            onSave={() => void save()}
            onSaveAs={() => setSaveAsOpen(true)}
          />
          <FormulaBar />
          <GridCanvas />
          <SheetsBar />
          <StatusBar />
        </div>
      )}

      {dropping && (
        <div className="drop-overlay" aria-hidden>
          <span>{ru.dropHere}</span>
        </div>
      )}

      {busy && (
        <div className="busy-overlay" role="status">
          <span className="busy-dot" aria-hidden />
          <span>{busy}</span>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="alert">
          {toast.text}
        </div>
      )}

      {saveAsOpen && (
        <SaveAsDialog
          suggestedName={suggestedName}
          defaultFormat={defaultFormat}
          defaultDelimiter={gridStore.getState().csvDelimiter}
          showXlsNote={gridStore.getState().fileFormat === 'xls'}
          onConfirm={(choice) => void saveAsChosen(choice)}
          onCancel={() => setSaveAsOpen(false)}
        />
      )}
    </div>
  )
}
