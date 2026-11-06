// Десктоп-бин NovaGrid (Windows): вся логика обёртки — в модуле desktop_app
// (меню, rfd-диалоги, доп. окна книг, OTA из центра Aila). Мобильные обёртки
// Android/iOS собираются из lib-крейта novagrid_lib (lib.rs), сюда не входят:
// `cargo build --bin novagrid` не собирает lib вовсе (cdylib винде не нужен,
// novagrid-058), `tauri android build` — наоборот, строит только --lib.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop_app;

fn main() {
    desktop_app::run()
}
