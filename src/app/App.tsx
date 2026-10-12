import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { gridStore } from '../core/store'
import { printStore } from '../core/print'
import { TABLE_SIZE_SCALE, useDocumentLang, useSettings, useT } from '../i18n'
import { installAutosave } from '../storage/autosave'
import { recordOpening, type SessionRow } from '../storage/db'
import type { OpeningRow } from '../storage/recents'
import { onPwaUpdate, registerServiceWorker } from '../pwa/registerSW'
import { zoomStore } from '../grid/zoom'
import {
  buildBookBuffer,
  csvMime,
  downloadBuffer,
  ensureReadPermission,
  extToFormat,
  isFsaAvailable,
  openFixture,
  pickOpenFile,
  readBookFile,
  writeToHandle,
  xlsxMime,
} from '../io/fileActions'
import {
  desktopOpenBook,
  desktopOpenPath,
  desktopPickSavePath,
  desktopStartupBook,
  desktopWriteFile,
  isDesktop,
  onDesktopMenu,
} from '../io/desktop'
import { FilterBar } from '../ui/FilterBar'
import { FormulaBar } from '../ui/FormulaBar'
import { GridCanvas } from '../grid/GridCanvas'
import { MobileBar } from '../ui/MobileBar'
import { PrintDialog } from '../ui/PrintDialog'
import { PrintView } from '../ui/PrintView'
import { ReplaceHost } from '../ui/ReplaceDialog'
import { SaveAsDialog, type SaveAsChoice, type SaveAsFormat } from '../ui/SaveAsDialog'
import { SheetsBar } from '../ui/SheetsBar'
import { StartScreen } from '../ui/StartScreen'
import { StatusBar } from '../ui/StatusBar'
import { Toolbar } from '../ui/Toolbar'
import { useThemeSync } from '../ui/theme'

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
  const t = useT()
  const [mode, setMode] = useState<Mode>('boot')
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [swReload, setSwReload] = useState<(() => void) | null>(null)
  const printOpen = useStore(printStore, (s) => s.dialogOpen)
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
    async (file: File, meta?: { path?: string; handle?: FileSystemFileHandle; key?: string }) => {
      setBusy(t.openingFile)
      try {
        await readBookFile(file)
        // loadBook сбрасывает fileHandle/desktopPath — восстанавливаем после него
        if (meta?.handle) gridStore.getState().setFileHandle(meta.handle)
        if (meta?.path) gridStore.getState().setDesktopPath(meta.path)
        // «Недавние» (novagrid-022): открытые файлы попадают в список сразу,
        // не дожидаясь автосохранения сессии (которое большие книги пропускает)
        void recordOpening(file, meta).catch(() => undefined)
        setMode('book')
      } catch (err) {
        showToast(
          `${t.openErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        )
      } finally {
        setBusy(null)
      }
    },
[showToast, t],
  )

  /** Переоткрытие файла из «Недавних» (novagrid-022): путь / FSA-хэндл / снимок. */
  const openRecent = useCallback(
    async (row: OpeningRow) => {
      setBusy(t.openingFile)
      try {
        if (row.path && isDesktop()) {
          const book = await desktopOpenPath(row.path)
          await openFile(book.file, { path: row.path, key: row.key })
        } else if (row.handle) {
          if (!(await ensureReadPermission(row.handle))) {
            showToast(t.recentNoAccess, 'error')
            return
          }
          const file = await row.handle.getFile()
          await openFile(file, { handle: row.handle, key: row.key })
        } else if (row.bytes) {
          await openFile(new File([row.bytes], row.fileName), { key: row.key })
        } else {
          showToast(t.recentUnavailable, 'error')
        }
      } catch (err) {
        showToast(
          `${t.openErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        )
      } finally {
        setBusy(null)
      }
    },
    [openFile, showToast, t],
  )

  const onOpenClicked = useCallback(async () => {
    // десктоп-обёртка (Этап 7.5): нативный диалог rfd вместо FSA/инпута
    if (isDesktop()) {
      try {
        const book = await desktopOpenBook()
        if (book) await openFile(book.file, { path: book.path })
      } catch (err) {
        showToast(
          `${t.openErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        )
      }
      return
    }
    if (isFsaAvailable()) {
      try {
        const picked = await pickOpenFile()
        if (picked) await openFile(picked.file, { handle: picked.handle })
      } catch (err) {
        // пикер недоступен/отменён — штатный input
        if (!(err instanceof DOMException && err.name === 'AbortError'))
          fileInputRef.current?.click()
      }
      return
    }
    fileInputRef.current?.click()
  }, [openFile, showToast, t])

  /** Ctrl+S: прямая запись в открытый файл, иначе — «Сохранить как…». */
  const save = useCallback(async () => {
    const st = gridStore.getState()
    if (st.edit) st.commitEdit('none')
    // .xls/.ods напрямую не пишем — только конверт в .xlsx/.csv через диалог
    const directFormat = st.fileFormat === 'csv' || st.fileFormat === 'xlsx'
    // десктоп-обёртка: прямая запись по пути вместо FSA-хэндла
    if (isDesktop()) {
      if (st.desktopPath && st.fileFormat && directFormat) {
        setBusy(t.savingFile)
        try {
          const buffer = await buildBookBuffer(
            st.fileFormat === 'csv' ? 'csv' : 'xlsx',
            st.csvDelimiter,
          )
          await desktopWriteFile(st.desktopPath, buffer)
          gridStore.getState().markSaved()
          showToast(t.savedToast(st.fileName ?? ''), 'ok')
        } catch (err) {
          showToast(
            `${t.saveErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
            'error',
          )
        } finally {
          setBusy(null)
        }
        return
      }
      setSaveAsOpen(true)
      return
    }
    if (st.fileHandle && st.fileFormat && directFormat) {
      setBusy(t.savingFile)
      try {
        const buffer = await buildBookBuffer(
          st.fileFormat === 'csv' ? 'csv' : 'xlsx',
          st.csvDelimiter,
        )
        await writeToHandle(st.fileHandle, buffer)
        gridStore.getState().markSaved()
        showToast(t.savedToast(st.fileName ?? ''), 'ok')
      } catch (err) {
        showToast(
          `${t.saveErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        )
      } finally {
        setBusy(null)
      }
      return
    }
    setSaveAsOpen(true)
  }, [showToast, t])

  const saveAsChosen = useCallback(
    async (choice: SaveAsChoice) => {
      setSaveAsOpen(false)
      setBusy(t.savingFile)
      try {
        const buffer = await buildBookBuffer(choice.format, choice.delimiter)
        if (isDesktop()) {
          // нативный «Сохранить как…» обёртки (rfd); отмена — тихо
          const path = await desktopPickSavePath(choice.fileName, choice.format)
          if (path === null) return
          await desktopWriteFile(path, buffer)
          const name = path.replace(/\\/g, '/').split('/').pop() ?? choice.fileName
          gridStore.getState().setDesktopPath(path)
          gridStore
            .getState()
            .markSaved(name, { fileFormat: choice.format, csvDelimiter: choice.delimiter })
          showToast(t.savedToast(name), 'ok')
        } else if (isFsaAvailable()) {
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
        showToast(t.savedToast(choice.fileName), 'ok')
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return // отмена пикера
        showToast(
          `${t.saveErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        )
      } finally {
        setBusy(null)
      }
    },
[showToast, t],
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
      setBusy(t.openingFile)
      try {
        await openFixture(new URL(url, document.baseURI).href, name)
        setMode('book')
      } catch (err) {
        showToast(
          `${t.openErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        )
      } finally {
        setBusy(null)
      }
    },
[showToast, t],
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

  // ── десктоп-обёртка (Этап 7.5): книга из аргумента запуска ──────────
  // (ассоциации .xlsx/.csv/.xls/.ods: «NovaGrid.exe <путь>»); startup_book
  // отвечает один раз, повторный вызов после смены языка вернёт null
  useEffect(() => {
    if (!isDesktop()) return
    let alive = true
    void desktopStartupBook().then((book) => {
      if (alive && book) void openFile(book.file, { path: book.path })
    })
    return () => {
      alive = false
    }
  }, [openFile])

  // ── десктоп-обёртка: нативное меню «Файл» → те же обработчики ───────
  useEffect(() => {
    if (!isDesktop()) return
    return onDesktopMenu((action) => {
      if (action === 'open') void onOpenClicked()
      else if (action === 'save') void save()
      else if (action === 'save-as') setSaveAsOpen(true)
      else if (action === 'print') printStore.getState().openDialog()
    })
  }, [onOpenClicked, save])

  // ── настройки (6.3): размер таблицы из персиста — стартовый зум, ─────
  // document.lang для скринридеров идёт за языком интерфейса;
  // тема (7.2) применяется живьём (data-theme + PWA theme-color)
  useDocumentLang()
  useThemeSync()
  useEffect(() => {
    const { tableSize, csvDelimiter } = useSettings.getState()
    zoomStore.getState().setZoom(TABLE_SIZE_SCALE[tableSize])
    gridStore.getState().setCsvDelimiter(csvDelimiter)
  }, [])

  // ── PWA (Этап 5.1): офлайн-оболочка + обновление по кнопке ──────────
  // (registerServiceWorker гасит и Safari-пинч страницы — см. pwa/registerSW;
  // в десктоп-обёртке SW не нужен: контент уже в exe, тосты обновления ни к чему)
  useEffect(() => {
    if (isDesktop()) return
    registerServiceWorker()
    return onPwaUpdate((reload) => setSwReload(() => reload))
  }, [])

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
      } else if (e.code === 'KeyP') {
        // печать — через диалог настроек (Этап 7.4), не системный предпросмотр
        e.preventDefault()
        printStore.getState().openDialog()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, save, onOpenClicked])

  const suggestedName = gridStore.getState().fileName ?? t.unsavedBook
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
        accept=".xlsx,.xlsm,.xls,.ods,.csv,.tsv"
        aria-label={t.fileInputLabel}
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
          onOpenRecent={(row) => void openRecent(row)}
          busy={busy}
        />
      )}

      {mode === 'book' && (
        <>
          <div className="app-shell">
            <Toolbar
              onOpen={() => void onOpenClicked()}
              onSave={() => void save()}
              onSaveAs={() => setSaveAsOpen(true)}
            />
            <FilterBar />
            <FormulaBar />
            <GridCanvas />
            <SheetsBar />
            <StatusBar />
            <MobileBar onOpen={() => void onOpenClicked()} />
            <ReplaceHost />
          </div>
          {/* печатная страница (Этап 7.4): прямой ребёнок app-root — в @media print
              виден только он, весь интерфейс скрыт одним CSS-правилом */}
          <PrintView />
        </>
      )}

      {swReload && (
        <div className="pwa-update" role="alert">
          <span>{t.pwaUpdateTitle}</span>
          <button type="button" className="btn btn-primary" onClick={() => swReload()}>
            {t.pwaUpdateAction}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={t.pwaUpdateDismiss}
            onClick={() => setSwReload(null)}
          >
            {t.pwaUpdateDismiss}
          </button>
        </div>
      )}

      {dropping && (
        <div className="drop-overlay" aria-hidden>
          <span>{t.dropHere}</span>
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
          convertNote={
            gridStore.getState().fileFormat === 'xls'
              ? t.xlsSaveNote
              : gridStore.getState().fileFormat === 'ods'
                ? t.odsSaveNote
                : null
          }
          onConfirm={(choice) => void saveAsChosen(choice)}
          onCancel={() => setSaveAsOpen(false)}
        />
      )}

      {printOpen && <PrintDialog onClose={() => printStore.getState().closeDialog()} />}
    </div>
  )
}
