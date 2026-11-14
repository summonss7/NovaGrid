import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { gridStore } from '../core/store'
import { printStore } from '../core/print'
import { TABLE_SIZE_SCALE, useDocumentLang, useSettings, useT, type PanelKey } from '../i18n'
import { installAutosave } from '../storage/autosave'
import { OPENING_BYTES_LIMIT, openingKey, recordOpening, type SessionRow } from '../storage/db'
import type { OpeningRow } from '../storage/recents'
import {
  applyViewState,
  beginViewStateTracking,
  installViewStateSync,
  restoreViewState,
  trackingKey,
} from '../storage/viewState'
import { installTitleSync } from './titleSync'
import { onPwaUpdate, registerServiceWorker } from '../pwa/registerSW'
import { zoomStore } from '../grid/zoom'
import {
  buildBookBuffer,
  buildSnapshotBuffer,
  csvMime,
  downloadBuffer,
  ensureReadPermission,
  extToFormat,
  isFsaAvailable,
  odsMime,
  openFixture,
  pickOpenFile,
  readBookFile,
  writeToHandle,
  xlsxMime,
} from '../io/fileActions'
import {
  decryptSnapshot,
  isSnapshotName,
  snapshotToBook,
} from '../io/snapshot'
import {
  desktopConfirmClose,
  desktopOpenBookWindow,
  desktopOpenPath,
  desktopPickBookPaths,
  desktopPickSavePath,
  desktopSetDirty,
  desktopSetMenuLang,
  desktopStageBookBytes,
  desktopStartupBooks,
  desktopTakeStagedBook,
  desktopWindowLabel,
  desktopWriteFile,
  isDesktop,
  onDesktopCloseAsk,
  onDesktopMenu,
} from '../io/desktop'
import {
  androidTakeOpenFile,
  isTauriMobile,
  mobilePickSavePath,
  mobileWriteFile,
  onAndroidOpenPush,
} from '../io/mobile'
import { useUpdaterStore } from '../io/updater'
import { CloseAskDialog } from '../ui/CloseAskDialog'
import { FilterBar } from '../ui/FilterBar'
import { FormatBar } from '../ui/FormatBar'
import { FormulaBar } from '../ui/FormulaBar'
import { GridCanvas } from '../grid/GridCanvas'
import { MobileBar } from '../ui/MobileBar'
import { PrintDialog } from '../ui/PrintDialog'
import { PrintView } from '../ui/PrintView'
import { ReplaceHost } from '../ui/ReplaceDialog'
import { SaveAsDialog, type SaveAsChoice, type SaveAsFormat } from '../ui/SaveAsDialog'
import { SheetsBar } from '../ui/SheetsBar'
import { SnapshotDialog } from '../ui/SnapshotDialog'
import { StartScreen } from '../ui/StartScreen'
import { StatusBar } from '../ui/StatusBar'
import { Toolbar } from '../ui/Toolbar'
import { UpdateDialog } from '../ui/UpdateDialog'
import { useThemeSync } from '../ui/theme'

type Mode = 'boot' | 'start' | 'book'

interface Toast {
  text: string
  kind: 'ok' | 'error'
}

/**
 * Закрытие окна после «Сохранить как…», запущенного из диалога закрытия
 * (novagrid-033): флаг живёт в ref (не в состоянии — его видит только этот
 * сценарий). close=false — пользователь отменил пикер или снял снапшот:
 * остаёмся в книге, окно не закрываем.
 */
function settleCloseAfterSave(ref: { current: boolean }, close: boolean): void {
  if (!ref.current) return
  ref.current = false
  if (close) void desktopConfirmClose()
}

/** Прочитанная капсула .nvgridx — ждёт парольную фразу в диалоге (7.6). */
interface SnapshotPending {
  file: File
  buffer: ArrayBuffer
  meta?: { path?: string; handle?: FileSystemFileHandle; key?: string }
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
  const [closeAskOpen, setCloseAskOpen] = useState(false)
  const [snapshotPending, setSnapshotPending] = useState<SnapshotPending | null>(null)
  const [dropping, setDropping] = useState(false)
  const [swReload, setSwReload] = useState<(() => void) | null>(null)
  const printOpen = useStore(printStore, (s) => s.dialogOpen)
  const updOpen = useStore(useUpdaterStore, (s) => s.dialogOpen)
  // «Вид» (novagrid-055): видимость областей — персист из настроек
  const panels = useSettings((s) => s.panels)
  const showPanel = (key: PanelKey) => panels[key]
  const bootedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef(0)
  /** «Сохранить как…» открыт из диалога закрытия — закрыть окно после записи */
  const closeAfterSaveRef = useRef(false)

  const showToast = useCallback((text: string, kind: Toast['kind']) => {
    setToast({ text, kind })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4000)
  }, [])

  /** Файл → конвейер → книга на экране. Общий путь для input, drop, FSA, фикстур. */
  const openFile = useCallback(
    async (file: File, meta?: { path?: string; handle?: FileSystemFileHandle; key?: string }) => {
      // капсула .nvgridx (7.6): расшифровка требует фразу — отдельный диалог,
      // книга ставится на экран после него (openSnapshot)
      if (isSnapshotName(file.name)) {
        setSnapshotPending({ file, buffer: await file.arrayBuffer(), meta })
        return
      }
      // память позиции (novagrid-037): ключ переключается до загрузки —
      // прежняя книга успевает дослать свою позицию; неудачное открытие
      // откатывает отслеживание назад
      const viewKey = openingKey(file, meta)
      const prevKey = trackingKey()
      beginViewStateTracking(viewKey)
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
        // «где я был» (novagrid-037): вернуть курсор на запомненный лист/строку
        const saved = await restoreViewState(viewKey)
        if (saved) applyViewState(saved)
      } catch (err) {
        beginViewStateTracking(prevKey)
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

  /**
   * Доп. книги — в отдельные нативные окна (novagrid-023): каждая книга своё
   * окно, как классические табличные редакторы Windows. Окно читает книгу
   * само по ?file=; тост объясняет, куда делись остальные файлы.
   */
  const openRestInWindows = useCallback(
    async (paths: string[]) => {
      for (const path of paths) {
        await desktopOpenBookWindow(`file=${encodeURIComponent(path)}`)
      }
      showToast(t.extraWindowsToast(paths.length), 'ok')
    },
    [showToast, t],
  )

  /** Переоткрытие файла из «Недавних» (novagrid-022): путь / FSA-хэндл / снимок. */
  const openRecent = useCallback(
    async (row: OpeningRow) => {
      // книга уже на экране (десктоп) — не заменяем её, файл в новое окно
      // (novagrid-025): «Недавние» подчиняются тому же правилу, что Ctrl+O
      if (isDesktop() && mode === 'book') {
        try {
          if (row.path) {
            await desktopOpenBookWindow(`file=${encodeURIComponent(row.path)}`)
          } else if (row.bytes) {
            const id = await desktopStageBookBytes(row.bytes)
            await desktopOpenBookWindow(`staged=${id}&name=${encodeURIComponent(row.fileName)}`)
          } else {
            showToast(t.recentUnavailable, 'error')
            return
          }
          showToast(t.extraWindowsToast(1), 'ok')
        } catch (err) {
          showToast(
            `${t.openErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
            'error',
          )
        }
        return
      }
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
    [mode, openFile, showToast, t],
  )

  /**
   * Капсула .nvgridx → книга (Этап 7.6, схема А): расшифровка по фразе из
   * диалога. Броски decryptSnapshot остаются наверху — SnapshotDialog покажет
   * инлайн-ошибку и даст повторить. Хэндл/путь НЕ восстанавливаем: Ctrl+S
   * не должен затирать капсулу xlsx-байтами (побочный файл, не источник книги).
   */
  const openSnapshot = useCallback(
    async (passphrase: string) => {
      const pending = snapshotPending
      if (!pending) return
      const payload = await decryptSnapshot(pending.buffer, passphrase)
      const name = payload.book.fileName ?? pending.file.name.replace(/\.nvgridx$/i, '')
      const viewKey = pending.meta ? openingKey(pending.file, pending.meta) : null
      beginViewStateTracking(viewKey)
      gridStore.getState().loadBook(snapshotToBook(payload), {
        fileName: name,
        fileFormat: extToFormat(name),
        csvDelimiter: payload.book.csvDelimiter,
      })
      void recordOpening(pending.file, pending.meta).catch(() => undefined)
      setSnapshotPending(null)
      setMode('book')
      if (viewKey) {
        const saved = await restoreViewState(viewKey)
        if (saved) applyViewState(saved)
      }
    },
    [snapshotPending],
  )

  const onOpenClicked = useCallback(async () => {
    // десктоп-обёртка (Этап 7.5): нативный диалог rfd с мультивыбором —
    // первая книга в текущее окно, остальные в новые (novagrid-023).
    // При уже открытой книге текущее окно не занимается (novagrid-025):
    // все выбранные файлы — в новые окна, предыдущая книга остаётся доступной
    if (isDesktop()) {
      try {
        const paths = await desktopPickBookPaths()
        if (paths.length === 0) return
        if (mode === 'book') {
          await openRestInWindows(paths)
          return
        }
        const first = await desktopOpenPath(paths[0])
        await openFile(first.file, { path: first.path })
        if (paths.length > 1) await openRestInWindows(paths.slice(1))
      } catch (err) {
        showToast(
          `${t.openErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        )
      }
      return
    }
    if (isTauriMobile()) {
      // мобильная обёртка (novagrid-058): FSA-пикер Android WebView висит без
      // системного UI — сразу штатный input, системный выбор файла даёт wry
      fileInputRef.current?.click()
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
  }, [mode, openFile, openRestInWindows, showToast, t])

  /** Ctrl+S: прямая запись в открытый файл, иначе — «Сохранить как…». */
  const save = useCallback(async () => {
    const st = gridStore.getState()
    if (st.edit) st.commitEdit('none')
    // .xls напрямую не пишем — только конверт в .xlsx/.csv/.ods через диалог;
    // .xlsx/.ods/.csv (novagrid-050) пишутся прямо, со всеми атрибутами листа
    const directFormat =
      st.fileFormat === 'csv' || st.fileFormat === 'xlsx' || st.fileFormat === 'ods'
        ? st.fileFormat
        : null
    // десктоп-обёртка: прямая запись по пути вместо FSA-хэндла
    if (isDesktop()) {
      if (st.desktopPath && st.fileFormat && directFormat) {
        setBusy(t.savingFile)
        try {
          const buffer = await buildBookBuffer(directFormat, st.csvDelimiter)
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
    // мобильная обёртка (novagrid-058): путь/хэндл не персистятся, любое
    // сохранение — через диалог (SAF) от плагина dialog
    if (isTauriMobile()) {
      setSaveAsOpen(true)
      return
    }
    if (st.fileHandle && st.fileFormat && directFormat) {
      setBusy(t.savingFile)
      try {
        const buffer = await buildBookBuffer(directFormat, st.csvDelimiter)
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

  /**
   * «Сохранить» в диалоге закрытия (novagrid-033): прямой записью — сохранить
   * и закрыть сразу; книге без пути (новая/.xls) — «Сохранить как…»,
   * окно закроется после успешной записи (closeAfterSaveRef). Ошибка записи
   * оставляет диалог открытым — решение за пользователем.
   */
  const saveAndClose = useCallback(async () => {
    const st = gridStore.getState()
    if (st.edit) st.commitEdit('none')
    const directFormat =
      st.fileFormat === 'csv' || st.fileFormat === 'xlsx' || st.fileFormat === 'ods'
        ? st.fileFormat
        : null
    if (st.desktopPath && st.fileFormat && directFormat) {
      setBusy(t.savingFile)
      try {
        const buffer = await buildBookBuffer(directFormat, st.csvDelimiter)
        await desktopWriteFile(st.desktopPath, buffer)
        gridStore.getState().markSaved()
        setCloseAskOpen(false)
        void desktopConfirmClose()
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
    closeAfterSaveRef.current = true
    setCloseAskOpen(false)
    setSaveAsOpen(true)
  }, [showToast, t])

  const saveAsChosen = useCallback(
    async (choice: SaveAsChoice) => {
      setSaveAsOpen(false)
      // капсула .nvgridx (7.6): вся книга → AES-GCM; текущую книгу не трогаем —
      // снапшот побочный файл для облака, имя/dirty/хэндл остаются как были
      if (choice.format === 'nvgridx') {
        // снапшот — не сохранение книги: из диалога закрытия окно не закрываем
        settleCloseAfterSave(closeAfterSaveRef, false)
        setBusy(t.savingFile)
        try {
          const buffer = await buildSnapshotBuffer(choice.passphrase!)
          if (isDesktop()) {
            const path = await desktopPickSavePath(choice.fileName, 'nvgridx')
            if (path === null) return
            await desktopWriteFile(path, buffer)
            const name = path.replace(/\\/g, '/').split('/').pop() ?? choice.fileName
            showToast(t.snapshotSavedToast(name), 'ok')
          } else if (isTauriMobile()) {
            // мобильная обёртка: SAF-диалог + запись мостом (novagrid-058)
            const path = await mobilePickSavePath(choice.fileName, 'nvgridx')
            if (path === null) return
            await mobileWriteFile(path, buffer)
            showToast(t.snapshotSavedToast(choice.fileName), 'ok')
          } else {
            downloadBuffer(choice.fileName, buffer, 'application/octet-stream')
            showToast(t.snapshotSavedToast(choice.fileName), 'ok')
          }
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
      setBusy(t.savingFile)
      try {
        const buffer = await buildBookBuffer(choice.format, choice.delimiter)
        if (isDesktop()) {
          // нативный «Сохранить как…» обёртки (rfd); отмена — тихо
          const path = await desktopPickSavePath(choice.fileName, choice.format)
          if (path === null) {
            settleCloseAfterSave(closeAfterSaveRef, false)
            return
          }
          await desktopWriteFile(path, buffer)
          const name = path.replace(/\\/g, '/').split('/').pop() ?? choice.fileName
          gridStore.getState().setDesktopPath(path)
          gridStore
            .getState()
            .markSaved(name, { fileFormat: choice.format, csvDelimiter: choice.delimiter })
          // книга сменила путь — позиция дальше помнится по нему (novagrid-037)
          beginViewStateTracking(path.toLowerCase())
          showToast(t.savedToast(name), 'ok')
        } else if (isTauriMobile()) {
          // мобильная обёртка (novagrid-058): системный SAF-диалог от плагина
          // dialog и запись по content:// (plugin-fs); отмена — тихо
          const path = await mobilePickSavePath(choice.fileName, choice.format)
          if (path === null) {
            settleCloseAfterSave(closeAfterSaveRef, false)
            return
          }
          await mobileWriteFile(path, buffer)
        } else if (isFsaAvailable()) {
          const handle = await window.showSaveFilePicker!({
            suggestedName: choice.fileName,
            types: [
              choice.format === 'xlsx'
                ? {
                    description: 'Excel (.xlsx)',
                    accept: { [xlsxMime()]: ['.xlsx'] },
                  }
                : choice.format === 'ods'
                  ? {
                      description: 'OpenDocument (.ods)',
                      accept: { [odsMime()]: ['.ods'] },
                    }
                  : { description: 'CSV (.csv)', accept: { [csvMime()]: ['.csv'] } },
            ],
          })
          await writeToHandle(handle, buffer)
          gridStore.getState().setFileHandle(handle)
        } else {
          downloadBuffer(
            choice.fileName,
            buffer,
            choice.format === 'csv' ? csvMime() : choice.format === 'ods' ? odsMime() : xlsxMime(),
          )
        }
        gridStore
          .getState()
          .markSaved(choice.fileName, { fileFormat: choice.format, csvDelimiter: choice.delimiter })
        showToast(t.savedToast(choice.fileName), 'ok')
        // сохранение состоялось: окно закрывается, если этого ждал диалог
        // закрытия (novagrid-033)
        settleCloseAfterSave(closeAfterSaveRef, true)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // отмена пикера — окно остаётся открытым (пользователь передумал)
          settleCloseAfterSave(closeAfterSaveRef, false)
          return
        }
        settleCloseAfterSave(closeAfterSaveRef, false)
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
    beginViewStateTracking(null) // сессия без файла — позицию не помним
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
        beginViewStateTracking(null)
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

  /**
   * Перетащенные сверх первого — в новые окна (novagrid-023). Пути у HTML5
   * File нет, поэтому байты едут через staging обёртки (?staged=…&name=…);
   * в браузере несколько книг — это вкладки браузера, там открывается первая.
   */
  const dropRestToWindows = useCallback(
    async (files: File[]) => {
      let opened = 0
      for (const file of files) {
        try {
          if (file.size > OPENING_BYTES_LIMIT) {
            showToast(t.dropTooLarge(file.name), 'error')
            continue
          }
          const id = await desktopStageBookBytes(await file.arrayBuffer())
          await desktopOpenBookWindow(`staged=${id}&name=${encodeURIComponent(file.name)}`)
          opened += 1
        } catch (err) {
          showToast(
            `${t.openErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
            'error',
          )
        }
      }
      if (opened > 0) showToast(t.extraWindowsToast(opened), 'ok')
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

  // ── заголовок окна и память позиции (novagrid-037) ────────────────────
  useEffect(() => installTitleSync(), [])
  useEffect(() => installViewStateSync(), [])

  // ── десктоп-обёртка (Этап 7.5): книги из аргументов запуска ──────────
  // (ассоциации .xlsx/.csv/.xls/.ods: «NovaGrid.exe <путь> [путь …]» —
  // Explorer может передать несколько файлов одной командой); startup_books
  // отвечает один раз, повторный вызов после смены языка вернёт пусто.
  // Первый файл — в это окно, остальные — в новые (novagrid-023).
  useEffect(() => {
    if (!isDesktop()) return
    let alive = true
    void (async () => {
      const paths = await desktopStartupBooks()
      if (!alive || paths.length === 0) return
      try {
        const first = await desktopOpenPath(paths[0])
        if (alive) await openFile(first.file, { path: first.path })
        if (alive && paths.length > 1) await openRestInWindows(paths.slice(1))
      } catch (err) {
        if (alive)
          showToast(
            `${t.openErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
            'error',
          )
      }
    })()
    return () => {
      alive = false
    }
  }, [openFile, openRestInWindows, showToast, t])

  // ── мобильная обёртка Android: системное «Открыть с помощью» (novagrid-068)
  // intent-filter на xlsx/doc/… запускает обёртку; холодный старт — pull
  // ждущего файла после загрузки, тёплое открытие — толчок из Kotlin
  useEffect(() => {
    if (!isTauriMobile()) return
    const alive = true
    const take = async () => {
      try {
        const file = await androidTakeOpenFile()
        if (alive && file) await openFile(new File([file.bytes], file.name))
      } catch (err) {
        if (alive)
          showToast(
            `${t.openErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
            'error',
          )
      }
    }
    void take()
    return onAndroidOpenPush(() => void take())
  }, [openFile, showToast, t])

  // ── десктоп-обёртка: окно доп. книги (novagrid-023) ───────────────────
  // открыто с ?file=<путь> (книги с диска) или staged=<id>&name=<имя>
  // (перетащенные — у HTML5 File нет пути); главное окно параметров не имеет
  useEffect(() => {
    if (!isDesktop()) return
    const params = new URLSearchParams(window.location.search)
    const filePath = params.get('file')
    const stagedId = Number(params.get('staged'))
    if (!filePath && !stagedId) return
    let alive = true
    void (async () => {
      try {
        if (filePath) {
          const book = await desktopOpenPath(filePath)
          if (alive) await openFile(book.file, { path: book.path })
        } else {
          const bytes = await desktopTakeStagedBook(stagedId)
          const name = params.get('name')
          if (alive && bytes && name) await openFile(new File([bytes], name))
        }
      } catch (err) {
        if (alive)
          showToast(
            `${t.openErrorTitle}: ${err instanceof Error ? err.message : String(err)}`,
            'error',
          )
      }
    })()
    return () => {
      alive = false
    }
  }, [openFile, showToast, t])

  // ── десктоп-обёртка: нативное меню «Файл» → те же обработчики ───────
  useEffect(() => {
    if (!isDesktop()) return
    return onDesktopMenu((action) => {
      if (action === 'open') void onOpenClicked()
      else if (action === 'save') void save()
      else if (action === 'save-as') setSaveAsOpen(true)
      else if (action === 'print') printStore.getState().openDialog()
      // novagrid-036: «Справка → Проверить обновления…» — диалог с исходом
      else if (action === 'check-update') void useUpdaterStore.getState().check(true)
    })
  }, [onOpenClicked, save])

  // ── OTA-обновления (novagrid-036): тихая проверка раз в сутки ────────
  // только в главном окне — окна книг делят localStorage и молчат, диалог
  // по тихой проверке не должен открываться в каждом окне разом.
  // novagrid-063: мобильная обёртка Android — та же тихая проверка (10 мин),
  // там одно окно, барьер меток не нужен
  useEffect(() => {
    if (!isDesktop() && !isTauriMobile()) return
    if (isDesktop() && desktopWindowLabel() !== null && desktopWindowLabel() !== 'main') return
    void useUpdaterStore.getState().init()
  }, [])

  // ── несохранённые правки не теряются при закрытии (novagrid-033) ─────
  // десктоп: обёртка знает флаг dirty своего окна и на крестике у «грязной»
  // книги адресно присылает novagrid:close-ask → наш диалог Сохранить /
  // Не сохранять / Отмена; чистые окна закрываются без вопросов
  useEffect(() => {
    if (!isDesktop()) return
    void desktopSetDirty(gridStore.getState().dirty).catch(() => undefined)
    return gridStore.subscribe((s, prev) => {
      if (s.dirty !== prev.dirty)
        void desktopSetDirty(s.dirty).catch(() => undefined)
    })
  }, [])

  useEffect(() => {
    if (!isDesktop()) return
    return onDesktopCloseAsk(() => {
      if (gridStore.getState().dirty) setCloseAskOpen(true)
      else void desktopConfirmClose()
    })
  }, [])

  // браузер/PWA: системный вопрос «покинуть сайт?» при закрытии вкладки с
  // правками; в обёртке не нужен — там спрашивает наш диалог
  useEffect(() => {
    if (isDesktop()) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!gridStore.getState().dirty) return
      e.preventDefault()
      e.returnValue = true // Chromium игнорирует preventDefault без него
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // ── настройки (6.3): размер таблицы из персиста — стартовый зум, ─────
  // document.lang для скринридеров идёт за языком интерфейса;
  // тема (7.2) применяется живьём (data-theme + PWA theme-color)
  useDocumentLang()
  useThemeSync()
  // язык нативного меню/диалогов обёртки — за языком интерфейса (novagrid-070):
  // каждое окно шлёт при старте и смене, обёртка пересобирает меню идемпотентно
  const menuLang = useSettings((s) => s.lang)
  useEffect(() => {
    if (isDesktop()) void desktopSetMenuLang(menuLang).catch(() => undefined)
  }, [menuLang])
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
  const defaultFormat: SaveAsFormat =
    gridStore.getState().fileFormat === 'csv'
      ? 'csv'
      : gridStore.getState().fileFormat === 'ods'
        ? 'ods'
        : 'xlsx'

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
        const files = Array.from(e.dataTransfer.files)
        if (files.length === 0) return
        // при открытой книге (десктоп) текущую не заменяем — все файлы
        // в новые окна (novagrid-025), как и Ctrl+O
        if (isDesktop() && mode === 'book') {
          void dropRestToWindows(files)
          return
        }
        const first = files[0]
        if (first) void openFile(first)
        const rest = files.slice(1)
        if (rest.length > 0 && isDesktop()) void dropRestToWindows(rest)
      }}
    >
      {/* общий вход открытия: input живёт всегда — и на старте, и в книге */}
      <input
        ref={fileInputRef}
        id="nv-file-input"
        type="file"
        hidden
        accept=".xlsx,.xlsm,.xls,.ods,.csv,.tsv,.docx,.doc,.nvgridx"
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
            beginViewStateTracking(null)
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
              onOpenRecent={(row) => void openRecent(row)}
              onSave={() => void save()}
              onSaveAs={() => setSaveAsOpen(true)}
            />
            {showPanel('filters') && <FilterBar />}
            {showPanel('formula') && <FormulaBar />}
            {showPanel('format') && <FormatBar />}
            <GridCanvas />
            {showPanel('sheets') && <SheetsBar />}
            {showPanel('status') && <StatusBar />}
            <MobileBar
            onOpen={() => void onOpenClicked()}
            onOpenRecent={(row) => void openRecent(row)}
          />
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
              : gridStore.getState().fileFormat === 'doc'
                ? t.docSaveNote
                : null
          }
          onConfirm={(choice) => void saveAsChosen(choice)}
          onCancel={() => setSaveAsOpen(false)}
        />
      )}

      {closeAskOpen && (
        <CloseAskDialog
          fileName={gridStore.getState().fileName}
          onSave={() => void saveAndClose()}
          onDiscard={() => {
            setCloseAskOpen(false)
            void desktopConfirmClose()
          }}
          onCancel={() => setCloseAskOpen(false)}
        />
      )}

      {snapshotPending && (
        <SnapshotDialog
          fileName={snapshotPending.file.name}
          onOpen={openSnapshot}
          onCancel={() => setSnapshotPending(null)}
        />
      )}

      {printOpen && <PrintDialog onClose={() => printStore.getState().closeDialog()} />}

      {updOpen && <UpdateDialog />}
    </div>
  )
}
