// Дескток-оболочка NovaGrid (Этап 7.5, карточка novagrid-018): окно WebView2
// поверх веб-приложения (production — ассеты в exe, dev — vite devserver),
// нативное меню «Файл», диалоги открытия/сохранения через rfd и стартовые
// файлы из аргументов запуска — так работают ассоциации .xlsx/.csv/.xls/.ods:
// Explorer запускает «NovaGrid.exe <путь к книге>».
//
// novagrid-023: несколько книг одновременно — каждая в своём окне. Все файлы
// из аргументов запуска читаются целиком (первый — в главное окно, остальные —
// в дополнительные через ?file=), диалог «Открыть» получил мультивыбор;
// перетащенные без пути (drag&drop) файлы едут в новые окна через staging.
//
// novagrid-033: закрытие окна с несохранённой книгой не молчит — обёртка
// спрашивает «Сохранить / Не сохранять / Отмена». Фронтенд держит Rust в
// курсе флага dirty (set_window_dirty по метке окна), перехват CloseRequested
// гасит крестик только для «грязных» окон и адресно шлёт novagrid:close-ask;
// решение пользователя исполняет confirm_close (destroy, без повторного
// перехвата).
//
// novagrid-036: OTA из центра обновлений Aila — «Справка → Проверить
// обновления…» и тихая проверка раз в сутки (модуль updater): манифест v2,
// сверка versionName, скачивание со sha256 и rename-swap exe с перезапуском.
//
// Фронтенд общается с оболочкой через window.__TAURI__ (withGlobalTauri):
// invoke-команды ниже + события меню novagrid:menu. npm-пакеты @tauri-apps
// в веб-часть не подключаются — браузерная сборка не меняется вовсе.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::Emitter;
use tauri::Manager;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::ipc::Response;
use tauri::webview::WebviewWindowBuilder;

mod updater;

/// Сайт проекта для «Справка → Открыть сайт» (GitHub Pages — та же сборка PWA).
const SITE_URL: &str = "https://summonss7.github.io/NovaGrid/";

/// Метки окон доп. книг: book-1, book-2, … (главное окно конфига — main).
static WINDOW_SEQ: AtomicU64 = AtomicU64::new(1);
/// Идентификаторы книг, от staged до момента чтения новым окном.
static STAGED_SEQ: AtomicU64 = AtomicU64::new(1);
/// Сколько снятых книг держим в памяти — страховка от «окно не открылось».
const STAGED_KEEP: usize = 8;

/// Файлы из аргументов запуска: читаются однократно при первом запросе фронтенда.
struct StartupBooks(Mutex<Vec<PathBuf>>);

/** Снимки байтов перетащенных книг (drag&drop не даёт путей на диск). */
struct StagedBooks(Mutex<HashMap<u64, Vec<u8>>>);

/// Метки окон с несохранёнными правками (novagrid-033): только их закрытие
/// перехватывается — чистые окна закрываются мгновенно, без опроса фронтенда.
struct DirtyWindows(Mutex<HashSet<String>>);

/// Флаг dirty книги в этом окне: фронтенд шлёт при каждой смене (novagrid-033).
#[tauri::command]
fn set_window_dirty(window: tauri::WebviewWindow, state: tauri::State<DirtyWindows>, dirty: bool) {
    if let Ok(mut set) = state.0.lock() {
        if dirty {
            set.insert(window.label().to_string());
        } else {
            set.remove(window.label());
        }
    }
}

/// Пользователь решил закрываться (сохранив или нет) — destroy минует
/// перехват CloseRequested, иначе окно спрашивало бы бесконечно.
#[tauri::command]
fn confirm_close(window: tauri::WebviewWindow) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())
}

/// Нативный диалог «Открыть книгу» с мультивыбором: пути (пусто — отмена).
/// .nvgridx — зашифрованная капсула-снапшот (Этап 7.6): открывается тем же
/// конвейером, фразу спросит веб-диалог.
#[tauri::command]
fn pick_open_books() -> Vec<String> {
    rfd::FileDialog::new()
        .set_title("Открыть книги")
        .add_filter("Таблицы", &["xlsx", "xlsm", "xls", "ods", "csv", "tsv", "nvgridx"])
        .pick_files()
        .map(|paths| paths.into_iter().map(path_string).collect())
        .unwrap_or_default()
}

/// Нативный диалог «Сохранить книгу»: путь к файлу (null — отмена).
#[tauri::command]
fn pick_save_book(default_name: String, format: String) -> Option<String> {
    let (label, ext) = match format.as_str() {
        "csv" => ("CSV", "csv"),
        "nvgridx" => ("Снапшот NovaGrid", "nvgridx"),
        _ => ("Excel", "xlsx"),
    };
    rfd::FileDialog::new()
        .set_title("Сохранить книгу")
        .add_filter(label, &[ext])
        .set_file_name(&default_name)
        .save_file()
        .map(path_string)
}

/// Байты файла как ArrayBuffer (tauri::ipc::Response — бинарный канал IPC).
#[tauri::command]
fn read_book_bytes(path: String) -> Result<Response, String> {
    fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("Не удалось прочитать {path}: {e}"))
}

/// Запись книги по пути (байты приходят JSON-массивом — книги таблиц малы).
#[tauri::command]
fn write_book_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    fs::write(&path, bytes).map_err(|e| format!("Не удалось записать {path}: {e}"))
}

/// Стартовые файлы из ассоциаций/аргументов запуска — однократно (далее пусто).
/// Первый открывается в текущем окне, остальные — новые окна (?file=).
#[tauri::command]
fn startup_books(state: tauri::State<StartupBooks>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut v| std::mem::take(&mut *v))
        .unwrap_or_default()
        .into_iter()
        .map(path_string)
        .collect()
}

/// Доп. окно с книгой: query уже закодирован фронтендом (encodeURIComponent)
/// и различается по источнику — file=<путь> или staged=<id>&name=<имя>.
#[tauri::command]
async fn open_book_window(app: tauri::AppHandle, query: String) -> Result<(), String> {
    let label = format!("book-{}", WINDOW_SEQ.fetch_add(1, Ordering::Relaxed));
    let url = format!("index.html?{query}");
    WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(url.as_str().into()),
    )
    .title("NovaGrid")
    .inner_size(1280.0, 800.0)
    .min_inner_size(960.0, 600.0)
    .center()
    // как у главного окна конфига: HTML5 drag&drop вместо событий Tauri
    .drag_and_drop(false)
    .menu(build_menu(&app).map_err(|e| e.to_string())?)
    .build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Снимок перетащенной книги для нового окна (без пути на диск): id.
#[tauri::command]
fn stage_book_bytes(state: tauri::State<StagedBooks>, bytes: Vec<u8>) -> u64 {
    let id = STAGED_SEQ.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut map) = state.0.lock() {
        map.insert(id, bytes);
        // старые снимки не копятся, если окна не забрали свои книги
        while map.len() > STAGED_KEEP {
            if let Some(&oldest) = map.keys().min() {
                map.remove(&oldest);
            } else {
                break;
            }
        }
    }
    id
}

/// Забрать снимок книги (бинарный IPC) — новое окно читает один раз.
#[tauri::command]
fn take_staged_book(state: tauri::State<StagedBooks>, id: u64) -> Result<Response, String> {
    state
        .0
        .lock()
        .map_err(|_| "Хранилище снимков недоступно".to_string())?
        .remove(&id)
        .map(Response::new)
        .ok_or_else(|| format!("Снимок книги {id} не найден"))
}

/// Внешняя ссылка — в системном браузере (cmd start по http(s)-ссылке).
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Разрешены только ссылки http(s)".into());
    }
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn path_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

/// Нативное меню окна ( акселераторы перехватывают Ctrl+O/S/P до webview).
/// Строится для каждого окна отдельно: событие novagrid:menu уходит только
/// в окно, чьё меню нажали (иначе все окна открыли бы диалог разом).
fn build_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let open = MenuItem::with_id(app, "open", "Открыть…", true, Some("Ctrl+O"))?;
    let save = MenuItem::with_id(app, "save", "Сохранить", true, Some("Ctrl+S"))?;
    let save_as = MenuItem::with_id(app, "save-as", "Сохранить как…", true, Some("Ctrl+Shift+S"))?;
    let print = MenuItem::with_id(app, "print", "Печать…", true, Some("Ctrl+P"))?;
    let file_menu = SubmenuBuilder::new(app, "Файл")
        .item(&open)
        .item(&save)
        .item(&save_as)
        .separator()
        .item(&print)
        .build()?;

    let site = MenuItem::with_id(app, "site", "Открыть сайт NovaGrid", true, None::<&str>)?;
    // novagrid-036: проверка обновлений из центра Aila — диалог открывает
    // окно, чьё меню нажали (событие уходит как у «Файл», адресно)
    let check_update =
        MenuItem::with_id(app, "check-update", "Проверить обновления…", true, None::<&str>)?;
    let about = PredefinedMenuItem::about(
        app,
        Some("О программе"),
        Some(AboutMetadata {
            name: Some("NovaGrid".to_string()),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            ..Default::default()
        }),
    )?;
    let help_menu = SubmenuBuilder::new(app, "Справка")
        .item(&site)
        .item(&check_update)
        .separator()
        .item(&about)
        .build()?;

    Menu::with_items(app, &[&file_menu, &help_menu])
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_open_books,
            pick_save_book,
            read_book_bytes,
            write_book_file,
            startup_books,
            open_book_window,
            stage_book_bytes,
            take_staged_book,
            open_external,
            set_window_dirty,
            confirm_close,
            updater::updater_check,
            updater::updater_download,
            updater::updater_apply
        ])
        .setup(|app| {
            // ассоциации: «NovaGrid.exe <книга> [книга …]» — файлы ждут фронтенд
            let startup: Vec<PathBuf> = std::env::args()
                .skip(1)
                .map(PathBuf::from)
                .filter(|p| p.is_file())
                .collect();
            app.manage(StartupBooks(Mutex::new(startup)));
            app.manage(StagedBooks(Mutex::new(HashMap::new())));
            app.manage(DirtyWindows(Mutex::new(HashSet::new())));

            // novagrid-036: .old от прошлого самообновления больше не запущен —
            // можно удалить (см. updater::updater_apply)
            updater::cleanup_old();

            app.set_menu(build_menu(app.handle())?)?;
            Ok(())
        })
        // novagrid-033: крестик у «грязного» окна не закрывает его молча —
        // гасим системное закрытие и адресно просим фронтенд спросить
        // пользователя (novagrid:close-ask; слушатель подписан target'ом
        // на метку этого окна, чужие окна событие не получают). Чистые окна
        // и окна без ответа фронтенда закрываются как раньше.
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let dirty = window
                    .app_handle()
                    .try_state::<DirtyWindows>()
                    .and_then(|d| d.0.lock().map(|s| s.contains(window.label())).ok())
                    .unwrap_or(false);
                if dirty {
                    api.prevent_close();
                    let _ = window.emit_to(window.label(), "novagrid:close-ask", ());
                }
            }
            tauri::WindowEvent::Destroyed => {
                if let Some(state) = window.app_handle().try_state::<DirtyWindows>() {
                    if let Ok(mut set) = state.0.lock() {
                        set.remove(window.label());
                    }
                }
            }
            _ => {}
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" | "save" | "save-as" | "print" | "check-update" => {
                // только окно, чьё меню нажали: с несколькими окнами бродкаст
                // открыл бы диалог в каждом из них. emit_to адресует по метке
                // (слушатель фронтенда подписан target'ом на своё окно),
                // fallback без фокуса — прежний бродкаст
                let target = app
                    .webview_windows()
                    .into_values()
                    .find(|w| w.is_focused().unwrap_or(false));
                match target {
                    Some(win) => {
                        let _ = win.emit_to(win.label(), "novagrid:menu", event.id().as_ref());
                    }
                    None => {
                        let _ = app.emit("novagrid:menu", event.id().as_ref());
                    }
                }
            }
            "site" => {
                let _ = open_external(SITE_URL.to_string());
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить NovaGrid");
}
