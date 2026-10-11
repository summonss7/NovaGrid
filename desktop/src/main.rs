// Дескток-оболочка NovaGrid (Этап 7.5, карточка novagrid-018): окно WebView2
// поверх веб-приложения (production — ассеты в exe, dev — vite devserver),
// нативное меню «Файл», диалоги открытия/сохранения через rfd и стартовый
// файл из аргументов запуска — так работают ассоциации .xlsx/.csv/.xls/.ods:
// Explorer запускает «NovaGrid.exe <путь к книге>».
//
// Фронтенд общается с оболочкой через window.__TAURI__ (withGlobalTauri):
// invoke-команды ниже + события меню novagrid:menu. npm-пакеты @tauri-apps
// в веб-часть не подключаются — браузерная сборка не меняется вовсе.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Emitter;
use tauri::Manager;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::ipc::Response;

/// Сайт проекта для «Справка → Открыть сайт» (GitHub Pages — та же сборка PWA).
const SITE_URL: &str = "https://summonss7.github.io/NovaGrid/";

/// Файл из аргументов запуска: читается однократно при первом запросе фронтенда.
struct StartupBook(Mutex<Option<PathBuf>>);

/// Нативный диалог «Открыть книгу»: путь к файлу (null — отмена).
#[tauri::command]
fn pick_open_book() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Открыть книгу")
        .add_filter("Таблицы", &["xlsx", "xlsm", "xls", "ods", "csv", "tsv"])
        .pick_file()
        .map(path_string)
}

/// Нативный диалог «Сохранить книгу»: путь к файлу (null — отмена).
#[tauri::command]
fn pick_save_book(default_name: String, format: String) -> Option<String> {
    let (label, ext) = if format == "csv" {
        ("CSV", "csv")
    } else {
        ("Excel", "xlsx")
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

/// Стартовый файл из ассоциации/аргумента запуска — однократно (null далее).
#[tauri::command]
fn startup_book(state: tauri::State<StartupBook>) -> Option<String> {
    state
        .0
        .lock()
        .ok()?
        .take()
        .map(path_string)
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_open_book,
            pick_save_book,
            read_book_bytes,
            write_book_file,
            startup_book,
            open_external
        ])
        .setup(|app| {
            // нативное меню: «Файл» повторяет горячие клавиши веб-части
            // (акселераторы меню перехватывают Ctrl+O/S/P до webview,
            // событие novagrid:menu вызывает те же обработчики)
            let open = MenuItem::with_id(app, "open", "Открыть…", true, Some("Ctrl+O"))?;
            let save = MenuItem::with_id(app, "save", "Сохранить", true, Some("Ctrl+S"))?;
            let save_as =
                MenuItem::with_id(app, "save-as", "Сохранить как…", true, Some("Ctrl+Shift+S"))?;
            let print = MenuItem::with_id(app, "print", "Печать…", true, Some("Ctrl+P"))?;
            let file_menu = SubmenuBuilder::new(app, "Файл")
                .item(&open)
                .item(&save)
                .item(&save_as)
                .separator()
                .item(&print)
                .build()?;

            let site =
                MenuItem::with_id(app, "site", "Открыть сайт NovaGrid", true, None::<&str>)?;
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
                .separator()
                .item(&about)
                .build()?;

            app.set_menu(Menu::with_items(app, &[&file_menu, &help_menu])?)?;

            // ассоциации: «NovaGrid.exe <книга>» — файл ждёт фронтенд на старте
            let startup = std::env::args().nth(1).map(PathBuf::from).filter(|p| p.is_file());
            app.manage(StartupBook(Mutex::new(startup)));
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" | "save" | "save-as" | "print" => {
                let _ = app.emit("novagrid:menu", event.id().as_ref());
            }
            "site" => {
                let _ = open_external(SITE_URL.to_string());
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить NovaGrid");
}
