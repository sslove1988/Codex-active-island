mod clipboard_history;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    env, fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, LogicalSize, Manager, PhysicalPosition, Position, Size, WebviewWindow,
};
#[cfg(windows)]
use windows::Win32::{
    Foundation::RPC_E_CHANGED_MODE,
    Media::Audio::Endpoints::IAudioMeterInformation,
    Media::Audio::{
        eCommunications, eConsole, eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    },
    System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    },
    UI::{
        Input::KeyboardAndMouse::{
            keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_MEDIA_NEXT_TRACK,
            VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK,
        },
    },
};

const WINDOW_LABEL: &str = "main";
const STAGE_WINDOW_WIDTH: f64 = 820.0;
const STAGE_WINDOW_HEIGHT: f64 = 460.0;
const DEFAULT_MARGIN_Y: f64 = 12.0;
const DEFAULT_SCALE: f64 = 1.0;
const COLLAPSED_ISLAND_WIDTH: f64 = 380.0;
const COLLAPSED_ISLAND_HEIGHT: f64 = 72.0;
const EXPANDED_ISLAND_WIDTH: f64 = 560.0;
const DEFAULT_EXPANDED_ISLAND_HEIGHT: f64 = 306.0;
const EXPANDED_ISLAND_HEIGHT_RANGE: f64 = 240.0;
const EXPANDED_RADIUS: f64 = 30.0;
const STAGE_WINDOW_PADDING_Y: f64 = 24.0;
const TUCKED_VISIBLE_EDGE_HEIGHT: f64 = 10.0;
#[cfg(windows)]
const STARTUP_REGISTRY_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const STARTUP_REGISTRY_VALUE: &str = "FocuSD Island";
const AUDIO_ACTIVE_THRESHOLD: f32 = 0.000015;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const AGENT_STATUS_FILE_NAME: &str = "agent-status.json";
const CODEX_RUNNING_MARKER_FILE_NAME: &str = "agent-codex-running.flag";
const CODEX_RUNNING_HOLD_FILE_NAME: &str = "agent-codex-running-hold.flag";
const CLAUDE_CODE_RUNNING_MARKER_FILE_NAME: &str = "agent-claudeCode-running.flag";
const CLAUDE_CODE_RUNNING_HOLD_FILE_NAME: &str = "agent-claudeCode-running-hold.flag";
#[cfg(windows)]
const AGENT_RUNNING_SCRIPT_FILE_NAME: &str = "focusd-agent-running.cmd";
#[cfg(not(windows))]
const AGENT_RUNNING_SCRIPT_FILE_NAME: &str = "focusd-agent-running.sh";
#[cfg(windows)]
const AGENT_STATUS_SCRIPT_FILE_NAME: &str = "focusd-agent-status.ps1";
#[cfg(not(windows))]
const AGENT_STATUS_SCRIPT_FILE_NAME: &str = "focusd-agent-status.sh";
const FOCUSD_AGENT_HOOK_BLOCK_BEGIN: &str = "# BEGIN FocuSD Agent Status Hooks";
const FOCUSD_AGENT_HOOK_BLOCK_END: &str = "# END FocuSD Agent Status Hooks";
const FOCUSD_AGENT_HOOK_SIGNATURE: &str = "focusd-agent-";
#[cfg(windows)]
const AGENT_RUNNING_SCRIPT: &str = include_str!("../../scripts/focusd-agent-running.cmd");
#[cfg(not(windows))]
const AGENT_RUNNING_SCRIPT: &str = include_str!("../../scripts/focusd-agent-running.sh");
#[cfg(windows)]
const AGENT_STATUS_SCRIPT: &str = include_str!("../../scripts/focusd-agent-status.ps1");
#[cfg(not(windows))]
const AGENT_STATUS_SCRIPT: &str = include_str!("../../scripts/focusd-agent-status.sh");

static WINDOW_STATE: OnceLock<Mutex<IslandWindowState>> = OnceLock::new();
static CODEX_SESSION_CACHE: OnceLock<Mutex<CodexSessionCache>> = OnceLock::new();

#[derive(Default)]
struct CodexSessionCache {
    checked_at: i64,
    discovered_at: i64,
    session_path: Option<PathBuf>,
    session_modified_at: i64,
    status: Option<AgentTaskStatus>,
}

#[derive(Clone, Copy)]
enum IslandMode {
    Collapsed,
    Expanded,
}

impl IslandMode {
    fn from_value(value: &str) -> Result<Self, String> {
        match value {
            "collapsed" => Ok(Self::Collapsed),
            "expanded" => Ok(Self::Expanded),
            _ => Err(format!("Unsupported island mode: {value}")),
        }
    }

    fn base_size(self, expanded_height: f64) -> (f64, f64) {
        match self {
            Self::Collapsed => (COLLAPSED_ISLAND_WIDTH, COLLAPSED_ISLAND_HEIGHT),
            Self::Expanded => (EXPANDED_ISLAND_WIDTH, expanded_height),
        }
    }

    fn corner_radius(self) -> f64 {
        match self {
            Self::Collapsed => COLLAPSED_ISLAND_HEIGHT / 2.0,
            Self::Expanded => EXPANDED_RADIUS,
        }
    }
}

#[derive(Clone, Copy)]
struct IslandWindowState {
    mode: IslandMode,
    is_tucked: bool,
    size_scale: f64,
    margin_y: f64,
    expanded_height: f64,
    custom_position: Option<(i32, i32)>,
}

impl Default for IslandWindowState {
    fn default() -> Self {
        Self {
            mode: IslandMode::Collapsed,
            is_tucked: false,
            size_scale: DEFAULT_SCALE,
            margin_y: DEFAULT_MARGIN_Y,
            expanded_height: DEFAULT_EXPANDED_ISLAND_HEIGHT,
            custom_position: None,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IslandLayout {
    size_scale: f64,
    margin_y: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveTodoMarkdownResult {
    file_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaState {
    available: bool,
    audio_active: bool,
    audio_peak: f32,
    playback_status: String,
    updated_at: i64,
}

impl Default for MediaState {
    fn default() -> Self {
        Self {
            available: false,
            audio_active: false,
            audio_peak: 0.0,
            playback_status: "unavailable".to_string(),
            updated_at: current_unix_millis(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentTaskStatus {
    #[serde(default = "default_agent_phase")]
    phase: String,
    #[serde(default)]
    task_id: Option<String>,
    #[serde(default)]
    updated_at: i64,
}

impl Default for AgentTaskStatus {
    fn default() -> Self {
        Self {
            phase: default_agent_phase(),
            task_id: None,
            updated_at: 0,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAgentStatus {
    #[serde(default)]
    codex: AgentTaskStatus,
    #[serde(default)]
    claude_code: AgentTaskStatus,
    #[serde(default)]
    updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentStatusSnapshot {
    codex: AgentTaskStatus,
    claude_code: AgentTaskStatus,
    updated_at: i64,
    status_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentHooksInstallResult {
    scripts_dir: String,
    status_path: String,
    codex_config_path: String,
    claude_config_path: String,
    installed_at: i64,
}

fn default_agent_phase() -> String {
    "idle".to_string()
}

#[tauri::command]
fn set_island_layout(app: AppHandle, layout: IslandLayout) -> Result<(), String> {
    let window = main_window(&app)?;
    let state = mutate_window_state(|state| {
        state.size_scale = layout.size_scale.clamp(0.75, 1.4);
        state.margin_y = layout.margin_y.clamp(0.0, 160.0);
        *state
    });
    apply_stage_geometry(&window, state)
}

#[tauri::command]
fn set_island_custom_position(app: AppHandle, x: i32, y: i32, apply: Option<bool>) -> Result<(), String> {
    let window = main_window(&app)?;
    let state = mutate_window_state(|state| {
        state.custom_position = Some((x, y));
        *state
    });
    if apply.unwrap_or(false) {
        apply_stage_geometry(&window, state)
    } else {
        Ok(())
    }
}

#[tauri::command]
fn reset_island_position(app: AppHandle) -> Result<(), String> {
    let window = main_window(&app)?;
    let state = mutate_window_state(|state| {
        state.custom_position = None;
        *state
    });
    apply_stage_geometry(&window, state)
}

#[tauri::command]
fn set_island_interaction(
    app: AppHandle,
    mode: String,
    size_scale: f64,
    margin_y: Option<f64>,
    expanded_height: Option<f64>,
    is_tucked: Option<bool>,
) -> Result<(), String> {
    let window = main_window(&app)?;
    let mode = IslandMode::from_value(&mode)?;
    let state = mutate_window_state(|state| {
        state.mode = mode;
        state.is_tucked = is_tucked.unwrap_or(false);
        state.size_scale = size_scale.clamp(0.75, 1.4);
        if let Some(margin_y) = margin_y {
            state.margin_y = margin_y.clamp(0.0, 160.0);
        }
        if let Some(expanded_height) = expanded_height {
            state.expanded_height = expanded_height.clamp(
                DEFAULT_EXPANDED_ISLAND_HEIGHT,
                DEFAULT_EXPANDED_ISLAND_HEIGHT + EXPANDED_ISLAND_HEIGHT_RANGE,
            );
        }
        *state
    });
    apply_stage_geometry(&window, state)
}

#[tauri::command]
fn minimize_island(app: AppHandle) -> Result<(), String> {
    hide_island(&app);
    Ok(())
}

#[tauri::command]
fn show_ready_island(app: AppHandle) -> Result<(), String> {
    show_island(&app)
}

#[tauri::command]
#[cfg(windows)]
fn get_launch_at_startup() -> Result<bool, String> {
    let mut command = Command::new("reg");
    let status = command
        .creation_flags(CREATE_NO_WINDOW)
        .args(["query", STARTUP_REGISTRY_KEY, "/v", STARTUP_REGISTRY_VALUE])
        .status()
        .map_err(|error| format!("Failed to query startup registry: {error}"))?;

    Ok(status.success())
}

#[tauri::command]
#[cfg(windows)]
fn set_launch_at_startup(enabled: bool) -> Result<(), String> {
    let status = if enabled {
        let current_exe = std::env::current_exe()
            .map_err(|error| format!("Failed to resolve current executable: {error}"))?;
        let startup_value = format!("\"{}\"", current_exe.display());

        let mut command = Command::new("reg");
        command
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "add",
                STARTUP_REGISTRY_KEY,
                "/v",
                STARTUP_REGISTRY_VALUE,
                "/t",
                "REG_SZ",
                "/d",
            ])
            .arg(startup_value)
            .arg("/f")
            .status()
    } else {
        let mut command = Command::new("reg");
        command
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "delete",
                STARTUP_REGISTRY_KEY,
                "/v",
                STARTUP_REGISTRY_VALUE,
                "/f",
            ])
            .status()
    }
    .map_err(|error| format!("Failed to update startup registry: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Startup registry command failed.".to_string())
    }
}

#[tauri::command]
#[cfg(not(windows))]
fn get_launch_at_startup() -> Result<bool, String> {
    Ok(launch_agent_path()?.is_file())
}

#[tauri::command]
#[cfg(not(windows))]
fn set_launch_at_startup(enabled: bool) -> Result<(), String> {
    let path = launch_agent_path()?;
    if !enabled {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("Failed to remove launch agent: {error}"))?;
        }
        return Ok(());
    }

    let executable = env::current_exe()
        .map_err(|error| format!("Failed to resolve current executable: {error}"))?;
    let executable = xml_escape(&executable.to_string_lossy());
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.focusd.island</string>
  <key>ProgramArguments</key>
  <array><string>{executable}</string></array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
"#
    );
    write_text_file(&path, &plist)
}

#[cfg(not(windows))]
fn launch_agent_path() -> Result<PathBuf, String> {
    Ok(user_home_dir()?
        .join("Library")
        .join("LaunchAgents")
        .join("com.focusd.island.plist"))
}

#[cfg(not(windows))]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[tauri::command]
fn save_todo_markdown(
    directory: String,
    date: String,
    content: String,
) -> Result<SaveTodoMarkdownResult, String> {
    let directory = directory.trim();

    if directory.is_empty() {
        return Err("Todo save path is empty.".to_string());
    }

    if !date.chars().all(|ch| ch.is_ascii_digit() || ch == '-') {
        return Err("Todo date contains invalid filename characters.".to_string());
    }

    let directory_path = PathBuf::from(directory);
    fs::create_dir_all(&directory_path).map_err(|error| error.to_string())?;

    let file_path = directory_path.join(format!("{date}.md"));
    fs::write(&file_path, content).map_err(|error| error.to_string())?;

    Ok(SaveTodoMarkdownResult {
        file_path: file_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn get_default_todo_save_directory() -> Result<String, String> {
    let home_dir = user_home_dir()?;
    Ok(home_dir
        .join("Documents")
        .join("FocuSD")
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
fn get_agent_status(app: AppHandle) -> Result<AgentStatusSnapshot, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    fs::create_dir_all(&app_dir)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;

    let status_path = app_dir.join(AGENT_STATUS_FILE_NAME);
    let status_path_display = status_path.to_string_lossy().to_string();
    let mut snapshot = match fs::read_to_string(&status_path) {
        Ok(content) => match serde_json::from_str::<PersistedAgentStatus>(&content) {
            Ok(persisted) => agent_status_snapshot_from_persisted(persisted, status_path_display),
            Err(_) => default_agent_status_snapshot(status_path_display),
        },
        Err(_) => default_agent_status_snapshot(status_path_display),
    };
    apply_agent_running_markers(&app_dir, &mut snapshot);
    apply_codex_desktop_session_status(&mut snapshot);

    Ok(snapshot)
}

#[tauri::command]
fn install_agent_status_hooks(app: AppHandle) -> Result<AgentHooksInstallResult, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    fs::create_dir_all(&app_dir)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;

    install_agent_hook_scripts(&app_dir)?;

    let running_script_path = app_dir.join(AGENT_RUNNING_SCRIPT_FILE_NAME);
    let status_script_path = app_dir.join(AGENT_STATUS_SCRIPT_FILE_NAME);
    let home_dir = user_home_dir()?;
    let codex_config_path = home_dir.join(".codex").join("config.toml");
    let claude_config_path = home_dir.join(".claude").join("settings.json");

    install_codex_status_hooks(
        &codex_config_path,
        &running_script_path,
        &status_script_path,
    )?;
    install_claude_code_status_hooks(
        &claude_config_path,
        &running_script_path,
        &status_script_path,
    )?;

    Ok(AgentHooksInstallResult {
        scripts_dir: app_dir.to_string_lossy().to_string(),
        status_path: app_dir
            .join(AGENT_STATUS_FILE_NAME)
            .to_string_lossy()
            .to_string(),
        codex_config_path: codex_config_path.to_string_lossy().to_string(),
        claude_config_path: claude_config_path.to_string_lossy().to_string(),
        installed_at: current_unix_millis(),
    })
}

#[tauri::command]
fn get_media_state() -> MediaState {
    read_media_state()
}

#[tauri::command]
fn get_audio_level() -> AudioLevel {
    let peak = read_system_audio_peak_window(6, Duration::from_millis(8)).unwrap_or(0.0);

    AudioLevel {
        active: peak > AUDIO_ACTIVE_THRESHOLD,
        peak,
        updated_at: current_unix_millis(),
    }
}

#[tauri::command]
#[cfg(windows)]
fn media_play_pause() {
    send_media_key(VK_MEDIA_PLAY_PAUSE);
}

#[tauri::command]
#[cfg(not(windows))]
fn media_play_pause() {
    run_macos_media_command("playpause");
}

#[tauri::command]
#[cfg(windows)]
fn media_next() {
    send_media_key(VK_MEDIA_NEXT_TRACK);
}

#[tauri::command]
#[cfg(not(windows))]
fn media_next() {
    run_macos_media_command("next track");
}

#[tauri::command]
#[cfg(windows)]
fn media_previous() {
    send_media_key(VK_MEDIA_PREV_TRACK);
}

#[tauri::command]
#[cfg(not(windows))]
fn media_previous() {
    run_macos_media_command("previous track");
}

#[cfg(windows)]
fn read_media_state() -> MediaState {
    let audio_peak = read_system_audio_peak_window(3, Duration::from_millis(6)).unwrap_or(0.0);
    let audio_active = audio_peak > AUDIO_ACTIVE_THRESHOLD;

    MediaState {
        available: audio_active,
        audio_active,
        audio_peak,
        playback_status: if audio_active {
            "playing"
        } else {
            "unavailable"
        }
        .to_string(),
        updated_at: current_unix_millis(),
    }
}

#[cfg(not(windows))]
fn read_media_state() -> MediaState {
    let playback_status = macos_playback_status();
    let available = playback_status != "unavailable";
    let audio_active = playback_status == "playing";

    MediaState {
        available,
        audio_active,
        audio_peak: if audio_active { 0.35 } else { 0.0 },
        playback_status,
        updated_at: current_unix_millis(),
    }
}

#[cfg(not(windows))]
fn macos_playback_status() -> String {
    let script = r#"
tell application "System Events"
  set spotifyRunning to (name of processes) contains "Spotify"
  set musicRunning to (name of processes) contains "Music"
end tell
if spotifyRunning then
  tell application "Spotify" to return (player state as text)
else if musicRunning then
  tell application "Music" to return (player state as text)
else
  return "unavailable"
end if
"#;
    let output = Command::new("osascript").args(["-e", script]).output();
    let Ok(output) = output else {
        return "unavailable".to_string();
    };
    let state = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_ascii_lowercase();
    match state.as_str() {
        "playing" => "playing".to_string(),
        "paused" | "stopped" => "paused".to_string(),
        _ => "unavailable".to_string(),
    }
}

#[cfg(not(windows))]
fn run_macos_media_command(action: &str) {
    let script = format!(
        r#"
tell application "System Events"
  set spotifyRunning to (name of processes) contains "Spotify"
  set musicRunning to (name of processes) contains "Music"
end tell
if spotifyRunning then
  tell application "Spotify" to {action}
else if musicRunning then
  tell application "Music" to {action}
end if
"#
    );
    if let Err(error) = Command::new("osascript").args(["-e", &script]).status() {
        eprintln!("failed to control macOS media: {error}");
    }
}

fn default_agent_status_snapshot(status_path: String) -> AgentStatusSnapshot {
    AgentStatusSnapshot {
        codex: AgentTaskStatus::default(),
        claude_code: AgentTaskStatus::default(),
        updated_at: current_unix_millis(),
        status_path,
    }
}

fn agent_status_snapshot_from_persisted(
    persisted: PersistedAgentStatus,
    status_path: String,
) -> AgentStatusSnapshot {
    AgentStatusSnapshot {
        codex: normalize_agent_task_status(persisted.codex),
        claude_code: normalize_agent_task_status(persisted.claude_code),
        updated_at: if persisted.updated_at > 0 {
            persisted.updated_at
        } else {
            current_unix_millis()
        },
        status_path,
    }
}

fn apply_agent_running_markers(app_dir: &Path, snapshot: &mut AgentStatusSnapshot) {
    let now = current_unix_millis();

    if let Some(updated_at) = active_agent_running_marker_time(
        app_dir,
        &snapshot.codex,
        CODEX_RUNNING_MARKER_FILE_NAME,
        CODEX_RUNNING_HOLD_FILE_NAME,
        now,
    ) {
        snapshot.codex.phase = "running".to_string();
        snapshot.codex.updated_at = updated_at;
    }

    if let Some(updated_at) = active_agent_running_marker_time(
        app_dir,
        &snapshot.claude_code,
        CLAUDE_CODE_RUNNING_MARKER_FILE_NAME,
        CLAUDE_CODE_RUNNING_HOLD_FILE_NAME,
        now,
    ) {
        snapshot.claude_code.phase = "running".to_string();
        snapshot.claude_code.updated_at = updated_at;
    }
}

fn apply_codex_desktop_session_status(snapshot: &mut AgentStatusSnapshot) {
    let Some(status) = codex_desktop_session_status() else {
        return;
    };

    // A fresh desktop session event is more reliable for the Codex app than
    // hooks, while hooks remain available for CLI and IDE clients.
    if status.updated_at >= snapshot.codex.updated_at {
        snapshot.codex = status;
        snapshot.updated_at = snapshot.updated_at.max(snapshot.codex.updated_at);
    }
}

fn codex_desktop_session_status() -> Option<AgentTaskStatus> {
    let now = current_unix_millis();
    let cache = CODEX_SESSION_CACHE.get_or_init(|| Mutex::new(CodexSessionCache::default()));
    let mut cache = cache.lock().ok()?;

    if now - cache.checked_at < 150 {
        return age_codex_session_status(cache.status.clone(), now);
    }
    cache.checked_at = now;

    if cache.session_path.is_none() || now - cache.discovered_at >= 500 {
        cache.discovered_at = now;
        let sessions_root = user_home_dir().ok()?.join(".codex").join("sessions");
        cache.session_path = newest_jsonl_file(&sessions_root);
    }

    let session_path = cache.session_path.clone()?;
    let modified_at = file_modified_unix_millis(&session_path)?;
    if modified_at != cache.session_modified_at {
        cache.session_modified_at = modified_at;
        cache.status = parse_codex_session_tail(&session_path, modified_at);
    }

    age_codex_session_status(cache.status.clone(), now)
}

fn age_codex_session_status(
    status: Option<AgentTaskStatus>,
    now: i64,
) -> Option<AgentTaskStatus> {
    let mut status = status?;
    let age = now.saturating_sub(status.updated_at);
    if status.phase == "completed" && age > 4_000 {
        status.phase = "idle".to_string();
    } else if status.phase == "failed" && age > 8_000 {
        status.phase = "idle".to_string();
    } else if status.phase == "running" && age > 2 * 60 * 1_000 {
        status.phase = "idle".to_string();
    }
    Some(status)
}

fn newest_jsonl_file(root: &Path) -> Option<PathBuf> {
    fn visit(directory: &Path, newest: &mut Option<(SystemTime, PathBuf)>) {
        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                visit(&path, newest);
                continue;
            }
            if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(modified) = entry.metadata().ok().and_then(|metadata| metadata.modified().ok()) else {
                continue;
            };
            if newest.as_ref().map(|(time, _)| modified > *time).unwrap_or(true) {
                *newest = Some((modified, path));
            }
        }
    }

    let mut newest = None;
    visit(root, &mut newest);
    newest.map(|(_, path)| path)
}

fn parse_codex_session_tail(path: &Path, modified_at: i64) -> Option<AgentTaskStatus> {
    const MAX_SESSION_TAIL_BYTES: u64 = 768 * 1024;
    let mut file = fs::File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    let start = length.saturating_sub(MAX_SESSION_TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut content = String::new();
    file.read_to_string(&mut content).ok()?;
    if start > 0 {
        if let Some(first_newline) = content.find('\n') {
            content = content[first_newline + 1..].to_string();
        }
    }

    let mut last_start = None;
    let mut last_terminal: Option<(usize, &str)> = None;
    let mut last_turn_id = None;
    for (index, line) in content.lines().enumerate() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let top_type = value.get("type").and_then(Value::as_str);
        let payload = &value["payload"];
        let event_type = if top_type == Some("event_msg") {
            payload.get("type").and_then(Value::as_str)
        } else {
            top_type
        };
        match event_type {
            Some("task_started") | Some("user_message") => {
                last_start = Some(index);
                last_turn_id = value
                    .pointer("/payload/turn_id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| {
                        value
                            .pointer("/payload/internal_chat_message_metadata_passthrough/turn_id")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    });
            }
            Some("task_complete") => last_terminal = Some((index, "completed")),
            Some("turn_aborted") | Some("task_cancelled") | Some("task_canceled") => {
                last_terminal = Some((index, "idle"));
            }
            Some("task_failed") | Some("turn_failed") => {
                last_terminal = Some((index, "failed"));
            }
            _ => {}
        }
    }

    let start_index = last_start?;
    let phase = last_terminal
        .filter(|(index, _)| *index > start_index)
        .map(|(_, phase)| phase)
        .unwrap_or("running");
    Some(AgentTaskStatus {
        phase: phase.to_string(),
        task_id: last_turn_id,
        updated_at: modified_at,
    })
}

#[cfg(test)]
mod codex_session_status_tests {
    use super::*;

    fn parse_events(events: &[&str]) -> AgentTaskStatus {
        let path = env::temp_dir().join(format!(
            "focus-codex-status-{}-{}.jsonl",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        fs::write(&path, events.join("\n")).expect("write test session");
        let status = parse_codex_session_tail(&path, 10_000).expect("parse test session");
        let _ = fs::remove_file(path);
        status
    }

    #[test]
    fn detects_task_start_and_completion() {
        let running = parse_events(&[
            r#"{"type":"task_started","payload":{"turn_id":"turn-1"}}"#,
            r#"{"type":"event_msg","payload":{"type":"user_message","turn_id":"turn-1"}}"#,
        ]);
        assert_eq!(running.phase, "running");
        assert_eq!(running.task_id.as_deref(), Some("turn-1"));

        let completed = parse_events(&[
            r#"{"type":"task_started","payload":{"turn_id":"turn-1"}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete"}}"#,
        ]);
        assert_eq!(completed.phase, "completed");
    }

    #[test]
    fn newer_task_overrides_previous_completion() {
        let status = parse_events(&[
            r#"{"type":"task_started","payload":{"turn_id":"turn-1"}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_complete"}}"#,
            r#"{"type":"task_started","payload":{"turn_id":"turn-2"}}"#,
        ]);
        assert_eq!(status.phase, "running");
        assert_eq!(status.task_id.as_deref(), Some("turn-2"));
    }

    #[test]
    fn aborted_task_returns_to_idle() {
        let status = parse_events(&[
            r#"{"type":"task_started","payload":{"turn_id":"turn-1"}}"#,
            r#"{"type":"event_msg","payload":{"type":"turn_aborted"}}"#,
        ]);
        assert_eq!(status.phase, "idle");
    }
}

fn active_agent_running_marker_time(
    app_dir: &Path,
    status: &AgentTaskStatus,
    running_file_name: &str,
    hold_file_name: &str,
    now: i64,
) -> Option<i64> {
    let running_path = app_dir.join(running_file_name);
    if running_path.is_file() {
        let marker_updated_at = file_modified_unix_millis(&running_path).unwrap_or(now);
        if status.phase != "running"
            && status.updated_at > 0
            && status.updated_at >= marker_updated_at
        {
            return None;
        }

        return Some(marker_updated_at);
    }

    let hold_path = app_dir.join(hold_file_name);
    let visible_until = fs::read_to_string(hold_path)
        .ok()
        .and_then(|content| content.trim().parse::<i64>().ok())?;
    if visible_until > now {
        Some(now)
    } else {
        None
    }
}

fn normalize_agent_task_status(mut status: AgentTaskStatus) -> AgentTaskStatus {
    if !matches!(
        status.phase.as_str(),
        "idle" | "running" | "completed" | "failed"
    ) {
        status.phase = default_agent_phase();
    }

    status
}

fn install_agent_hook_scripts(app_dir: &Path) -> Result<(), String> {
    let running_path = app_dir.join(AGENT_RUNNING_SCRIPT_FILE_NAME);
    let status_path = app_dir.join(AGENT_STATUS_SCRIPT_FILE_NAME);
    write_text_file(&running_path, &normalize_script_contents(AGENT_RUNNING_SCRIPT))?;
    write_text_file(&status_path, &normalize_script_contents(AGENT_STATUS_SCRIPT))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in [&running_path, &status_path] {
            let mut permissions = fs::metadata(path)
                .map_err(|error| format!("Failed to read script permissions: {error}"))?
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions)
                .map_err(|error| format!("Failed to make script executable: {error}"))?;
        }
    }

    Ok(())
}

fn install_codex_status_hooks(
    config_path: &Path,
    running_script_path: &Path,
    status_script_path: &Path,
) -> Result<(), String> {
    let content = fs::read_to_string(config_path).unwrap_or_default();
    let content = remove_managed_codex_hook_block(&content);
    let block = build_codex_hook_block(running_script_path, status_script_path);
    let mut next_content = content.trim_end().to_string();
    if !next_content.is_empty() {
        next_content.push_str("\n\n");
    }
    next_content.push_str(&block);

    write_text_file(config_path, &next_content)
}

fn install_claude_code_status_hooks(
    config_path: &Path,
    running_script_path: &Path,
    status_script_path: &Path,
) -> Result<(), String> {
    let mut config = match fs::read_to_string(config_path) {
        Ok(content) if !content.trim().is_empty() => serde_json::from_str::<Value>(&content)
            .map_err(|error| format!("Failed to parse Claude Code settings.json: {error}"))?,
        _ => json!({}),
    };

    let Some(root) = config.as_object_mut() else {
        return Err("Claude Code settings.json must contain a JSON object.".to_string());
    };

    let hooks = root
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()));
    if !hooks.is_object() {
        *hooks = Value::Object(Map::new());
    }
    let hooks = hooks
        .as_object_mut()
        .ok_or_else(|| "Failed to prepare Claude Code hooks object.".to_string())?;

    install_claude_code_hook_event(
        hooks,
        "UserPromptSubmit",
        claude_code_running_hook_entry(running_script_path),
    );
    install_claude_code_hook_event(
        hooks,
        "PreToolUse",
        claude_code_match_all_hook_entry(claude_code_running_hook_entry(running_script_path)),
    );
    install_claude_code_hook_event(
        hooks,
        "Stop",
        claude_code_status_hook_entry(status_script_path, "completed"),
    );
    install_claude_code_hook_event(
        hooks,
        "StopFailure",
        claude_code_status_hook_entry(status_script_path, "failed"),
    );

    let json = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("Failed to serialize Claude Code settings.json: {error}"))?;
    write_text_file(config_path, &json)
}

fn install_claude_code_hook_event(hooks: &mut Map<String, Value>, event_name: &str, entry: Value) {
    let mut entries = hooks
        .remove(event_name)
        .and_then(|value| match value {
            Value::Array(entries) => Some(entries),
            _ => None,
        })
        .unwrap_or_default()
        .into_iter()
        .filter_map(remove_managed_claude_code_hooks)
        .collect::<Vec<_>>();

    entries.push(entry);
    hooks.insert(event_name.to_string(), Value::Array(entries));
}

fn remove_managed_claude_code_hooks(mut entry: Value) -> Option<Value> {
    let Value::Object(entry_object) = &mut entry else {
        return Some(entry);
    };

    let Some(hooks_value) = entry_object.get_mut("hooks") else {
        return Some(entry);
    };

    let Value::Array(hooks) = hooks_value else {
        return Some(entry);
    };

    hooks.retain(|hook| !value_contains_focusd_hook_signature(hook));
    if hooks.is_empty() {
        None
    } else {
        Some(entry)
    }
}

fn value_contains_focusd_hook_signature(value: &Value) -> bool {
    match value {
        Value::String(text) => text.contains(FOCUSD_AGENT_HOOK_SIGNATURE),
        Value::Array(values) => values.iter().any(value_contains_focusd_hook_signature),
        Value::Object(values) => values.values().any(value_contains_focusd_hook_signature),
        _ => false,
    }
}

fn claude_code_match_all_hook_entry(mut entry: Value) -> Value {
    if let Value::Object(object) = &mut entry {
        object.insert("matcher".to_string(), Value::String("*".to_string()));
    }

    entry
}

#[cfg(windows)]
fn claude_code_running_hook_entry(script_path: &Path) -> Value {
    claude_code_hook_entry(
        "cmd.exe",
        vec![
            "/d".to_string(),
            "/s".to_string(),
            "/c".to_string(),
            format!("\"{}\" claudeCode", script_path.to_string_lossy()),
        ],
        1,
    )
}

#[cfg(not(windows))]
fn claude_code_running_hook_entry(script_path: &Path) -> Value {
    claude_code_hook_entry(
        "/bin/sh",
        vec![
            script_path.to_string_lossy().to_string(),
            "claudeCode".to_string(),
        ],
        1,
    )
}

#[cfg(windows)]
fn claude_code_status_hook_entry(script_path: &Path, phase: &str) -> Value {
    claude_code_hook_entry(
        "powershell.exe",
        vec![
            "-NoProfile".to_string(),
            "-ExecutionPolicy".to_string(),
            "Bypass".to_string(),
            "-File".to_string(),
            script_path.to_string_lossy().to_string(),
            "claudeCode".to_string(),
            phase.to_string(),
        ],
        5,
    )
}

#[cfg(not(windows))]
fn claude_code_status_hook_entry(script_path: &Path, phase: &str) -> Value {
    claude_code_hook_entry(
        "/bin/sh",
        vec![
            script_path.to_string_lossy().to_string(),
            "claudeCode".to_string(),
            phase.to_string(),
        ],
        5,
    )
}

fn claude_code_hook_entry(command: &str, args: Vec<String>, timeout: i64) -> Value {
    json!({
        "hooks": [
            {
                "type": "command",
                "command": command,
                "args": args,
                "timeout": timeout
            }
        ]
    })
}

#[cfg(windows)]
fn build_codex_hook_block(running_script_path: &Path, status_script_path: &Path) -> String {
    let submit_command = agent_running_command(running_script_path, "codex");
    let stop_command = agent_status_command(status_script_path, "codex", "completed");

    format!(
        r#"{begin}

[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = {submit_command}
command_windows = {submit_command}
timeout = 1
statusMessage = "Updating FocuSD agent status"

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = {stop_command}
command_windows = {stop_command}
timeout = 5
statusMessage = "Updating FocuSD agent status"

{end}"#,
        begin = FOCUSD_AGENT_HOOK_BLOCK_BEGIN,
        end = FOCUSD_AGENT_HOOK_BLOCK_END,
        submit_command = toml_basic_string(&submit_command),
        stop_command = toml_basic_string(&stop_command),
    )
}

#[cfg(not(windows))]
fn build_codex_hook_block(running_script_path: &Path, status_script_path: &Path) -> String {
    let submit_command = agent_running_command(running_script_path, "codex");
    let stop_command = agent_status_command(status_script_path, "codex", "completed");

    format!(
        r#"{begin}

[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = {submit_command}
timeout = 1
statusMessage = "Updating Focus agent status"

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = {stop_command}
timeout = 5
statusMessage = "Updating Focus agent status"

{end}"#,
        begin = FOCUSD_AGENT_HOOK_BLOCK_BEGIN,
        end = FOCUSD_AGENT_HOOK_BLOCK_END,
        submit_command = toml_basic_string(&submit_command),
        stop_command = toml_basic_string(&stop_command),
    )
}

fn remove_managed_codex_hook_block(content: &str) -> String {
    let mut remaining = content;
    let mut next_content = String::new();

    while let Some(start) = remaining.find(FOCUSD_AGENT_HOOK_BLOCK_BEGIN) {
        next_content.push_str(&remaining[..start]);
        let after_begin = &remaining[start..];
        let Some(end) = after_begin.find(FOCUSD_AGENT_HOOK_BLOCK_END) else {
            remaining = "";
            break;
        };

        remaining = &after_begin[end + FOCUSD_AGENT_HOOK_BLOCK_END.len()..];
        if let Some(stripped) = remaining.strip_prefix("\r\n") {
            remaining = stripped;
        } else if let Some(stripped) = remaining.strip_prefix('\n') {
            remaining = stripped;
        }
    }

    next_content.push_str(remaining);
    remove_legacy_codex_focusd_hooks(&next_content)
}

fn remove_legacy_codex_focusd_hooks(content: &str) -> String {
    let lines = content.lines().collect::<Vec<_>>();
    let mut next_lines: Vec<&str> = Vec::new();
    let mut index = 0;

    while index < lines.len() {
        let trimmed = lines[index].trim();
        if let Some(hook_path) = codex_hook_event_path(trimmed) {
            let start = index;
            index += 1;

            while index < lines.len() && !lines[index].trim().starts_with('[') {
                index += 1;
            }

            let metadata_end = index;
            let mut kept_child_ranges = Vec::new();
            let mut removed_managed_child = false;

            while index < lines.len() {
                let candidate = lines[index].trim();
                if !is_codex_nested_hook_header_for(candidate, &hook_path) {
                    break;
                }

                let child_start = index;
                index += 1;
                while index < lines.len() && !lines[index].trim().starts_with('[') {
                    index += 1;
                }

                let child_block = lines[child_start..index].join("\n");
                if child_block.contains(FOCUSD_AGENT_HOOK_SIGNATURE) {
                    removed_managed_child = true;
                } else {
                    kept_child_ranges.push(child_start..index);
                }
            }

            if !removed_managed_child {
                next_lines.extend_from_slice(&lines[start..index]);
                continue;
            }

            if kept_child_ranges.is_empty() {
                continue;
            }

            next_lines.extend_from_slice(&lines[start..metadata_end]);
            for range in kept_child_ranges {
                next_lines.extend_from_slice(&lines[range]);
            }
            continue;
        }

        next_lines.push(lines[index]);
        index += 1;
    }

    next_lines.join("\n")
}

fn codex_hook_event_path(header: &str) -> Option<String> {
    if !header.starts_with("[[hooks.") || !header.ends_with("]]") {
        return None;
    }

    let hook_path = header.strip_prefix("[[")?.strip_suffix("]]")?;
    if hook_path.ends_with(".hooks") {
        return None;
    }

    Some(hook_path.to_string())
}

fn is_codex_nested_hook_header_for(header: &str, hook_path: &str) -> bool {
    header == format!("[[{hook_path}.hooks]]")
}

#[cfg(windows)]
fn agent_running_command(script_path: &Path, provider: &str) -> String {
    format!(
        "cmd.exe /d /s /c \"\"{}\" {}\"",
        script_path.to_string_lossy(),
        provider
    )
}

#[cfg(not(windows))]
fn agent_running_command(script_path: &Path, provider: &str) -> String {
    format!(
        "/bin/sh {} {}",
        shell_single_quote(&script_path.to_string_lossy()),
        shell_single_quote(provider)
    )
}

#[cfg(windows)]
fn agent_status_command(script_path: &Path, provider: &str, phase: &str) -> String {
    format!(
        "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"{}\" {} {}",
        script_path.to_string_lossy(),
        provider,
        phase
    )
}

#[cfg(not(windows))]
fn agent_status_command(script_path: &Path, provider: &str, phase: &str) -> String {
    format!(
        "/bin/sh {} {} {}",
        shell_single_quote(&script_path.to_string_lossy()),
        shell_single_quote(provider),
        shell_single_quote(phase)
    )
}

#[cfg(not(windows))]
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn toml_basic_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn write_text_file(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }

    let temporary_path = path.with_extension("tmp");
    fs::write(&temporary_path, content)
        .map_err(|error| format!("Failed to write {}: {error}", temporary_path.display()))?;
    fs::rename(&temporary_path, path)
        .or_else(|_| {
            fs::remove_file(path).ok();
            fs::rename(&temporary_path, path)
        })
        .map_err(|error| format!("Failed to replace {}: {error}", path.display()))
}

fn normalize_script_contents(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n");
    if cfg!(windows) {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    }
}

fn user_home_dir() -> Result<PathBuf, String> {
    if let Ok(home) = env::var("HOME") {
        let home = home.trim();
        if !home.is_empty() {
            return Ok(PathBuf::from(home));
        }
    }

    if let Ok(user_profile) = env::var("USERPROFILE") {
        let user_profile = user_profile.trim();
        if !user_profile.is_empty() {
            return Ok(PathBuf::from(user_profile));
        }
    }

    match (env::var("HOMEDRIVE"), env::var("HOMEPATH")) {
        (Ok(home_drive), Ok(home_path)) if !home_drive.is_empty() && !home_path.is_empty() => {
            Ok(PathBuf::from(format!("{home_drive}{home_path}")))
        }
        _ => Err("Failed to resolve the user home directory.".to_string()),
    }
}

#[cfg(windows)]
fn read_system_audio_peak_window(samples: usize, delay: Duration) -> Result<f32, String> {
    unsafe {
        let did_initialize_com = initialize_com_for_audio();
        let peak_result = (|| {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(media_error)?;
            let mut meters: Vec<IAudioMeterInformation> = Vec::new();

            for role in [eMultimedia, eConsole, eCommunications] {
                if let Ok(device) = enumerator.GetDefaultAudioEndpoint(eRender, role) {
                    if let Ok(meter) = device.Activate(CLSCTX_ALL, None) {
                        meters.push(meter);
                    }
                }
            }

            if meters.is_empty() {
                return Err("No default render audio endpoint was available.".to_string());
            }

            let mut peak = 0.0_f32;

            for sample_index in 0..samples.max(1) {
                for meter in &meters {
                    if let Ok(value) = meter.GetPeakValue() {
                        peak = peak.max(value);
                    }
                }

                if !delay.is_zero() && sample_index + 1 < samples {
                    thread::sleep(delay);
                }
            }

            Ok(peak.clamp(0.0, 1.0))
        })();

        if did_initialize_com {
            CoUninitialize();
        }

        peak_result
    }
}

#[cfg(not(windows))]
fn read_system_audio_peak_window(_samples: usize, _delay: Duration) -> Result<f32, String> {
    Ok(if macos_playback_status() == "playing" { 0.35 } else { 0.0 })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioLevel {
    active: bool,
    peak: f32,
    updated_at: i64,
}

#[cfg(windows)]
fn initialize_com_for_audio() -> bool {
    unsafe {
        let result = CoInitializeEx(None, COINIT_MULTITHREADED);

        if result == RPC_E_CHANGED_MODE {
            false
        } else {
            result.is_ok()
        }
    }
}

#[cfg(windows)]
fn send_media_key(key: VIRTUAL_KEY) {
    let key_code = key.0 as u8;

    unsafe {
        keybd_event(key_code, 0, KEYBD_EVENT_FLAGS(0), 0);
        thread::sleep(Duration::from_millis(18));
        keybd_event(key_code, 0, KEYEVENTF_KEYUP, 0);
    }
}

fn file_modified_unix_millis(path: &Path) -> Option<i64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    system_time_to_unix_millis(modified)
}

fn current_unix_millis() -> i64 {
    system_time_to_unix_millis(SystemTime::now()).unwrap_or_default()
}

fn system_time_to_unix_millis(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .ok()
}

#[cfg(windows)]
fn media_error(error: windows::core::Error) -> String {
    format!("Windows media session error: {error}")
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "Main island window was not found.".to_string())
}

fn show_island(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn hide_island(app: &AppHandle) {
    if let Ok(window) = main_window(app) {
        let _ = window.hide();
    }
}

fn window_state() -> &'static Mutex<IslandWindowState> {
    WINDOW_STATE.get_or_init(|| Mutex::new(IslandWindowState::default()))
}

fn mutate_window_state(
    update: impl FnOnce(&mut IslandWindowState) -> IslandWindowState,
) -> IslandWindowState {
    let mut state = window_state().lock().expect("window state poisoned");
    update(&mut state)
}

fn read_window_state() -> IslandWindowState {
    *window_state().lock().expect("window state poisoned")
}

fn apply_stage_geometry(window: &WebviewWindow, state: IslandWindowState) -> Result<(), String> {
    let (_, base_height) = state.mode.base_size(state.expanded_height);
    let stage_height =
        STAGE_WINDOW_HEIGHT.max((base_height * state.size_scale).ceil() + STAGE_WINDOW_PADDING_Y);

    window
        .set_size(Size::Logical(LogicalSize::new(
            STAGE_WINDOW_WIDTH,
            stage_height,
        )))
        .map_err(|error| error.to_string())?;

    let monitor = window
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .or(window
            .current_monitor()
            .map_err(|error| error.to_string())?)
        .ok_or_else(|| "No monitor is available for island positioning.".to_string())?;

    let scale = monitor.scale_factor();
    #[cfg(target_os = "macos")]
    let monitor_position = &monitor.work_area().position;
    #[cfg(not(target_os = "macos"))]
    let monitor_position = monitor.position();
    #[cfg(target_os = "macos")]
    let monitor_size = &monitor.work_area().size;
    #[cfg(not(target_os = "macos"))]
    let monitor_size = monitor.size();
    let physical_width = (STAGE_WINDOW_WIDTH * scale).round() as i32;
    let physical_top_offset = if matches!(state.mode, IslandMode::Collapsed) && state.is_tucked {
        -((COLLAPSED_ISLAND_HEIGHT * state.size_scale - TUCKED_VISIBLE_EDGE_HEIGHT).max(0.0)
            * scale)
            .round() as i32
    } else {
        (state.margin_y * scale).round() as i32
    };
    let default_x = monitor_position.x + ((monitor_size.width as i32 - physical_width) / 2);
    let default_y = monitor_position.y + physical_top_offset;
    let (x, y) = if state.is_tucked {
        (default_x, default_y)
    } else {
        state.custom_position.unwrap_or((default_x, default_y))
    };

    window
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|error| error.to_string())
}

fn start_cursor_passthrough_loop(window: WebviewWindow) {
    thread::spawn(move || {
        let mut ignoring_cursor = false;

        loop {
            let should_ignore = !cursor_is_inside_island(&window);

            if should_ignore != ignoring_cursor {
                if window.set_ignore_cursor_events(should_ignore).is_ok() {
                    ignoring_cursor = should_ignore;
                }
            }

            thread::sleep(Duration::from_millis(12));
        }
    });
}

fn cursor_is_inside_island(window: &WebviewWindow) -> bool {
    let Ok(window_position) = window.outer_position() else {
        return true;
    };
    let Ok(window_size) = window.outer_size() else {
        return true;
    };
    let Ok(cursor) = window.cursor_position() else {
        return true;
    };

    let window_width = window_size.width.max(1) as f64;
    let physical_scale = window_width / STAGE_WINDOW_WIDTH;
    let local_x = cursor.x - window_position.x as f64;
    let local_y = cursor.y - window_position.y as f64;
    let state = read_window_state();
    let (base_width, base_height) = state.mode.base_size(state.expanded_height);
    let island_width = base_width * state.size_scale * physical_scale;
    let island_height = base_height * state.size_scale * physical_scale;
    let island_left = (window_width - island_width) / 2.0;
    let island_top = 0.0;
    let radius = state.mode.corner_radius() * state.size_scale * physical_scale;

    point_in_rounded_rect(
        local_x,
        local_y,
        island_left,
        island_top,
        island_width,
        island_height,
        radius,
    )
}

fn point_in_rounded_rect(
    x: f64,
    y: f64,
    left: f64,
    top: f64,
    width: f64,
    height: f64,
    radius: f64,
) -> bool {
    let right = left + width;
    let bottom = top + height;

    if x < left || x > right || y < top || y > bottom {
        return false;
    }

    let radius = radius.min(width / 2.0).min(height / 2.0);
    let center_x = if x < left + radius {
        left + radius
    } else if x > right - radius {
        right - radius
    } else {
        x
    };
    let center_y = if y < top + radius {
        top + radius
    } else if y > bottom - radius {
        bottom - radius
    } else {
        y
    };
    let dx = x - center_x;
    let dy = y - center_y;

    (dx * dx) + (dy * dy) <= radius * radius
}

fn build_tray(app: &App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Show Island", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "Hide Island", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("Focus")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                let _ = show_island(app);
            }
            "hide" => hide_island(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_island(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = show_island(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            build_tray(app)?;
            if let Err(error) = clipboard_history::init(app.handle()) {
                eprintln!("failed to initialize clipboard history: {error}");
            }
            if let Ok(window) = main_window(app.handle()) {
                if let Err(error) = apply_stage_geometry(&window, IslandWindowState::default()) {
                    eprintln!("failed to size and position island window: {error}");
                }
                start_cursor_passthrough_loop(window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_island_layout,
            set_island_custom_position,
            reset_island_position,
            set_island_interaction,
            save_todo_markdown,
            get_default_todo_save_directory,
            show_ready_island,
            minimize_island,
            get_launch_at_startup,
            set_launch_at_startup,
            get_agent_status,
            install_agent_status_hooks,
            get_media_state,
            get_audio_level,
            media_play_pause,
            media_next,
            media_previous,
            clipboard_history::get_clipboard_history,
            clipboard_history::set_clipboard_history_settings,
            clipboard_history::copy_clipboard_history_item,
            clipboard_history::toggle_clipboard_history_favorite,
            clipboard_history::delete_clipboard_history_item,
            clipboard_history::clear_clipboard_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running Focus");
}
