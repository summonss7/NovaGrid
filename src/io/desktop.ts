/*
 * Мост к десктоп-обёртке Tauri (Этап 7.5, карточка novagrid-018). Всё спрятано
 * за isDesktop() — признаком window.__TAURI__ (withGlobalTauri в tauri.conf.json):
 * браузерная сборка ни одного вызова не выполняет. npm-пакеты @tauri-apps
 * сознательно не подключаются — глобальный invoke не меняет веб-бандл.
 *
 * novagrid-033: обёртка спрашивает о сохранении при закрытии окна с правками.
 * Флаг dirty синхронизируется в Rust (set_window_dirty), событие novagrid:close-ask
 * приходит адресно — слушатели подписываются target'ом на метку своего окна
 * (Tauri: бродкаст дошёл бы до всех окон книг сразу).
 */

/** Цель события Tauri: подписка/отправка адресуется по метке окна. */
type TauriEventTarget =
  | { kind: 'Any' }
  | { kind: 'AnyLabel'; label: string }
  | { kind: 'WebviewWindow'; label: string }

type TauriGlobal = {
  core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> }
  event: {
    listen: (
      event: string,
      handler: (e: { payload: unknown }) => void,
      options?: { target: TauriEventTarget },
    ) => Promise<() => void>
  }
  webview?: {
    getCurrentWebviewWindow?: () => { label: string }
  }
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal
  }
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.__TAURI__ !== undefined
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return window.__TAURI__!.core.invoke<T>(cmd, args)
}

function baseName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

/** Открытая в обёртке книга: File для конвейера + путь для Ctrl+S. */
export interface DesktopBook {
  file: File
  path: string
}

async function readBook(path: string): Promise<DesktopBook> {
  // ipc::Response приходит ArrayBuffer'ом — бинарный канал без JSON-оверхеда
  const bytes = await invoke<ArrayBuffer>('read_book_bytes', { path })
  return { file: new File([bytes], baseName(path)), path }
}

/** Чтение книги по пути: переоткрытие из «Недавних» и окна доп. книг. */
export async function desktopOpenPath(path: string): Promise<DesktopBook> {
  return readBook(path)
}

/**
 * Нативный «Файл → Открыть» (rfd, мультивыбор — novagrid-023): пути книг.
 * Пусто — отмена диалога.
 */
export function desktopPickBookPaths(): Promise<string[]> {
  return invoke<string[]>('pick_open_books')
}

/**
 * Книги из аргументов запуска (ассоциации .xlsx/.csv/.xls/.ods), однократно:
 * несколько файлов — Explorer может передать их одной командой. Первый откроет
 * текущее окно, остальные — новые окна.
 */
export async function desktopStartupBooks(): Promise<string[]> {
  return invoke<string[]>('startup_books')
}

/**
 * Новое окно с книгой (novagrid-023): каждая книга — своё нативное окно.
 * query фронтенд кодирует сам: file=<путь> либо staged=<id>&name=<имя>.
 */
export function desktopOpenBookWindow(query: string): Promise<void> {
  return invoke<void>('open_book_window', { query })
}

/** Снимок байтов перетащенной книги (без пути на диске) — на новое окно. */
export function desktopStageBookBytes(bytes: ArrayBuffer): Promise<number> {
  return invoke<number>('stage_book_bytes', { bytes: Array.from(new Uint8Array(bytes)) })
}

/** Забрать снимок книги новым окном (бинарный IPC): байты. */
export function desktopTakeStagedBook(id: number): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('take_staged_book', { id })
}

/** Нативный «Сохранить как»: путь или null — отмена диалога. */
export function desktopPickSavePath(
  defaultName: string,
  format: 'xlsx' | 'csv' | 'nvgridx',
): Promise<string | null> {
  return invoke<string | null>('pick_save_book', { defaultName, format })
}

/** Запись книги по пути (JSON-массив байтов — книги таблиц малы). */
export function desktopWriteFile(path: string, buffer: ArrayBuffer): Promise<void> {
  return invoke<void>('write_book_file', { path, bytes: Array.from(new Uint8Array(buffer)) })
}

/** Подписка на событие обёртки — адресно, только для своего окна (novagrid-033):
 * слушатель регистрируется target'ом на метку этого окна, бродкаст обёртки
 * (fallback без фокуса) доходит и так. Метка недоступна — слушаем как раньше. */
function listenTargeted(
  event: string,
  handler: (e: { payload: unknown }) => void,
): Promise<() => void> {
  const label = window.__TAURI__?.webview?.getCurrentWebviewWindow?.().label
  const target: TauriEventTarget | undefined = label
    ? { kind: 'WebviewWindow', label }
    : undefined
  return window.__TAURI__!.event.listen(event, handler, target ? { target } : undefined)
}

/** Подписка на нативное меню «Файл» (действия open|save|save-as|print). */
export function onDesktopMenu(handler: (action: string) => void): () => void {
  return subscribe(listenTargeted('novagrid:menu', (e) => {
    if (typeof e.payload === 'string') handler(e.payload)
  }))
}

// ── защита от потери правок при закрытии (novagrid-033) ─────────────────
// Rust по метке окна знает, есть ли несохранённые правки: только «грязные»
// окна перехватываются на CloseRequested и получают novagrid:close-ask.

/** Синхронизация флага dirty книги в обёртку (вызывать при каждой смене). */
export function desktopSetDirty(dirty: boolean): Promise<void> {
  return invoke<void>('set_window_dirty', { dirty })
}

/** Закрыть окно, обойдя перехват: решение «сохранить/не сохранять» принято. */
export function desktopConfirmClose(): Promise<void> {
  return invoke<void>('confirm_close')
}

/** Обёртка попросила спросить пользователя о сохранении перед закрытием. */
export function onDesktopCloseAsk(handler: () => void): () => void {
  return subscribe(listenTargeted('novagrid:close-ask', () => handler()))
}

function subscribe(listening: Promise<() => void>): () => void {
  let unlisten: (() => void) | null = null
  let disposed = false
  void listening.then((fn) => {
    if (disposed) fn()
    else unlisten = fn
  })
  return () => {
    disposed = true
    unlisten?.()
  }
}
