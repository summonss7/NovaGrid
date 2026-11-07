/*
 * Мост к мобильной обёртке Tauri Android/iOS (novagrid-057/058). Признак —
 * window.__TAURI__.dialog: плагин dialog инжектится только мобильной веткой
 * lib.rs (десктоп регистрирует rfd-команды, но не плагины) — так один
 * веб-бандл различает платформы без пересборки фронтенда.
 *
 * Назначение моста — сохранение книг. Веб-путей сохранения в Android WebView
 * нет вовсе (проверено на эмуляторе, novagrid-058): FSA showSaveFilePicker
 * висит без системного UI, запись в хэндл открытого файла падает
 * InvalidStateError (грант протухает), a[download] с blob игнорируется без
 * DownloadListener, navigator.share отсутствует. Посему — системный SAF-диалог
 * (ACTION_CREATE_DOCUMENT, plugin-dialog) и запись по content:// через
 * ContentResolver (plugin-fs). Открытие книг мосту не нужно: input[type=file]
 * получает системный пикер от wry.
 *
 * npm-пакеты @tauri-apps сознательно не подключаются (как и в desktop.ts) —
 * глобальный window.__TAURI__ (withGlobalTauri), браузерная сборка не меняется.
 */

/** Мобильная обёртка Tauri (Android/iOS): плагин dialog инжектирован. */
export function isTauriMobile(): boolean {
  return typeof window !== 'undefined' && window.__TAURI__?.dialog !== undefined
}

/** Фильтры системного диалога сохранения по формату книги. */
const FILTERS: Record<string, { name: string; extensions: string[] }> = {
  xlsx: { name: 'Excel (.xlsx)', extensions: ['xlsx'] },
  ods: { name: 'OpenDocument (.ods)', extensions: ['ods'] },
  csv: { name: 'CSV (.csv)', extensions: ['csv'] },
  nvgridx: { name: 'Снапшот NovaGrid', extensions: ['nvgridx'] },
}

/**
 * Системный «Сохранить как…» мобильной обёртки: SAF-пикер от плагина dialog.
 * Возвращает путь (content://…) или null — отмена.
 */
export function mobilePickSavePath(
  defaultName: string,
  format: 'xlsx' | 'ods' | 'csv' | 'nvgridx',
): Promise<string | null> {
  return window.__TAURI__!.dialog!.save({
    defaultPath: defaultName,
    filters: [FILTERS[format]],
  })
}

/** Запись книги по пути SAF-диалога (JSON-массив байтов — книги таблиц малы). */
export async function mobileWriteFile(path: string, buffer: ArrayBuffer): Promise<void> {
  await window.__TAURI__!.fs!.writeFile(path, Array.from(new Uint8Array(buffer)))
}

/*
 * OTA мобильной обёртки (novagrid-063): тот же центр обновлений Aila, что у
 * десктопа, но ассет — APK (сборка universal aarch64). Команды — в Rust-ветке
 * lib.rs (mobile_updater): проверка манифеста, скачивание в cacheDir со
 * сверкой sha256 (событие прогресса — то же «novagrid:updater-progress»)
 * и системная установка (JNI: FileProvider + ACTION_VIEW). iOS эти команды
 * не регистрирует — стор обновляет сам.
 */

/** Ассет манифеста и исход проверки — те же формы, что у десктопного моста. */
export interface MobileUpdateAsset {
  name: string
  url: string
  size?: number
  sha256?: string
}

export interface MobileUpdateCheck {
  status: 'latest' | 'available' | 'network-error' | 'bad-manifest'
  current: string
  latest: string | null
  notes: string | null
  publishedAt: string | null
  asset: MobileUpdateAsset | null
  error: string | null
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return window.__TAURI__!.core.invoke<T>(cmd, args)
}

/** Проверить манифест канала /updates/novagrid (никогда не бросает). */
export function mobileUpdateCheck(): Promise<MobileUpdateCheck> {
  return invoke<MobileUpdateCheck>('updater_check')
}

/** Скачать APK в cacheDir (sha256 сверен в обёртке): путь файла. */
export function mobileUpdateDownload(url: string, sha256: string, size: number): Promise<string> {
  return invoke<string>('updater_download', { url, sha256, size })
}

/**
 * Системная установка: 'started' — открыт установщик Android, подтвердите
 * установку; 'needs-permission' — открыты настройки источника, разрешите
 * и нажмите «Обновить» снова.
 */
export function mobileUpdateInstall(path: string): Promise<'started' | 'needs-permission'> {
  return invoke<'started' | 'needs-permission'>('updater_install', { path })
}

/** Прогресс скачивания — то же событие, что слушает десктопный диалог. */
export function onMobileUpdaterProgress(
  handler: (p: { downloaded: number; total: number }) => void,
): () => void {
  let unlisten: (() => void) | null = null
  let disposed = false
  void window
    .__TAURI__!.event.listen('novagrid:updater-progress', (e) => {
      const p = e.payload as { downloaded: number; total: number } | null
      if (p && typeof p.downloaded === 'number') handler(p)
    })
    .then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })
    .catch(() => undefined)
  return () => {
    disposed = true
    unlisten?.()
  }
}
