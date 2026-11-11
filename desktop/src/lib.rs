// Мобильная обёртка NovaGrid для Android/iOS (novagrid-057/058): тот же
// веб-бандл в системном WebView. Открытие книг — веб-путём input[type=file]
// (wry даёт системный выбор файла), сохранение — плагины dialog+fs: SAF-диалог
// ACTION_CREATE_DOCUMENT и запись по content://. Прямых веб-путей сохранения
// в Android WebView нет (FSA-пикер висит без UI, a[download] игнорируется,
// navigator.share отсутствует) — проверено на эмуляторе, novagrid-058.
//
// Windows-десктоп сюда не входит: он собирается бином (main.rs → desktop_app)
// и линкуется без этого lib вовсе — cdylib/staticlib нужны только мобильным
// таргетам (Android .so через JNI, iOS .a), на винде MinGW-линкер не тянет
// пустой cdylib-экспорт и не должен его строить.
//
// ПРИЗНАК ПЛАТФОРМЫ ДЛЯ ФРОНТЕНДА: плагин dialog инжектит window.__TAURI__.dialog
// (withGlobalTauri) — его наличие = мобильная обёртка; десктоп плагинов не
// регистрирует, там window.__TAURI__ без .dialog. Фронтенд различает мосты
// так (isTauriMobile в src/io/mobile.ts) — один веб-бандл на все платформы.

/// Точка входа мобильной обёртки. На десктоп-таргетах lib пуст (бин main.rs
/// не зависит от него), mobile_entry_point генерирует JNI-связку для
/// Kotlin-активити из gen/android.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(mobile)]
    mobile_run();
}

/// Тонкий WebView + плагины сохранения: меню/окна десктопа не планируются —
/// событие novagrid:menu и invoke-команды desktop_app на мобильных отсутствуют,
/// фронтенд работает по браузерным путям и через src/io/mobile.ts.
/// novagrid-063: OTA мобильной — команды mobile_updater (манифест центра
/// Aila, скачивание APK, системная установка через JNI) — только Android:
/// iOS обновления ставит App Store, стор сам ведёт цикл.
/// Модуль мобильного OTA: компилируется для мобильных таргетов и в тестах
/// хоста (cfg(test) включает — чистая логика выбора APK/версий покрыта
/// юнит-тестами без Android-тулчейна), обычная хост-сборка его не берёт.
#[cfg(any(mobile, test))]
mod mobile_updater;

/// novagrid-068: файл системного «Открыть с помощью» (ACTION_VIEW на xlsx/
/// doc/… — intent-filter в манифесте). Kotlin (MainActivity) копирует байты
/// в cacheDir/nv-open.tmp и держит имя в companion; команда читает капсулу
/// однократно (и удаляет) — фронтенд строит File и открывает общим конвейером
/// (JS-мост __NovaGridAndroid передаёт имя, см. mobile.ts).
#[cfg(target_os = "android")]
#[tauri::command]
fn mobile_read_open_intent() -> Result<tauri::ipc::Response, String> {
    let path = mobile_updater::android_cache_dir()
        .map_err(|e| format!("cache: {e}"))?
        .join("nv-open.tmp");
    let bytes = std::fs::read(&path).map_err(|e| format!("open-intent: {e}"))?;
    // капсула одноразовая: повторное чтение не переоткроет тот же файл
    let _ = std::fs::remove_file(&path);
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(mobile)]
fn mobile_run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());
    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        mobile_updater::updater_check,
        mobile_updater::updater_download,
        mobile_updater::updater_install,
        mobile_read_open_intent
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("не удалось запустить NovaGrid");
}
