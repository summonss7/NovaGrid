/*
 * Ambient-типы File System Access API: createWritable есть в lib.dom,
 * а пикеры файлов (Chromium) — нет. Объявляем минимально необходимое.
 */

interface FileSystemPickerOptions {
  id?: string
  startIn?: string
}

interface OpenFilePickerOptions extends FileSystemPickerOptions {
  multiple?: boolean
  types?: { description?: string; accept: Record<string, string[]> }[]
  excludeAcceptAllOption?: boolean
}

interface SaveFilePickerOptions extends FileSystemPickerOptions {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
  excludeAcceptAllOption?: boolean
}

interface Window {
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>
}
