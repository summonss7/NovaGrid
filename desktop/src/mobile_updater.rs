// OTA мобильной NovaGrid из центра Aila (novagrid-063, концепция —
// D:\Scheduler\UPDATES-SYSTEM.md §§3–5): манифест v2 того же канала
// /updates/novagrid, но ассет для установки — APK (универсальный aarch64).
// Цикл: тихая проверка при старте (калитка 10 минут во фронтенде, образец
// lecards-027) → баннер «⬆ Доступна версия X» → скачивание в cacheDir со
// сверкой sha256 (событие прогресса — то же, что у десктопа) → системная
// установка: всю Android-логику (appop REQUEST_INSTALL_PACKAGES, настройки
// MANAGE_UNKNOWN_APP_SOURCES, FileProvider шаблона gen/android + Intent
// ACTION_VIEW «application/vnd.android.package-archive») ведёт Kotlin-хелпер
// MobileUpdateHelper.kt, Rust вызывает его один статическим методом — прямой
// JNI-путь установки ронял поток (NoSuchMethodError Application.getPackageManager,
// зонд эмулятора novagrid-063). Недоступный центр деградирует молча —
// «не удалось проверить» не ошибка (§5).
//
// Эталон установки — UpdateManager LeCards (lecards-025, PackageInstaller);
// здесь обёртка Tauri, поэтому intent-путь: он не требует callback-приёмника
// и системный установщик сам ведёт диалог подтверждения. Контекст приложения
// берём из ndk-context (его кладёт tao при старте), класс FileProvider —
// через classLoader контекста: FindClass с нативного потока не видит dex.
//
// Модуль компилируется всеми таргетами (структуры/выбор ассета/тесты —
// хостовые), JNI-часть — только Android.

use serde::{Deserialize, Serialize};

#[cfg(target_os = "android")]
use sha2::{Digest, Sha256};
#[cfg(target_os = "android")]
use std::path::PathBuf;
#[cfg(target_os = "android")]
use tauri::{AppHandle, Emitter};

/// Тот же канал и то же окружение-переопределение, что у десктопного
/// updater.rs — живая проверка подменяет манифест.
#[cfg(target_os = "android")]
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
    /// APK-ассет канала; есть только при доступном обновлении
    pub asset: Option<UpdateAsset>,
    pub error: Option<String>,
}

/// Числовое сравнение x.y[.z…] — как у десктопного updater (суффиксы
/// обрезаются, недостающий хвост — 0).
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

/// APK для установки: из assets канала (windows-файлы той же версии
/// пропускаем). Эмуляторные x86-сборки не предлагаем — только arm64 или
/// универсальное имя без abi в названии.
pub(crate) fn pick_apk(assets: &[UpdateAsset]) -> Option<&UpdateAsset> {
    assets
        .iter()
        .filter(|a| a.name.to_ascii_lowercase().ends_with(".apk"))
        .filter(|a| {
            let n = a.name.to_ascii_lowercase();
            !(n.contains("x86") || n.contains("armeabi-v7a"))
        })
        .max_by_key(|a| {
            // предпочитаем явный arm64 над именем без abi
            let n = a.name.to_ascii_lowercase();
            if n.contains("arm64") || n.contains("aarch64") {
                1
            } else {
                0
            }
        })
}

/// TLS-клиент OTA. reqwest 0.13 с фичей «rustls» по умолчанию строит
/// верификатор rustls-platform-verifier — на Android он требует JNI-инициализации
/// (AAR-компонента в gradle) и без неё роняет процесс паникой «Expect
/// rustls-platform-verifier to be initialized» (живой зонд эмулятора,
/// novagrid-063). Вместо этого собираем rustls-конфиг сами со вшитым
/// хранилищем webpki-roots (Mozilla) и отдаём его в use_preconfigured_tls:
/// JVM-компоненты нет вовсе, корни едут с APK и обновляются вместе с
/// приложением — для OTA-канала своей семьи этого достаточно (центр за
/// Cloudflare, сертификаты публичные).
#[cfg(target_os = "android")]
fn http_client() -> Result<reqwest::Client, String> {
    let provider = rustls::crypto::aws_lc_rs::default_provider();
    let tls = rustls::ClientConfig::builder_with_provider(provider.into())
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("tls: {e}"))?
        .with_root_certificates(rustls::RootCertStore {
            roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
        })
        .with_no_client_auth();
    reqwest::Client::builder()
        .use_preconfigured_tls(tls)
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
/// Проверить канал и сравнить версии. Err не возвращает — недоступный
/// центр это статус, а не поломка (тихая деградация, UPDATES-SYSTEM §5).
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
        r.asset = pick_apk(&m.assets).cloned();
        // канала без APK мобильному нечего ставить — показываем как «последняя»,
        // иначе баннер повиснет с кнопкой, которой нечего скачивать
        if r.asset.is_none() {
            r.status = "latest".into();
        }
    } else {
        r.status = "latest".into();
    }
    r
}

#[cfg(target_os = "android")]
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
}

/// Каталог скачивания: cacheDir/updates — FileProvider шаблона шарит
/// cache-path, подталог ограничивает раздачу одним APK обновления.
#[cfg(target_os = "android")]
fn updates_dir() -> Result<PathBuf, String> {
    let base = android_cache_dir()?;
    let dir = base.join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cache: {e}"))?;
    Ok(dir)
}

#[cfg(target_os = "android")]
/// Скачать APK в cacheDir с событиями «novagrid:updater-progress» (то же
/// имя, что у десктопа — фронтенд один) и сверкой sha256 из манифеста.
/// Несовпадение/обрыв удаляют недокачанное — полу-файлы не выживают.
#[tauri::command]
pub async fn updater_download(
    app: AppHandle,
    url: String,
    sha256: String,
    size: u64,
) -> Result<String, String> {
    let client = http_client()?;
    let res = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(10 * 60))
        .send()
        .await
        .map_err(|e| format!("network: {e}"))?
        .error_for_status()
        .map_err(|e| format!("http: {e}"))?;
    let total = size.max(res.content_length().unwrap_or(0));
    let name = url.rsplit('/').next().unwrap_or("novagrid-update.apk");
    let dest = updates_dir()?.join(name);
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

#[cfg(target_os = "android")]
/// Системная установка скачанного APK. Возвращает "started" (открыт
/// установщик) или "needs-permission" (открыты настройки — пользователь
/// разрешает источник и жмёт «Обновить» снова). Отказы хелпера
/// ("file-gone"/"error: …") прокидываются как Err.
#[tauri::command]
pub async fn updater_install(path: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err(format!("downloaded file is gone: {path}"));
    }
    match install_apk(&src)? {
        s if s == "file-gone" || s.starts_with("error:") => Err(s),
        s => Ok(s),
    }
}

// ── JNI: установка через системный установщик Android ────────────────────

#[cfg(target_os = "android")]
mod jni_install {
    // JNI-вызовы установки: vm берём из ndk-context (его кладёт tao при
    // старте, контекст — Application, global ref: не дропаем), классы app'а
    // — через classLoader контекста: FindClass с нативно подключённого
    // потока видит только системные классы (как find_class в tauri-runtime).
    use jni::objects::{JClass, JObject, JString};
    use jni::JNIEnv;
    use std::path::Path;

    /// Подключить поток к JVM и отдать env + контекст приложения в замыкание.
    /// Перед detach гасим висящую Java-исключение: отсоединение потока с
    /// pending exception роняет процесс (FATAL в logcat, поймано в novagrid-063).
    fn with_jni<T>(f: impl FnOnce(&mut JNIEnv, &JObject) -> Result<T, String>) -> Result<T, String> {
        let actx = ndk_context::android_context();
        let vm = unsafe {
            jni::JavaVM::from_raw(actx.vm().cast()).map_err(|e| format!("vm: {e}"))?
        };
        let mut env = vm.attach_current_thread().map_err(|e| format!("attach: {e}"))?;
        let context = unsafe { JObject::from_raw(actx.context().cast()) };
        let out = f(&mut env, &context);
        let _ = env.exception_clear();
        out
    }

    /// java.lang.String из строки Rust (для сигнатур вызовов).
    fn jstr<'a>(env: &mut JNIEnv<'a>, s: &str) -> Result<JString<'a>, String> {
        env.new_string(s).map_err(|e| e.to_string())
    }

    /// Вызов метода без аргументов, возвращающего объект.
    fn call_obj<'a>(
        env: &mut JNIEnv<'a>,
        obj: &JObject,
        name: &str,
        sig: &str,
    ) -> Result<JObject<'a>, String> {
        env.call_method(obj, name, sig, &[])
            .map_err(|e| format!("{name}: {e}"))?
            .l()
            .map_err(|e| format!("{name}: {e}"))
    }

    /// Строковое поле объекта (getPackageName, getAbsolutePath…).
    fn call_string(env: &mut JNIEnv, obj: &JObject, name: &str, sig: &str) -> Result<String, String> {
        let s = call_obj(env, obj, name, sig)?;
        let js = JString::from(s);
        env.get_string(&js)
            .map(|s| s.to_string_lossy().into_owned())
            .map_err(|e| format!("{name}: {e}"))
    }

    /// Класс из dex приложения — через classLoader контекста.
    fn app_class<'a>(env: &mut JNIEnv<'a>, context: &JObject, name: &str) -> Result<JClass<'a>, String> {
        let loader = call_obj(env, context, "getClassLoader", "()Ljava/lang/ClassLoader;")?;
        let jname = jstr(env, name)?;
        let class = env
            .call_method(
                &loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[(&jname).into()],
            )
            .map_err(|e| format!("loadClass {name}: {e}"))?
            .l()
            .map_err(|e| format!("loadClass: {e}"))?;
        Ok(JClass::from(class))
    }

    /// Запуск активности контекстом приложения (нужен FLAG_NEW_TASK).
    /// cacheDir приложения (getCacheDir контекста).
    pub fn cache_dir() -> Result<std::path::PathBuf, String> {
        with_jni(|env, context| {
            let dir = call_obj(env, context, "getCacheDir", "()Ljava/io/File;")?;
            let s = call_string(env, &dir, "getAbsolutePath", "()Ljava/lang/String;")?;
            Ok(Path::new(&s).to_path_buf())
        })
    }

    /// Установка — через Kotlin-хелпер gen/android (MobileUpdateHelper.install):
    /// проверку appop, настройки источника, FileProvider и Intent ведёт Kotlin,
    /// из Rust один статический вызов (меньше JNI-поверхности; прямой JNI-путь
    /// падал на GetMethodID «Application.getPackageManager» — NoSuchMethodError,
    /// живой зонд эмулятора novagrid-063). Возврат хелпера — как у команды
    /// updater_install: 'started' | 'needs-permission' | 'file-gone' | 'error: …'.
    pub fn install(apk: &Path) -> Result<String, String> {
        let path = apk.to_string_lossy().into_owned();
        with_jni(|env, context| {
            let helper = app_class(env, context, "app/novagrid/mobile/MobileUpdateHelper")?;
            let jpath = jstr(env, &path)?;
            let r = env
                .call_static_method(
                    &helper,
                    "install",
                    "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                    &[context.into(), (&jpath).into()],
                )
                .map_err(|e| format!("helper: {e}"))?
                .l()
                .map_err(|e| format!("helper: {e}"))?;
            let js = JString::from(r);
            env.get_string(&js)
                .map(|s| s.to_string_lossy().into_owned())
                .map_err(|e| format!("helper str: {e}"))
        })
    }
}

#[cfg(target_os = "android")]
use jni_install as jni_impl;

#[cfg(target_os = "android")]
pub(crate) fn android_cache_dir() -> Result<PathBuf, String> {
    jni_impl::cache_dir()
}

#[cfg(target_os = "android")]
fn install_apk(apk: &std::path::Path) -> Result<String, String> {
    jni_impl::install(apk)
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
        assert!(version_lt("1.29.0", "1.30.0"));
        assert!(version_lt("1.9", "1.10.0")); // числа, не строки
        assert!(!version_lt("1.30.0", "1.30.0"));
        assert!(!version_lt("1.31.0-beta", "1.31.0")); // суффикс обрезается
    }

    #[test]
    fn picks_apk_ignores_windows_and_x86() {
        let assets = vec![
            asset("novagrid-1.30.0-portable-release.exe"),
            asset("novagrid-1.30.0-portable-release.zip"),
            asset("novagrid-1.30.0-x86_64-release.apk"),
            asset("novagrid-1.30.0-arm64-v8a-release.apk"),
        ];
        let picked = pick_apk(&assets).expect("arm64 apk must be picked");
        assert_eq!(picked.name, "novagrid-1.30.0-arm64-v8a-release.apk");
    }

    #[test]
    fn picks_universal_apk_when_no_abi_named() {
        let assets = vec![
            asset("novagrid-1.30.0-portable-release.exe"),
            asset("NovaGrid-1.30.0-android-release.apk"),
        ];
        let picked = pick_apk(&assets).expect("universal apk must be picked");
        assert_eq!(picked.name, "NovaGrid-1.30.0-android-release.apk");
    }

    #[test]
    fn no_apk_means_no_asset() {
        let assets = vec![
            asset("novagrid-1.30.0-portable-release.exe"),
            asset("novagrid-1.30.0-setup-release.msi"),
        ];
        assert!(pick_apk(&assets).is_none());
    }
}
