// OTA-обновления из центра Aila (novagrid-036, концепция —
// D:\Scheduler\UPDATES-SYSTEM.md §§3–5): GET манифеста v2, сравнение
// versionName с CARGO_PKG_VERSION, скачивание portable-exe со сверкой
// sha256 и rename-swap запущенного exe с перезапуском. Запущенный exe
// переименовывается в <exe>.old (переименовать запущенный файл Windows
// позволяет, удалить — нет), свежий встаёт на его место и запускается,
// .old удаляется при следующем старте (cleanup_old в setup). Работает из
// любого места установки — всё относительно std::env::current_exe().
// Паттерн общий с Al-Navi (alnavi-039). PWA-ветка не затронута: проверка
// и обновление живут только в десктоп-оболочке.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

/// Манифест канала обновлений. NOVAGRID_UPDATES_URL переопределяет —
/// так живая проверка указывает приложение на подменённый манифест.
fn manifest_url() -> String {
    std::env::var("NOVAGRID_UPDATES_URL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://aila.skillcoin.pp.ua/updates/novagrid/manifest.json".into())
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAsset {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version_name: String,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<UpdateAsset>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    /// "latest" | "available" | "network-error" | "bad-manifest"
    pub status: String,
    pub current: String,
    pub latest: Option<String>,
    pub notes: Option<String>,
    pub published_at: Option<String>,
    /// Выбранный portable-exe ассет (setup-инсталляторы пропускаются);
    /// есть только если манифест несёт пригодный для swap-а файл
    pub asset: Option<UpdateAsset>,
    pub error: Option<String>,
}

/// Числовое сравнение x.y[.z…]: компоненты как числа, недостающий хвост — 0.
pub(crate) fn version_lt(a: &str, b: &str) -> bool {
    let parts = |v: &str| -> Vec<u64> {
        v.split('.')
            .map(|p| {
                let digits: String = p.chars().take_while(|c| c.is_ascii_digit()).collect();
                digits.parse().unwrap_or(0)
            })
            .collect()
    };
    let (a, b) = (parts(a), parts(b));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (
            a.get(i).copied().unwrap_or(0),
            b.get(i).copied().unwrap_or(0),
        );
        if x != y {
            return x < y;
        }
    }
    false
}

/// Portable-exe, который swap может установить: .exe без «setup» в имени —
/// канал несёт и setup-инсталлятор для людей, и zip-портабель (без распаковки
/// zip-крейта клиенту нужен именно «голый» exe).
pub(crate) fn pick_asset(assets: &[UpdateAsset]) -> Option<&UpdateAsset> {
    assets
        .iter()
        .find(|a| a.name.to_ascii_lowercase().ends_with(".exe")
            && !a.name.to_ascii_lowercase().contains("setup"))
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
}

/// Получить манифест канала и сравнить версии. Никогда не возвращает Err —
/// недоступный центр деградирует в статус, который UI покажет или молча
/// проглотит (UPDATES-SYSTEM §5: «не удалось проверить» — не ошибка).
#[tauri::command]
pub async fn updater_check() -> UpdateCheck {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let mut r = UpdateCheck {
        status: "network-error".into(),
        current: current.clone(),
        latest: None,
        notes: None,
        published_at: None,
        asset: None,
        error: None,
    };
    let client = match http_client() {
        Ok(c) => c,
        Err(e) => {
            r.error = Some(e);
            return r;
        }
    };
    let body = match client
        .get(manifest_url())
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .and_then(|res| res.error_for_status())
    {
        Ok(res) => res.text().await.unwrap_or_default(),
        Err(e) => {
            r.error = Some(e.to_string());
            return r;
        }
    };
    let m: Manifest = match serde_json::from_str(&body) {
        Ok(m) => m,
        Err(e) => {
            r.status = "bad-manifest".into();
            r.error = Some(e.to_string());
            return r;
        }
    };
    r.latest = Some(m.version_name.clone());
    r.notes = m.notes;
    r.published_at = m.published_at;
    if version_lt(current.as_str(), m.version_name.as_str()) {
        r.status = "available".into();
        r.asset = pick_asset(&m.assets).cloned();
    } else {
        r.status = "latest".into();
    }
    r
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
}

/// Скачать exe-ассет в %TEMP% с событиями «novagrid:updater-progress»,
/// сверить sha256 со значением манифеста и вернуть путь temp-файла для
/// updater_apply. Несовпадение или обрыв сети удаляет недокачанный файл —
/// полу-скачанное не выживает.
#[tauri::command]
pub async fn updater_download(
    app: AppHandle,
    url: String,
    sha256: String,
    size: u64,
) -> Result<String, String> {
    let client = http_client()?;
    let res = client
        .get(url)
        .timeout(std::time::Duration::from_secs(10 * 60))
        .send()
        .await
        .map_err(|e| format!("network: {e}"))?
        .error_for_status()
        .map_err(|e| format!("http: {e}"))?;
    let total = size.max(res.content_length().unwrap_or(0));
    let dest: PathBuf = std::env::temp_dir().join(format!("novagrid-update-{}.exe", std::process::id()));
    let mut file = tokio::fs::File::create(&dest).await.map_err(|e| format!("temp: {e}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = u64::MAX;
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    let mut stream = res.bytes_stream();
    loop {
        let chunk = match stream.next().await {
            Some(Ok(c)) => c,
            Some(Err(e)) => {
                let _ = tokio::fs::remove_file(&dest).await;
                return Err(format!("download: {e}"));
            }
            None => break,
        };
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| format!("write: {e}"))?;
        downloaded += chunk.len() as u64;
        // троттлинг: событие на ~256 КиБ (и в конце)
        if last_emit == u64::MAX || downloaded.saturating_sub(last_emit) >= 256 * 1024 {
            let _ = app.emit("novagrid:updater-progress", DownloadProgress { downloaded, total });
            last_emit = downloaded;
        }
    }
    let _ = app.emit("novagrid:updater-progress", DownloadProgress { downloaded, total });
    drop(file);
    let got = format!("{:x}", hasher.finalize());
    if !got.eq_ignore_ascii_case(&sha256) {
        let _ = tokio::fs::remove_file(&dest).await;
        return Err(format!("sha256 mismatch: expected {sha256}, got {got}"));
    }
    Ok(dest.to_string_lossy().into_owned())
}

/// Удалить .old от прошлого цикла обновления (вызывается из setup — к этому
/// моменту старый бинарник уже не запущен и Windows разрешает его удаление).
pub fn cleanup_old() {
    if let Ok(exe) = std::env::current_exe() {
        let mut old = exe.into_os_string();
        old.push(".old");
        let _ = std::fs::remove_file(&old);
    }
}

/// Rename-swap: запущенный exe → .old, скачанный → на его место, запустить
/// новый бинарник, выйти. Фронтенд перед вызовом сбрасывает сессию на диск —
/// выход процесса ниже минует обычные обработчики закрытия.
#[tauri::command]
pub async fn updater_apply(app: AppHandle, path: String) -> Result<(), String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err(format!("downloaded file is gone: {path}"));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut old = exe.clone().into_os_string();
    old.push(".old");
    let old = PathBuf::from(old);
    // застарелый .old от прошлого цикла помешал бы переименованию
    let _ = std::fs::remove_file(&old);
    std::fs::rename(&exe, &old).map_err(|e| format!("rename current exe: {e} (folder writable?)"))?;
    if let Err(e) = std::fs::copy(&src, &exe) {
        // откат, чтобы приложение продолжило работать на прежнем бинарнике
        let _ = std::fs::rename(&old, &exe);
        return Err(format!("copy new exe: {e}"));
    }
    let _ = std::fs::remove_file(&src);
    std::process::Command::new(&exe)
        .spawn()
        .map_err(|e| format!("restart: {e}"))?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str) -> UpdateAsset {
        UpdateAsset {
            name: name.into(),
            url: format!("https://example.invalid/{name}"),
            size: None,
            sha256: None,
        }
    }

    #[test]
    fn version_compare() {
        assert!(version_lt("1.18.0", "1.19.0"));
        assert!(version_lt("1.9", "1.10.0")); // числа, не строки
        assert!(version_lt("1.19", "1.19.1"));
        assert!(!version_lt("1.19.0", "1.19.0"));
        assert!(!version_lt("1.20.0", "1.19.9"));
        assert!(!version_lt("2.0", "1.99.99"));
        // суффиксы обрезаются: канал публикует только простые версии,
        // «1.19.0-beta» == «1.19.0» — обновления не требует
        assert!(!version_lt("1.19.0-beta", "1.19.0"));
    }

    #[test]
    fn picks_portable_exe_not_setup() {
        let assets = vec![
            asset("novagrid-1.19.0-setup-release.exe"),
            asset("novagrid-1.19.0-portable-release.zip"),
            asset("novagrid-1.19.0-portable-release.exe"),
        ];
        let picked = pick_asset(&assets).expect("portable exe must be picked");
        assert_eq!(picked.name, "novagrid-1.19.0-portable-release.exe");
    }

    #[test]
    fn no_exe_means_no_asset() {
        let assets = vec![
            asset("novagrid-1.19.0-setup-release.exe"),
            asset("novagrid-1.19.0-portable-release.zip"),
        ];
        assert!(pick_asset(&assets).is_none());
    }
}
