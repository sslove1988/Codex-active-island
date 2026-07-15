import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import {
  Bell,
  Check,
  CalendarDays,
  CalendarPlus,
  ChevronUp,
  CircleDot,
  Clipboard,
  ClipboardList,
  Columns2,
  Copy,
  FolderOpen,
  GripVertical,
  ImageIcon,
  Keyboard,
  History,
  Hourglass,
  ListTodo,
  Minus,
  Music2,
  NotebookPen,
  Pause,
  PanelTopClose,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Settings2,
  SkipBack,
  SkipForward,
  Star,
  Trash2,
  Droplet,
  Timer,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import "./App.css";

export type IslandMode = "collapsed" | "expanded";

type IslandPage = "todo" | "reminder" | "music" | "clipboard" | "layout";
type ReminderKind = "water" | "sedentary";
type ReminderSettings = {
  waterEnabled: boolean;
  waterIntervalMinutes: number;
  sedentaryEnabled: boolean;
  sedentaryIntervalMinutes: number;
  startHour: number;
  endHour: number;
};
type ReminderSchedule = Record<ReminderKind, number>;
type ReminderAlert = { kind: ReminderKind; triggeredAt: number };
type TodoPageMode = "today" | "tomorrow" | "daily" | "archive" | "review";
type ArchiveLayout = "cards" | "timeline";
type MediaPlaybackStatus = "unavailable" | "playing" | "paused";
type AgentProvider = "codex" | "claudeCode";
type AgentTaskPhase = "idle" | "running" | "completed" | "failed";

type TodoItem = {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
};

type FocusTimerState = {
  todoId: string;
  title: string;
  durationSeconds: number;
  remainingSeconds: number;
  endAt: number | null;
  phase: "running" | "paused" | "completed";
};

type TodoArchive = {
  date: string;
  todos: TodoItem[];
  dailyNote: string;
  savedAt: number;
  savedToDisk: boolean;
  filePath?: string;
};

type SaveState = "idle" | "saving" | "saved" | "needs-path" | "error";
type SavePathState = "idle" | "saved";

type SaveTodoResult = {
  filePath: string;
};

type MediaState = {
  available: boolean;
  audioActive: boolean;
  audioPeak: number;
  playbackStatus: MediaPlaybackStatus;
  updatedAt: number;
};

type ClipboardHistorySettings = {
  enabled: boolean;
  captureImages: boolean;
  maxItems: number;
  shortcut: string;
};

type ClipboardHistoryImage = {
  width: number;
  height: number;
  byteSize: number;
  originalPath: string;
  thumbnailPath: string;
  thumbnailDataUrl?: string;
};

type ClipboardHistoryItem = {
  id: string;
  kind: "text" | "image";
  hash: string;
  createdAt: number;
  copiedAt: number;
  favorite?: boolean;
  preview: string;
  text?: string;
  image?: ClipboardHistoryImage;
};

type ClipboardHistorySnapshot = {
  settings: ClipboardHistorySettings;
  items: ClipboardHistoryItem[];
};

type AudioLevel = {
  active: boolean;
  peak: number;
  updatedAt: number;
};

type AgentTaskStatus = {
  phase: AgentTaskPhase;
  taskId?: string;
  updatedAt: number;
};

type AgentStatusSnapshot = Record<AgentProvider, AgentTaskStatus> & {
  updatedAt: number;
  statusPath: string;
};

type AgentHooksInstallResult = {
  scriptsDir: string;
  statusPath: string;
  codexConfigPath: string;
  claudeConfigPath: string;
  installedAt: number;
};

type AgentHooksInstallState = "idle" | "installing" | "installed" | "error";

type IslandSettings = {
  opacity: number;
  sizeScale: number;
  marginY: number;
  taskTextColor: string;
  pulseColor: string;
  pulseBrightness: number;
  islandBackgroundColor: string;
  todoBackgroundColor: string;
  showTitle: boolean;
  soundEnabled: boolean;
  soundVolume: number;
};

type IslandPreset = {
  id: string;
  name: string;
  settings: IslandSettings;
  createdAt: number;
  isDefault?: boolean;
};

type IslandShellProps = {
  mode: IslandMode;
  page: IslandPage;
  isTucked: boolean;
  showTitle: boolean;
  activeTaskTitle: string | null;
  nextTodoTitle: string | null;
  pendingTodoCount: number;
  focusTimer: FocusTimerState | null;
  todoCompletion: { title: string; completedAt: number } | null;
  mediaState: MediaState;
  agentStatus: AgentStatusSnapshot;
  isAgentRunning: boolean;
  reminderAlert: ReminderAlert | null;
  onOpenPage: (page: IslandPage) => void;
  onOpenReminder: () => void;
  onCollapse: () => void;
  onMinimize: () => void;
  onTuck: () => void;
  onReveal: () => void;
  onPageChange: (page: IslandPage) => void;
  children: ReactNode;
};

const STORAGE_KEY = "focusd-island-settings";
const SETTINGS_PRESETS_STORAGE_KEY = "focusd-island-setting-presets";
const ACTIVE_PRESET_STORAGE_KEY = "focusd-island-active-preset";
const STARTUP_PRESET_STORAGE_KEY = "focusd-island-startup-preset";
const STARTUP_DEFAULT_PRESET_ID = "startup-default";
const TODOS_STORAGE_KEY = "focusd-island-todos";
const TOMORROW_TODOS_STORAGE_KEY = "focusd-island-tomorrow-todos";
const ISLAND_POSITION_STORAGE_KEY = "focusd-island-window-position";
const FOCUS_TIMER_STORAGE_KEY = "focusd-island-focus-timer";
const ACTIVE_TODO_STORAGE_KEY = "focusd-island-active-todo";
const TODO_DATE_STORAGE_KEY = "focusd-island-current-date";
const TODO_ARCHIVE_STORAGE_KEY = "focusd-island-archives";
const DAILY_NOTE_STORAGE_KEY = "focusd-island-daily-note";
const TODO_SAVE_DIRECTORY_STORAGE_KEY = "focusd-island-save-directory";
const TODO_LAST_SAVED_SIGNATURE_STORAGE_KEY =
  "focusd-island-last-saved-signature";
const REMINDER_SETTINGS_STORAGE_KEY = "focusd-island-reminder-settings";
const REMINDER_SCHEDULE_STORAGE_KEY = "focusd-island-reminder-schedule";
const BASE_EXPANDED_ISLAND_HEIGHT = 306;
const TODO_ARCHIVE_EXPANDED_ISLAND_HEIGHT = 352;
const MUSIC_EXPANDED_ISLAND_HEIGHT = 286;
const CLIPBOARD_EXPANDED_ISLAND_HEIGHT = 430;
const EDITOR_EXPANDED_ISLAND_HEIGHT = 430;
const REMINDER_EXPANDED_ISLAND_HEIGHT = 390;
const TODO_ROW_HEIGHT = 46;
const TODO_TITLE_CHARACTERS_PER_LINE = 32;
const TODO_MAX_ESTIMATED_TITLE_LINES = 5;
const TODO_GROW_START_ROWS = 2;
const TODO_SCROLL_START_ROWS = 6;
const MAX_CUSTOM_SETTING_PRESETS = 6;
const DEFAULT_TASK_TEXT_COLOR = "#1afbff";
const DEFAULT_CLIPBOARD_SHORTCUT = "Ctrl+X";
const AUDIO_ACTIVE_THRESHOLD = 0.000015;
const DEFAULT_MEDIA_STATE: MediaState = {
  available: false,
  audioActive: false,
  audioPeak: 0,
  playbackStatus: "unavailable",
  updatedAt: 0,
};
const DEFAULT_AGENT_TASK_STATUS: AgentTaskStatus = {
  phase: "idle",
  updatedAt: 0,
};
const DEFAULT_AGENT_STATUS: AgentStatusSnapshot = {
  codex: DEFAULT_AGENT_TASK_STATUS,
  claudeCode: DEFAULT_AGENT_TASK_STATUS,
  updatedAt: 0,
  statusPath: "",
};
const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  waterEnabled: true,
  waterIntervalMinutes: 45,
  sedentaryEnabled: true,
  sedentaryIntervalMinutes: 60,
  startHour: 9,
  endHour: 22,
};
const DEFAULT_CLIPBOARD_HISTORY: ClipboardHistorySnapshot = {
  settings: {
    enabled: true,
    captureImages: true,
    maxItems: 30,
    shortcut: DEFAULT_CLIPBOARD_SHORTCUT,
  },
  items: [],
};
const DEFAULT_SETTINGS: IslandSettings = {
  opacity: 95,
  sizeScale: 1,
  marginY: 31,
  taskTextColor: DEFAULT_TASK_TEXT_COLOR,
  pulseColor: "#ff8f70",
  pulseBrightness: 100,
  islandBackgroundColor: "#101013",
  todoBackgroundColor: "#ffffff",
  showTitle: true,
  soundEnabled: true,
  soundVolume: 45,
};
const LEGACY_DEFAULT_PRESET_IDS = new Set(["default-white", "default-khaki"]);
const LEGACY_DEFAULT_PRESET_NAMES = new Set(["白色", "卡其"]);

type LegacyIslandSettings = Partial<IslandSettings> & {
  margin?: number;
  taskTitleColor?: string;
  pendingTodoColor?: string;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function getColorSetting(value: unknown, fallback: string) {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
    ? value
    : fallback;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = HEX_COLOR_PATTERN.test(hex)
    ? hex.slice(1)
    : DEFAULT_SETTINGS.pulseColor.slice(1);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

type ShortcutKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

const MODIFIER_KEY_NAMES = new Set([
  "Alt",
  "AltGraph",
  "Control",
  "Meta",
  "Shift",
]);

function normalizeShortcutKeyLabel(key: string) {
  if (key.length === 1) {
    return key.toUpperCase();
  }

  switch (key) {
    case " ":
    case "Spacebar":
      return "Space";
    case "Escape":
      return "Esc";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    default:
      return key;
  }
}

function buildShortcutFromEvent(event: ShortcutKeyboardEvent) {
  if (MODIFIER_KEY_NAMES.has(event.key)) {
    return null;
  }

  const parts: string[] = [];

  if (event.ctrlKey) {
    parts.push("Ctrl");
  }

  if (event.altKey) {
    parts.push("Alt");
  }

  if (event.shiftKey) {
    parts.push("Shift");
  }

  if (event.metaKey) {
    parts.push("Win");
  }

  if (parts.length === 0) {
    return null;
  }

  parts.push(normalizeShortcutKeyLabel(event.key));
  return parts.join("+");
}

function normalizeClipboardShortcut(shortcut: string | undefined) {
  const text = shortcut?.trim();

  if (!text) {
    return DEFAULT_CLIPBOARD_SHORTCUT;
  }

  const parts = text
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const modifiers = new Set<string>();
  let keyLabel = "";

  for (const part of parts) {
    const normalized = part.toLowerCase();

    if (normalized === "ctrl" || normalized === "control") {
      modifiers.add("Ctrl");
    } else if (normalized === "alt" || normalized === "option") {
      modifiers.add("Alt");
    } else if (normalized === "shift") {
      modifiers.add("Shift");
    } else if (
      normalized === "win" ||
      normalized === "windows" ||
      normalized === "meta" ||
      normalized === "cmd" ||
      normalized === "super"
    ) {
      modifiers.add("Win");
    } else if (!keyLabel) {
      keyLabel = normalizeShortcutKeyLabel(part);
    }
  }

  if (!keyLabel || modifiers.size === 0) {
    return DEFAULT_CLIPBOARD_SHORTCUT;
  }

  return ["Ctrl", "Alt", "Shift", "Win"]
    .filter((modifier) => modifiers.has(modifier))
    .concat(keyLabel)
    .join("+");
}

function normalizeClipboardSettings(
  settings: ClipboardHistorySettings,
): ClipboardHistorySettings {
  return {
    ...settings,
    maxItems: clamp(Math.round(settings.maxItems), 5, 200),
    shortcut: normalizeClipboardShortcut(settings.shortcut),
  };
}

function matchesClipboardShortcut(
  event: KeyboardEvent,
  shortcut: string | undefined,
) {
  if (isEditableTarget(event.target)) {
    return false;
  }

  return (
    buildShortcutFromEvent(event) === normalizeClipboardShortcut(shortcut)
  );
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function normalizeSettings(
  settings: LegacyIslandSettings | null | undefined,
): IslandSettings {
  const taskTextColor = getColorSetting(
    settings?.taskTextColor ?? settings?.pendingTodoColor,
    getColorSetting(settings?.taskTitleColor, DEFAULT_SETTINGS.taskTextColor),
  );

  return {
    opacity: clamp(Number(settings?.opacity ?? DEFAULT_SETTINGS.opacity), 50, 100),
    sizeScale: clamp(
      Number(settings?.sizeScale ?? DEFAULT_SETTINGS.sizeScale),
      0.75,
      1.4,
    ),
    marginY: clamp(
      Number(settings?.marginY ?? settings?.margin ?? DEFAULT_SETTINGS.marginY),
      0,
      160,
    ),
    taskTextColor,
    pulseColor: getColorSetting(
      settings?.pulseColor,
      DEFAULT_SETTINGS.pulseColor,
    ),
    pulseBrightness: clamp(
      Number(settings?.pulseBrightness ?? DEFAULT_SETTINGS.pulseBrightness),
      50,
      160,
    ),
    islandBackgroundColor: getColorSetting(
      settings?.islandBackgroundColor,
      DEFAULT_SETTINGS.islandBackgroundColor,
    ),
    todoBackgroundColor: getColorSetting(
      settings?.todoBackgroundColor,
      DEFAULT_SETTINGS.todoBackgroundColor,
    ),
    showTitle:
      typeof settings?.showTitle === "boolean"
        ? settings.showTitle
        : DEFAULT_SETTINGS.showTitle,
    soundEnabled:
      typeof settings?.soundEnabled === "boolean"
        ? settings.soundEnabled
        : DEFAULT_SETTINGS.soundEnabled,
    soundVolume: clamp(
      Number(settings?.soundVolume ?? DEFAULT_SETTINGS.soundVolume),
      0,
      100,
    ),
  };
}

function getDefaultSettingPresets(): IslandPreset[] {
  return [{
    id: STARTUP_DEFAULT_PRESET_ID,
    name: "开机默认外观",
    settings: normalizeSettings(DEFAULT_SETTINGS),
    createdAt: 0,
    isDefault: true,
  }];
}

function mergeWithDefaultSettingPresets(presets: IslandPreset[]) {
  const defaultPresets = getDefaultSettingPresets();
  const customPresets = presets
    .filter(
      (preset) =>
        !preset.isDefault &&
        preset.id !== STARTUP_DEFAULT_PRESET_ID &&
        !LEGACY_DEFAULT_PRESET_IDS.has(preset.id) &&
        !LEGACY_DEFAULT_PRESET_NAMES.has(preset.name.trim()),
    )
    .map((preset) => ({ ...preset, isDefault: false }))
    .slice(0, MAX_CUSTOM_SETTING_PRESETS);

  return [...defaultPresets, ...customPresets];
}

function isDefaultSettingPreset(presetId: string) {
  return presetId === STARTUP_DEFAULT_PRESET_ID || LEGACY_DEFAULT_PRESET_IDS.has(presetId);
}

function getTodoTitleLineCount(title: string) {
  const visualLength = Array.from(title).reduce(
    (total, character) => total + (character.charCodeAt(0) > 255 ? 1.6 : 1),
    0,
  );

  return clamp(
    Math.ceil(visualLength / TODO_TITLE_CHARACTERS_PER_LINE),
    1,
    TODO_MAX_ESTIMATED_TITLE_LINES,
  );
}

function getTodoVisualRows(todoList: TodoItem[]) {
  return todoList.reduce(
    (total, todo) => total + getTodoTitleLineCount(todo.title),
    0,
  );
}

function loadSettings(): IslandSettings {
  const stored = window.localStorage.getItem(STORAGE_KEY);

  if (!stored) {
    return DEFAULT_SETTINGS;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<IslandSettings> & {
      margin?: number;
    };

    return normalizeSettings(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadReminderSettings(): ReminderSettings {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(REMINDER_SETTINGS_STORAGE_KEY) ?? "{}",
    ) as Partial<ReminderSettings>;
    return {
      waterEnabled: parsed.waterEnabled ?? DEFAULT_REMINDER_SETTINGS.waterEnabled,
      waterIntervalMinutes: clamp(Number(parsed.waterIntervalMinutes) || 45, 15, 240),
      sedentaryEnabled:
        parsed.sedentaryEnabled ?? DEFAULT_REMINDER_SETTINGS.sedentaryEnabled,
      sedentaryIntervalMinutes: clamp(
        Number(parsed.sedentaryIntervalMinutes) || 60,
        15,
        240,
      ),
      startHour: clamp(Number(parsed.startHour) || 9, 0, 23),
      endHour: clamp(Number(parsed.endHour) || 22, 0, 23),
    };
  } catch {
    return DEFAULT_REMINDER_SETTINGS;
  }
}

function loadReminderSchedule(): ReminderSchedule {
  const now = Date.now();
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(REMINDER_SCHEDULE_STORAGE_KEY) ?? "{}",
    ) as Partial<ReminderSchedule>;
    return {
      water:
        typeof parsed.water === "number"
          ? parsed.water
          : now + DEFAULT_REMINDER_SETTINGS.waterIntervalMinutes * 60_000,
      sedentary:
        typeof parsed.sedentary === "number"
          ? parsed.sedentary
          : now + DEFAULT_REMINDER_SETTINGS.sedentaryIntervalMinutes * 60_000,
    };
  } catch {
    return {
      water: now + DEFAULT_REMINDER_SETTINGS.waterIntervalMinutes * 60_000,
      sedentary: now + DEFAULT_REMINDER_SETTINGS.sedentaryIntervalMinutes * 60_000,
    };
  }
}

function isReminderActiveNow(settings: ReminderSettings) {
  const hour = new Date().getHours();
  return settings.startHour <= settings.endHour
    ? hour >= settings.startHour && hour < settings.endHour
    : hour >= settings.startHour || hour < settings.endHour;
}

function formatReminderTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function playFeedbackSound(
  kind: "completed" | "failed" | "reminder",
  volumePercent: number,
) {
  const AudioContextClass =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) return;

  const context = new AudioContextClass();
  const notes =
    kind === "completed"
      ? [523.25, 659.25, 783.99]
      : kind === "failed"
        ? [220, 164.81]
        : [659.25, 783.99];
  const gainLevel = Math.max(0.015, Math.min(volumePercent / 100, 1) * 0.16);

  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + index * 0.11;
    oscillator.type = kind === "failed" ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainLevel, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.19);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.21);
  });

  window.setTimeout(() => void context.close(), notes.length * 120 + 280);
}

function loadSettingPresets(): IslandPreset[] {
  const stored = window.localStorage.getItem(SETTINGS_PRESETS_STORAGE_KEY);

  if (!stored) {
    return getDefaultSettingPresets();
  }

  try {
    const parsed = JSON.parse(stored) as Partial<IslandPreset>[];

    if (!Array.isArray(parsed)) {
      return getDefaultSettingPresets();
    }

    const presets = parsed
      .map((preset, index) => ({
        id:
          typeof preset.id === "string" && preset.id
            ? preset.id
            : createTodoId(),
        name:
          typeof preset.name === "string" && preset.name.trim()
            ? preset.name.trim()
            : `外观方案 ${index + 1}`,
        settings: normalizeSettings(preset.settings),
        createdAt:
          typeof preset.createdAt === "number" ? preset.createdAt : Date.now(),
        isDefault: false,
      }));

    return mergeWithDefaultSettingPresets(presets);
  } catch {
    return getDefaultSettingPresets();
  }
}

function normalizeTodo(todo: Partial<TodoItem>): TodoItem {
  return {
    id: typeof todo.id === "string" && todo.id ? todo.id : createTodoId(),
    title: todo.title?.trim() ?? "",
    completed: Boolean(todo.completed),
    createdAt: typeof todo.createdAt === "number" ? todo.createdAt : Date.now(),
  };
}

function loadTodoList(storageKey: string): TodoItem[] {
  const stored = window.localStorage.getItem(storageKey);

  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored) as Partial<TodoItem>[];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((todo) => typeof todo.title === "string" && todo.title.trim())
      .map(normalizeTodo);
  } catch {
    return [];
  }
}

function loadTodos(): TodoItem[] {
  return loadTodoList(TODOS_STORAGE_KEY);
}

function loadTomorrowTodos(): TodoItem[] {
  return loadTodoList(TOMORROW_TODOS_STORAGE_KEY);
}

function loadFocusTimer(): FocusTimerState | null {
  const stored = window.localStorage.getItem(FOCUS_TIMER_STORAGE_KEY);
  if (!stored) return null;
  try {
    const timer = JSON.parse(stored) as FocusTimerState;
    if (!timer.todoId || !timer.title || !["running", "paused", "completed"].includes(timer.phase)) return null;
    const remainingSeconds = timer.phase === "running" && timer.endAt
      ? Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000))
      : Math.max(0, Number(timer.remainingSeconds) || 0);
    return { ...timer, remainingSeconds, phase: remainingSeconds === 0 ? "completed" : timer.phase };
  } catch {
    return null;
  }
}

function formatFocusTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function loadActiveTodoId() {
  return window.localStorage.getItem(ACTIVE_TODO_STORAGE_KEY);
}

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getDisplayDateParts(date: string) {
  const [fallbackYear = date, fallbackMonth = "", fallbackDay = ""] =
    date.split("-");
  const parsedDate = new Date(`${date}T00:00:00`);
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const hasValidDate = !Number.isNaN(parsedDate.getTime());

  return {
    year: hasValidDate ? String(parsedDate.getFullYear()) : fallbackYear,
    month: hasValidDate
      ? String(parsedDate.getMonth() + 1).padStart(2, "0")
      : fallbackMonth,
    day: hasValidDate
      ? String(parsedDate.getDate()).padStart(2, "0")
      : fallbackDay,
    weekday: hasValidDate ? weekdays[parsedDate.getDay()] : "",
  };
}

function loadCurrentTodoDate() {
  return window.localStorage.getItem(TODO_DATE_STORAGE_KEY) ?? getLocalDateString();
}

function loadTodoArchives(): TodoArchive[] {
  const stored = window.localStorage.getItem(TODO_ARCHIVE_STORAGE_KEY);

  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored) as Partial<TodoArchive>[];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((archive) => typeof archive.date === "string" && archive.date)
      .map((archive) => ({
        date: archive.date ?? getLocalDateString(),
        todos: Array.isArray(archive.todos)
          ? archive.todos
              .filter(
                (todo) => typeof todo.title === "string" && todo.title.trim(),
              )
              .map(normalizeTodo)
          : [],
        dailyNote:
          typeof archive.dailyNote === "string" ? archive.dailyNote : "",
        savedAt: typeof archive.savedAt === "number" ? archive.savedAt : 0,
        savedToDisk: Boolean(archive.savedToDisk),
        filePath:
          typeof archive.filePath === "string" ? archive.filePath : undefined,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

function loadSaveDirectory() {
  return window.localStorage.getItem(TODO_SAVE_DIRECTORY_STORAGE_KEY) ?? "";
}

function loadDailyNote() {
  return window.localStorage.getItem(DAILY_NOTE_STORAGE_KEY) ?? "";
}

function getTodoSignature(date: string, todos: TodoItem[], dailyNote: string) {
  return JSON.stringify({
    date,
    todos: todos.map((todo) => ({
      title: todo.title,
      completed: todo.completed,
    })),
    dailyNote,
  });
}

function formatTodosAsMarkdown(todos: TodoItem[]) {
  return todos
    .map((todo) => `- [${todo.completed ? "x" : " "}] ${todo.title}`)
    .join("\n");
}

function formatTodoDocumentAsMarkdown(todos: TodoItem[], dailyNote: string) {
  const todoMarkdown = formatTodosAsMarkdown(todos);
  const dailyMarkdown = dailyNote.trimEnd();

  if (todoMarkdown && dailyMarkdown) {
    return `${todoMarkdown}\n\n${dailyMarkdown}`;
  }

  return todoMarkdown || dailyMarkdown;
}

function createTodoId() {
  if ("crypto" in window && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type RobotVisualState = "idle" | "working" | "completed" | "failed";

function PixelRobot({ state }: { state: RobotVisualState }) {
  return (
    <span className={`pixel-robot pixel-robot--${state}`} aria-hidden="true">
      <span className="pixel-robot__antenna"><i /></span>
      <span className="pixel-robot__body">
        <i className="pixel-robot__eye pixel-robot__eye--left" />
        <i className="pixel-robot__eye pixel-robot__eye--right" />
      </span>
      <span className="pixel-robot__blanket" />
      <span className="pixel-robot__sleep">Z</span>
      <span className="pixel-robot__laptop"><i>&lt;/&gt;</i></span>
      <span className="pixel-robot__status-badge">
        {state === "completed" ? <Check size={15} strokeWidth={3} /> : "!"}
      </span>
      <span className="pixel-robot__sparks"><i /><i /><i /></span>
    </span>
  );
}

function IslandShell({
  mode,
  page,
  isTucked,
  showTitle,
  activeTaskTitle,
  nextTodoTitle,
  pendingTodoCount,
  focusTimer,
  todoCompletion,
  mediaState,
  agentStatus,
  isAgentRunning,
  reminderAlert,
  onOpenPage,
  onOpenReminder,
  onCollapse,
  onMinimize,
  onTuck,
  onReveal,
  onPageChange,
  children,
}: IslandShellProps) {
  const didDragIsland = useRef(false);
  const [isRobotHovered, setIsRobotHovered] = useState(false);
  const isExpanded = mode === "expanded";
  const isMusicPlaying =
    mediaState.playbackStatus === "playing" ||
    (mediaState.playbackStatus !== "paused" && mediaState.audioActive);
  const className = [
    "island",
    `island--${mode}`,
    `island--${page}`,
    showTitle ? "" : "island--title-hidden",
  ]
    .filter(Boolean)
    .join(" ");
  const agentStatusIconClassName = [
    "island__agent-status-icon",
    isAgentRunning
      ? "island__agent-status-icon--running"
      : "island__agent-status-icon--idle",
  ].join(" ");
  const codexStatusAge = Date.now() - agentStatus.codex.updatedAt;
  const codexActivity =
    agentStatus.codex.phase === "running"
      ? { label: "Codex 正在运行…", phase: "running" }
      : agentStatus.codex.phase === "completed" && codexStatusAge < 4_000
        ? { label: "Codex 任务已完成", phase: "completed" }
        : agentStatus.codex.phase === "failed" && codexStatusAge < 8_000
          ? { label: "Codex 任务失败", phase: "failed" }
          : null;
  const pulseClassName = [
    "island__pulse",
    reminderAlert
      ? "island__pulse--reminder"
      : `island__pulse--agent-${codexActivity?.phase ?? "idle"}`,
  ].join(" ");
  const reminderLabel = reminderAlert
    ? reminderAlert.kind === "water"
      ? "喝水提醒：该喝水啦"
      : "久坐提醒：起来活动一下"
    : null;
  const robotState: RobotVisualState =
    codexActivity?.phase === "running"
      ? "working"
      : codexActivity?.phase === "completed"
        ? "completed"
        : codexActivity?.phase === "failed"
          ? "failed"
          : todoCompletion
            ? "completed"
            : focusTimer?.phase === "running"
            ? "working"
            : focusTimer?.phase === "completed"
              ? "completed"
              : "idle";
  const robotStatusLabel =
    robotState === "working"
      ? "Codex 工作中"
      : robotState === "completed"
        ? "Codex 已完成"
        : robotState === "failed"
          ? "Codex 执行失败"
          : "Codex 空闲中";
  const collapsedLabel =
    reminderLabel ??
    (codexActivity
      ? codexActivity.label
      : todoCompletion
        ? `已完成 · ${todoCompletion.title}`
      : focusTimer
        ? focusTimer.phase === "completed"
          ? `专注完成 · ${focusTimer.title}`
          : `${focusTimer.title} · ${focusTimer.phase === "paused" ? "已暂停 " : ""}${formatFocusTime(focusTimer.remainingSeconds)}`
      : activeTaskTitle
        ? activeTaskTitle
        : nextTodoTitle
          ? pendingTodoCount > 1
            ? `${nextTodoTitle} · 还剩${pendingTodoCount - 1}个待办`
            : nextTodoTitle
          : "今日暂无待办");

  const prepareIslandDrag = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a, [role='button']")) return;
    const startX = event.screenX;
    const startY = event.screenY;
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", cleanup);
    };
    const handleMove = (moveEvent: MouseEvent) => {
      if (Math.hypot(moveEvent.screenX - startX, moveEvent.screenY - startY) < 6) return;
      didDragIsland.current = true;
      cleanup();
      void getCurrentWindow().startDragging();
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", cleanup, { once: true });
  }, []);

  return (
    <section
      className={className}
      aria-label={collapsedLabel}
      onMouseDown={prepareIslandDrag}
      onClick={() => {
        if (didDragIsland.current) {
          didDragIsland.current = false;
          return;
        }
        if (!isExpanded) {
          reminderAlert ? onOpenReminder() : onOpenPage(page);
        }
      }}
      onMouseEnter={() => {
        if (isTucked) {
          onReveal();
        }
      }}
    >
      <div className="island__collapsed" aria-hidden={isExpanded}>
        <span
          className={pulseClassName}
          aria-label={reminderLabel ?? robotStatusLabel}
          onMouseEnter={() => setIsRobotHovered(true)}
          onMouseLeave={() => setIsRobotHovered(false)}
        >
          {reminderAlert ? <Bell size={22} strokeWidth={2.2} /> : <PixelRobot state={robotState} />}
        </span>
        {reminderLabel ? (
          <span className="island__activity-status island__activity-status--reminder">
            {reminderLabel}
          </span>
        ) : isRobotHovered ? (
          <span className={`island__activity-status island__activity-status--${robotState}`}>
            {robotStatusLabel}
          </span>
        ) : codexActivity ? (
          <span
            className={`island__activity-status island__activity-status--${codexActivity.phase}`}
          >
            {codexActivity.label}
          </span>
        ) : todoCompletion ? (
          <span className="island__activity-status island__activity-status--completed">
            已完成 · {todoCompletion.title}
          </span>
        ) : focusTimer ? (
          <span className={`island__activity-status island__activity-status--${focusTimer.phase === "completed" ? "completed" : "running"}`}>
            {focusTimer.phase === "completed"
              ? `专注完成 · ${focusTimer.title}`
              : `${focusTimer.title} · ${focusTimer.phase === "paused" ? "已暂停 " : ""}${formatFocusTime(focusTimer.remainingSeconds)}`}
          </span>
        ) : activeTaskTitle ? (
          <span className="island__active-task">
            正在进行：{activeTaskTitle}
          </span>
        ) : nextTodoTitle ? (
          <span className="island__todo-count">
            {nextTodoTitle}
            {pendingTodoCount > 1 ? ` · 还剩${pendingTodoCount - 1}个待办` : ""}
          </span>
        ) : (
          <span className="island__todo-count island__todo-count--empty">
            今日暂无待办
          </span>
        )}
        <MusicWaveButton
          isAvailable={mediaState.available || mediaState.audioActive}
          isPlaying={isMusicPlaying}
          audioPeak={mediaState.audioPeak}
          label="打开音乐控制"
          onClick={() => onOpenPage("music")}
        />
        <button
          className="island__quiet-button"
          type="button"
          title="收起"
          aria-label="收起岛屿"
          onClick={(event) => {
            event.stopPropagation();
            onTuck();
          }}
        >
          <PanelTopClose size={14} strokeWidth={2.2} />
        </button>
      </div>

      <div className="island__expanded" aria-hidden={!isExpanded}>
        <header className="island__header">
          <div className="island__title">
            <CircleDot
              className={agentStatusIconClassName}
              size={16}
              strokeWidth={2.2}
            />
            <span>Focus</span>
          </div>

          <nav className="editor-dots" aria-label="主要功能">
            <button
              className={`page-nav-button page-nav-button--todo ${
                page === "todo" ? "page-nav-button--active" : ""
              }`}
              type="button"
              title="任务清单"
              aria-label="任务清单"
              onClick={(event) => {
                event.stopPropagation();
                onPageChange("todo");
              }}
            >
              <ListTodo size={14} strokeWidth={2.2} />
              <span>任务</span>
            </button>
            <button
              className={`page-nav-button page-nav-button--reminder ${
                page === "reminder" ? "page-nav-button--active" : ""
              }`}
              type="button"
              title="喝水与久坐提醒"
              aria-label="定时提醒"
              onClick={(event) => {
                event.stopPropagation();
                onPageChange("reminder");
              }}
            >
              <Bell size={14} strokeWidth={2.2} />
              <span>提醒</span>
            </button>
            <button
              className={`page-nav-button page-nav-button--music ${
                page === "music" ? "page-nav-button--active" : ""
              }`}
              type="button"
              title="音乐控制"
              aria-label="音乐控制"
              onClick={(event) => {
                event.stopPropagation();
                onPageChange("music");
              }}
            >
              <Music2 size={14} strokeWidth={2.2} />
              <span>音乐</span>
            </button>
            <button
              className={`page-nav-button page-nav-button--clipboard ${
                page === "clipboard" ? "page-nav-button--active" : ""
              }`}
              type="button"
              title="剪贴板历史"
              aria-label="剪贴板历史"
              onClick={(event) => {
                event.stopPropagation();
                onPageChange("clipboard");
              }}
            >
              <Clipboard size={14} strokeWidth={2.2} />
              <span>剪贴板</span>
            </button>
            <button
              className={`page-nav-button page-nav-button--layout ${
                page === "layout" ? "page-nav-button--active" : ""
              }`}
              type="button"
              title="设置"
              aria-label="设置"
              onClick={(event) => {
                event.stopPropagation();
                onPageChange("layout");
              }}
            >
              <Settings2 size={14} strokeWidth={2.2} />
              <span>设置</span>
            </button>
          </nav>

          <div
            className="island__collapse-target"
            onClick={onCollapse}
          />

          <div className="window-actions">
            <button
              className="icon-button"
              type="button"
              title="收起"
              aria-label="收起岛屿"
              onClick={(event) => {
                event.stopPropagation();
                onCollapse();
              }}
            >
              <ChevronUp size={18} strokeWidth={2.2} />
            </button>
            <button
              className="icon-button"
              type="button"
              title="最小化到托盘"
              aria-label="最小化到托盘"
              onClick={(event) => {
                event.stopPropagation();
                onMinimize();
              }}
            >
              <Minus size={18} strokeWidth={2.2} />
            </button>
          </div>
        </header>
        <div className="island__content">{children}</div>
      </div>
    </section>
  );
}

function MusicWaveButton({
  isAvailable,
  isPlaying,
  audioPeak,
  label,
  onClick,
}: {
  isAvailable: boolean;
  isPlaying: boolean;
  audioPeak: number;
  label: string;
  onClick: () => void;
}) {
  const [phase, setPhase] = useState(0);
  const className = [
    "music-wave-button",
    isAvailable ? "music-wave-button--available" : "music-wave-button--idle",
    isPlaying ? "music-wave-button--playing" : "music-wave-button--paused",
  ]
    .filter(Boolean)
    .join(" ");
  const shouldAnimate = isAvailable || isPlaying;
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!shouldAnimate) {
      setPhase(0);
      return;
    }

    const interval = window.setInterval(
      () => {
        setPhase(performance.now() / (isPlaying ? 260 : 900));
      },
      prefersReducedMotion ? 420 : isPlaying ? 72 : 180,
    );

    return () => window.clearInterval(interval);
  }, [isPlaying, prefersReducedMotion, shouldAnimate]);

  const liftedPeak = isPlaying
    ? clamp(Math.log1p(clamp(audioPeak, 0, 1) * 150) / Math.log1p(150), 0, 1)
    : 0;
  const barScales = [0.34, 0.72, 0.48, 0.86, 0.42].map((bar, index) => {
    const floor = isAvailable ? 0.22 : 0.12;
    const breath =
      shouldAnimate && !prefersReducedMotion
        ? 0.07 + Math.sin(phase + index * 0.82) * 0.045
        : 0;
    const movement =
      liftedPeak *
      (0.26 + bar * 1.02) *
      (0.82 + Math.sin(phase * (1.15 + index * 0.08) + index * 1.7) * 0.24);

    return clamp(floor + breath + movement, 0.12, 1.22);
  });

  return (
    <button
      className={className}
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {barScales.map((scale, index) => (
        <span
          key={index}
          style={
            {
              "--wave-scale": scale.toFixed(3),
              "--wave-opacity": (0.42 + scale * 0.52).toFixed(3),
            } as CSSProperties
          }
        />
      ))}
    </button>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider-control">
      <span className="slider-control__meta">
        <span>{label}</span>
        <strong>
          {step < 1 ? value.toFixed(2) : Math.round(value)}
          {suffix}
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="color-control">
      <span className="color-control__meta">
        <span>{label}</span>
        <strong>{value.toUpperCase()}</strong>
      </span>
      <input
        type="color"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function ToggleControl({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-control">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="toggle-control__switch" aria-hidden="true" />
    </label>
  );
}

function NumberControl({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="number-control">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const nextValue = Number(event.currentTarget.value);

          if (Number.isFinite(nextValue)) {
            onChange(clamp(Math.round(nextValue), min, max));
          }
        }}
      />
    </label>
  );
}

function LayoutEditor({
  settings,
  clipboardSettings,
  saveDirectoryDraft,
  savePathState,
  highlightSavePath,
  focusClipboardShortcutToken,
  presets,
  activePresetId,
  startupPresetId,
  launchAtStartup,
  agentHooksInstallState,
  agentHooksInstallResult,
  agentHooksInstallError,
  onSettingsChange,
  onClipboardSettingsChange,
  onReset,
  onResetPosition,
  onSaveDirectoryDraftChange,
  onSaveDirectory,
  onChooseSaveDirectory,
  onSavePreset,
  onApplyPreset,
  onSetStartupPreset,
  onRenamePreset,
  onDeletePreset,
  onLaunchAtStartupChange,
  onInstallAgentHooks,
  onClipboardShortcutFocusHandled,
}: {
  settings: IslandSettings;
  clipboardSettings: ClipboardHistorySettings;
  saveDirectoryDraft: string;
  savePathState: SavePathState;
  highlightSavePath: boolean;
  focusClipboardShortcutToken: number;
  presets: IslandPreset[];
  activePresetId: string;
  startupPresetId: string;
  launchAtStartup: boolean;
  agentHooksInstallState: AgentHooksInstallState;
  agentHooksInstallResult: AgentHooksInstallResult | null;
  agentHooksInstallError: string;
  onSettingsChange: (settings: IslandSettings) => void;
  onClipboardSettingsChange: (settings: ClipboardHistorySettings) => void;
  onReset: () => void;
  onResetPosition: () => void;
  onSaveDirectoryDraftChange: (value: string) => void;
  onSaveDirectory: () => void;
  onChooseSaveDirectory: () => void;
  onSavePreset: () => void;
  onApplyPreset: (presetId: string) => void;
  onSetStartupPreset: (presetId: string) => void;
  onRenamePreset: (presetId: string, name: string) => void;
  onDeletePreset: (presetId: string) => void;
  onLaunchAtStartupChange: (enabled: boolean) => void;
  onInstallAgentHooks: () => void;
  onClipboardShortcutFocusHandled: () => void;
}) {
  const savePathPanelRef = useRef<HTMLElement | null>(null);
  const savePathInputRef = useRef<HTMLInputElement | null>(null);
  const clipboardShortcutPanelRef = useRef<HTMLElement | null>(null);
  const clipboardShortcutButtonRef = useRef<HTMLButtonElement | null>(null);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);

  const startPresetRename = useCallback((preset: IslandPreset) => {
    setEditingPresetId(preset.id);
    setPresetNameDraft(preset.name);
  }, []);

  const commitPresetRename = useCallback(() => {
    if (!editingPresetId) {
      return;
    }

    onRenamePreset(editingPresetId, presetNameDraft);
    setEditingPresetId(null);
    setPresetNameDraft("");
  }, [editingPresetId, onRenamePreset, presetNameDraft]);

  useEffect(() => {
    if (!highlightSavePath) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const editorPanel = savePathPanelRef.current?.closest(".editor-panel");

      if (editorPanel instanceof HTMLElement) {
        editorPanel.scrollTo({
          top: editorPanel.scrollHeight,
          behavior: "smooth",
        });
      }

      savePathInputRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [highlightSavePath]);

  useEffect(() => {
    if (focusClipboardShortcutToken <= 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const editorPanel = clipboardShortcutPanelRef.current?.closest(".editor-panel");

      if (editorPanel instanceof HTMLElement && clipboardShortcutPanelRef.current) {
        const targetTop = clipboardShortcutPanelRef.current.offsetTop - 12;
        editorPanel.scrollTo({ top: targetTop, behavior: "smooth" });
      }

      clipboardShortcutButtonRef.current?.focus({ preventScroll: true });
      setIsRecordingShortcut(true);
      onClipboardShortcutFocusHandled();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusClipboardShortcutToken, onClipboardShortcutFocusHandled]);

  const handleShortcutKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (!isRecordingShortcut) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setIsRecordingShortcut(false);
        return;
      }

      const shortcut = buildShortcutFromEvent(event.nativeEvent);

      if (!shortcut) {
        return;
      }

      onClipboardSettingsChange({
        ...clipboardSettings,
        shortcut,
      });
      setIsRecordingShortcut(false);
    },
    [clipboardSettings, isRecordingShortcut, onClipboardSettingsChange],
  );

  return (
    <div className="editor-panel">
      <div className="editor-panel__header">
        <span>设置</span>
        <button
          className="reset-button"
          type="button"
          title="恢复默认"
          aria-label="恢复默认"
          onClick={onReset}
        >
          <RefreshCcw size={15} strokeWidth={2.2} />
        </button>
      </div>

      <section className="settings-section settings-section--layout">
        <div className="settings-section__header">
          <span>布局设置</span>
          <button className="preset-save-button" type="button" onClick={onResetPosition}>
            <RefreshCcw size={13} strokeWidth={2.2} />
            <span>恢复默认位置</span>
          </button>
        </div>
        <SliderControl
          label="不透明度"
          value={settings.opacity}
          min={50}
          max={100}
          step={1}
          suffix="%"
          onChange={(opacity) => onSettingsChange({ ...settings, opacity })}
        />
        <SliderControl
          label="整体大小"
          value={settings.sizeScale}
          min={0.75}
          max={1.4}
          step={0.01}
          suffix="x"
          onChange={(sizeScale) => onSettingsChange({ ...settings, sizeScale })}
        />
        <SliderControl
          label="上下边距"
          value={settings.marginY}
          min={0}
          max={160}
          step={1}
          suffix="px"
          onChange={(marginY) => onSettingsChange({ ...settings, marginY })}
        />
        <ToggleControl
          label="开机自启动"
          checked={launchAtStartup}
          onChange={onLaunchAtStartupChange}
        />
        <ToggleControl
          label="展示应用名称"
          checked={settings.showTitle}
          onChange={(showTitle) => onSettingsChange({ ...settings, showTitle })}
        />
        <ToggleControl
          label="状态与提醒提示音"
          checked={settings.soundEnabled}
          onChange={(soundEnabled) =>
            onSettingsChange({ ...settings, soundEnabled })
          }
        />
        <SliderControl
          label="提示音音量"
          value={settings.soundVolume}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={(soundVolume) =>
            onSettingsChange({ ...settings, soundVolume })
          }
        />
      </section>

      <section className="settings-section settings-section--agent-hooks">
        <div className="settings-section__header">
          <span>AI Agent 状态灯</span>
          <button
            className={[
              "agent-hooks-button",
              agentHooksInstallState === "installed"
                ? "agent-hooks-button--installed"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            type="button"
            disabled={agentHooksInstallState === "installing"}
            onClick={onInstallAgentHooks}
          >
            {agentHooksInstallState === "installed" ? (
              <Check size={13} strokeWidth={2.6} />
            ) : (
              <RefreshCcw size={13} strokeWidth={2.4} />
            )}
            <span>
              {agentHooksInstallState === "installing"
                ? "安装中"
                : agentHooksInstallState === "installed"
                  ? "已安装"
                  : "安装/修复"}
            </span>
          </button>
        </div>
        {agentHooksInstallState === "installed" && agentHooksInstallResult ? (
          <div className="agent-hooks-status agent-hooks-status--ok">
            <span>脚本目录</span>
            <strong title={agentHooksInstallResult.scriptsDir}>
              {agentHooksInstallResult.scriptsDir}
            </strong>
          </div>
        ) : null}
        {agentHooksInstallState === "error" ? (
          <div className="agent-hooks-status agent-hooks-status--error">
            {agentHooksInstallError}
          </div>
        ) : null}
      </section>

      <section
        className={[
          "settings-section",
          "settings-section--clipboard",
          focusClipboardShortcutToken > 0 ? "settings-section--attention" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        ref={clipboardShortcutPanelRef}
      >
        <div className="settings-section__header">
          <span>剪贴板历史</span>
        </div>
        <ToggleControl
          label="记录剪贴板"
          checked={clipboardSettings.enabled}
          onChange={(enabled) =>
            onClipboardSettingsChange({ ...clipboardSettings, enabled })
          }
        />
        <ToggleControl
          label="记录图片"
          checked={clipboardSettings.captureImages}
          onChange={(captureImages) =>
            onClipboardSettingsChange({ ...clipboardSettings, captureImages })
          }
        />
        <NumberControl
          label="最大历史条数"
          value={clipboardSettings.maxItems}
          min={5}
          max={200}
          onChange={(maxItems) =>
            onClipboardSettingsChange({ ...clipboardSettings, maxItems })
          }
        />
        <div className="shortcut-control">
          <div className="shortcut-control__meta">
            <span>展开快捷键</span>
            <strong>{normalizeClipboardShortcut(clipboardSettings.shortcut)}</strong>
          </div>
          <button
            ref={clipboardShortcutButtonRef}
            className={[
              "shortcut-record-button",
              isRecordingShortcut ? "shortcut-record-button--recording" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            type="button"
            onClick={() => setIsRecordingShortcut(true)}
            onKeyDown={handleShortcutKeyDown}
            onBlur={() => setIsRecordingShortcut(false)}
          >
            <Keyboard size={14} strokeWidth={2.3} />
            <span>
              {isRecordingShortcut
                ? "按下组合键"
                : normalizeClipboardShortcut(clipboardSettings.shortcut)}
            </span>
          </button>
        </div>
      </section>

      <section className="settings-section settings-section--colors">
        <div className="settings-section__header">
          <span>颜色设置</span>
        </div>
        <div className="color-grid">
          <ColorControl
            label="任务/待办字样"
            value={settings.taskTextColor}
            onChange={(taskTextColor) =>
              onSettingsChange({ ...settings, taskTextColor })
            }
          />
          <ColorControl
            label="亮点颜色"
            value={settings.pulseColor}
            onChange={(pulseColor) =>
              onSettingsChange({ ...settings, pulseColor })
            }
          />
          <ColorControl
            label="岛屿背景"
            value={settings.islandBackgroundColor}
            onChange={(islandBackgroundColor) =>
              onSettingsChange({ ...settings, islandBackgroundColor })
            }
          />
          <ColorControl
            label="待办纸张"
            value={settings.todoBackgroundColor}
            onChange={(todoBackgroundColor) =>
              onSettingsChange({ ...settings, todoBackgroundColor })
            }
          />
        </div>
        <SliderControl
          label="亮点亮度"
          value={settings.pulseBrightness}
          min={50}
          max={160}
          step={1}
          suffix="%"
          onChange={(pulseBrightness) =>
            onSettingsChange({ ...settings, pulseBrightness })
          }
        />
      </section>

      <section className="settings-section settings-section--presets">
        <div className="settings-section__header">
          <span>我的外观</span>
          <button
            className="preset-save-button"
            type="button"
            onClick={onSavePreset}
          >
            <Save size={13} strokeWidth={2.2} />
            <span>保存当前外观</span>
          </button>
        </div>
        {presets.length === 0 ? (
          <div className="preset-empty">还没有保存的外观方案</div>
        ) : (
          <div className="preset-list" role="list">
            {presets.map((preset) => (
              <div
                className={[
                  "preset-item",
                  preset.isDefault ? "preset-item--default" : "",
                  preset.id === activePresetId ? "preset-item--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={preset.id}
                role="listitem"
              >
                {editingPresetId === preset.id ? (
                  <input
                    className="preset-name-input"
                    value={presetNameDraft}
                    aria-label="外观方案名称"
                    autoFocus
                    onChange={(event) =>
                      setPresetNameDraft(event.currentTarget.value)
                    }
                    onBlur={commitPresetRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        commitPresetRename();
                      }

                      if (event.key === "Escape") {
                        setEditingPresetId(null);
                        setPresetNameDraft("");
                      }
                    }}
                  />
                ) : (
                  <button
                    className="preset-name-button"
                    type="button"
                    title={preset.isDefault ? "默认外观方案" : "重命名外观方案"}
                    disabled={preset.isDefault}
                    onClick={() => {
                      if (!preset.isDefault) {
                        startPresetRename(preset);
                      }
                    }}
                  >
                    {preset.name}
                  </button>
                )}
                <button
                  className="preset-apply-button"
                  type="button"
                  disabled={preset.id === activePresetId}
                  onClick={() => onApplyPreset(preset.id)}
                >
                  {preset.id === activePresetId ? "使用中" : "启用"}
                </button>
                <button
                  className="preset-apply-button"
                  type="button"
                  disabled={preset.id === startupPresetId}
                  onClick={() => onSetStartupPreset(preset.id)}
                >
                  {preset.id === startupPresetId ? "开机默认" : "设为默认"}
                </button>
                {preset.isDefault ? (
                  <span className="preset-delete-spacer" aria-hidden="true" />
                ) : (
                  <button
                    className="preset-delete-button"
                    type="button"
                    title="删除外观方案"
                    aria-label={`删除 ${preset.name}`}
                    onClick={() => onDeletePreset(preset.id)}
                  >
                    <Trash2 size={13} strokeWidth={2.2} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        className={[
          "settings-section",
          "settings-section--storage",
          "save-path-panel",
          highlightSavePath ? "save-path-panel--attention" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        ref={savePathPanelRef}
      >
        <div className="settings-section__header save-path-panel__header">
          <span>任务文件保存位置</span>
        </div>
        <div className="save-path-row">
          <label className="save-path-field">
            <span>保存到</span>
            <input
              ref={savePathInputRef}
              value={saveDirectoryDraft}
              placeholder="点击右侧按钮选择文件夹"
              aria-label="待办清单 Markdown 保存文件夹"
              onChange={(event) =>
                onSaveDirectoryDraftChange(event.currentTarget.value)
              }
            />
          </label>
          <button
            className="save-path-choose-button"
            type="button"
            onClick={onChooseSaveDirectory}
          >
            <FolderOpen size={14} strokeWidth={2.2} />
            <span>选择文件夹</span>
          </button>
          <button
            className={[
              "save-path-button",
              savePathState === "saved" ? "save-path-button--saved" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            type="button"
            onClick={onSaveDirectory}
          >
            {savePathState === "saved" ? (
              <>
                <Check className="save-check-icon" size={15} strokeWidth={2.6} />
                <span>已保存</span>
              </>
            ) : (
              <>
                <Save size={14} strokeWidth={2.2} />
                <span>保存</span>
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

function TodoNotebook({
  todos,
  dailyNote,
  draft,
  activeTodoId,
  focusTimer,
  pageMode,
  archives,
  archiveLayout,
  selectedArchive,
  saveState,
  onDraftChange,
  onAddTodo,
  onToggleTodo,
  onUpdateTodo,
  onStartTodo,
  onPauseFocus,
  onResumeFocus,
  onAddFocusTime,
  onFinishFocus,
  onDeleteTodo,
  onReorderTodo,
  onSaveToday,
  onShowArchive,
  onShowDaily,
  onShowToday,
  onShowTomorrow,
  onDailyNoteChange,
  onArchiveLayoutChange,
  onSelectArchive,
}: {
  todos: TodoItem[];
  dailyNote: string;
  draft: string;
  activeTodoId: string | null;
  focusTimer: FocusTimerState | null;
  pageMode: TodoPageMode;
  archives: TodoArchive[];
  archiveLayout: ArchiveLayout;
  selectedArchive: TodoArchive | null;
  saveState: SaveState;
  onDraftChange: (value: string) => void;
  onAddTodo: () => void;
  onToggleTodo: (id: string) => void;
  onUpdateTodo: (id: string, title: string) => void;
  onStartTodo: (id: string, minutes: number) => void;
  onPauseFocus: () => void;
  onResumeFocus: () => void;
  onAddFocusTime: () => void;
  onFinishFocus: () => void;
  onDeleteTodo: (id: string) => void;
  onReorderTodo: (sourceId: string, targetId: string) => void;
  onSaveToday: () => void;
  onShowArchive: () => void;
  onShowDaily: () => void;
  onShowToday: () => void;
  onShowTomorrow: () => void;
  onDailyNoteChange: (value: string) => void;
  onArchiveLayoutChange: (layout: ArchiveLayout) => void;
  onSelectArchive: (date: string) => void;
}) {
  const displayedTodos =
    pageMode === "review" ? selectedArchive?.todos ?? [] : todos;
  const isTodayMode = pageMode === "today";
  const isTomorrowMode = pageMode === "tomorrow";
  const isEditableMode = isTodayMode || isTomorrowMode;
  const isDailyMode = pageMode === "daily";
  const isArchiveMode = pageMode === "archive";
  const isReviewMode = pageMode === "review";
  const openCount = displayedTodos.filter((todo) => !todo.completed).length;
  const listClassName = [
    "todo-list",
    displayedTodos.length > TODO_SCROLL_START_ROWS ? "todo-list--scroll" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const inputPlaceholder = isTomorrowMode
    ? "输入明天要做的事…"
    : isTodayMode
      ? "输入今天要做的事…"
      : "Review your todos";
  const archiveTitle =
    archiveLayout === "cards" ? "Notebook cards" : "Two-column timeline";
  const notebookClassName = [
    "todo-notebook",
    isDailyMode ? "todo-notebook--daily" : "",
    isArchiveMode ? "todo-notebook--archive" : "",
    isReviewMode ? "todo-notebook--review" : "",
    focusTimer && isTodayMode ? "todo-notebook--focusing" : "",
    isArchiveMode ? `todo-notebook--archive-${archiveLayout}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [todoTitleDraft, setTodoTitleDraft] = useState("");
  const [focusPickerTodoId, setFocusPickerTodoId] = useState<string | null>(null);
  const [draggingTodoId, setDraggingTodoId] = useState<string | null>(null);

  const startTodoTitleEdit = useCallback((todo: TodoItem) => {
    if (!isEditableMode) {
      return;
    }

    setEditingTodoId(todo.id);
    setTodoTitleDraft(todo.title);
  }, [isEditableMode]);

  const commitTodoTitleEdit = useCallback(() => {
    if (!editingTodoId) {
      return;
    }

    const nextTitle = todoTitleDraft.trim();

    if (nextTitle) {
      onUpdateTodo(editingTodoId, nextTitle);
    }

    setEditingTodoId(null);
    setTodoTitleDraft("");
  }, [editingTodoId, onUpdateTodo, todoTitleDraft]);

  return (
    <section className={notebookClassName} aria-label="任务清单">
      <div className="todo-notebook__spine">
        <button
          className={[
            "todo-spine-button",
            "todo-spine-button--today",
            isTodayMode || isDailyMode ? "todo-spine-button--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          type="button"
          title="返回今日任务"
          aria-label="返回今日任务"
          onClick={onShowToday}
        >
          <CalendarDays size={14} strokeWidth={2.2} />
          <span>今日</span>
        </button>
        <button
          className={[
            "todo-spine-button",
            "todo-spine-button--save",
            saveState === "saved" ? "todo-spine-button--saved" : "",
            saveState === "saving" ? "todo-spine-button--saving" : "",
            saveState === "needs-path" || saveState === "error"
              ? "todo-spine-button--attention"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
          type="button"
          title="保存今天的任务和笔记"
          aria-label="将今天的任务和笔记保存为 Markdown"
          onClick={onSaveToday}
        >
          {saveState === "saved" ? (
            <Check className="save-check-icon" size={12} strokeWidth={3} />
          ) : (
            <Save size={14} strokeWidth={2.2} />
          )}
          <span>{saveState === "saving" ? "保存中" : saveState === "saved" ? "已保存" : "保存"}</span>
        </button>
        <button
          className={[
            "todo-spine-button",
            "todo-spine-button--archive",
            pageMode === "archive" || pageMode === "review"
              ? "todo-spine-button--active"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
          type="button"
          title="查看历史记录"
          aria-label="查看历史记录"
          onClick={onShowArchive}
        >
          <History size={14} strokeWidth={2.2} />
          <span>历史</span>
        </button>
      </div>

      <div className="todo-notebook__topline">
        <div className="todo-notebook__title-group">
          {!isArchiveMode && !isReviewMode ? (
            <div className="todo-mode-tabs" aria-label="任务日期与笔记">
              <button className={`todo-page-toggle ${isTodayMode ? "todo-page-toggle--active" : ""}`} type="button" onClick={onShowToday}>
                <CalendarDays size={14} strokeWidth={2.2} /><span>今日任务</span>
              </button>
              <button className={`todo-page-toggle ${isTomorrowMode ? "todo-page-toggle--active" : ""}`} type="button" onClick={onShowTomorrow}>
                <CalendarPlus size={14} strokeWidth={2.2} /><span>明日待办</span>
              </button>
              <button className={`todo-page-toggle ${isDailyMode ? "todo-page-toggle--active" : ""}`} type="button" onClick={onShowDaily}>
                <NotebookPen size={14} strokeWidth={2.2} /><span>每日笔记</span>
              </button>
            </div>
          ) : (
            <span className="todo-notebook__tab">
              <ClipboardList size={15} strokeWidth={2.1} />
              {isReviewMode ? selectedArchive?.date ?? "历史记录" : "历史记录"}
            </span>
          )}
        </div>
        {isArchiveMode ? (
          <div className="archive-layout-toggle" aria-label={archiveTitle}>
            <button
              className={archiveLayout === "cards" ? "archive-layout-toggle--active" : ""}
              type="button"
              title="Notebook cards"
              aria-label="Notebook cards"
              onClick={() => onArchiveLayoutChange("cards")}
            >
              <ClipboardList size={14} strokeWidth={2.1} />
            </button>
            <button
              className={archiveLayout === "timeline" ? "archive-layout-toggle--active" : ""}
              type="button"
              title="Two-column timeline"
              aria-label="Two-column timeline"
              onClick={() => onArchiveLayoutChange("timeline")}
            >
              <Columns2 size={14} strokeWidth={2.1} />
            </button>
          </div>
        ) : (
          <span className="todo-notebook__open-count">
            {openCount === 0 ? "暂无待办" : `${openCount} 个未完成`}
          </span>
        )}
      </div>

      {!isDailyMode && !isArchiveMode && (
        <form
          className="todo-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (isEditableMode) {
              onAddTodo();
            }
          }}
        >
          <input
            value={draft}
            disabled={!isEditableMode}
            placeholder={inputPlaceholder}
            aria-label="Add a task, press Enter to save"
            onChange={(event) => onDraftChange(event.currentTarget.value)}
          />
          <button
            className="todo-add-button"
            type="submit"
            disabled={!isEditableMode || !draft.trim()}
            aria-label="添加任务"
          >
            <Plus size={15} strokeWidth={2.4} />
            <span>添加</span>
          </button>
        </form>
      )}

      {isTodayMode && focusTimer && (
        <section className="focus-timer-panel" aria-label="专注倒计时">
          <span className="focus-timer-panel__task">正在专注 · {focusTimer.title}</span>
          <strong><Hourglass className="focus-timer-panel__hourglass" size={17} strokeWidth={2.3} aria-hidden="true" /> {formatFocusTime(focusTimer.remainingSeconds)}</strong>
          <span className="focus-timer-panel__progress"><i style={{ width: `${Math.min(100, Math.max(0, (1 - focusTimer.remainingSeconds / focusTimer.durationSeconds) * 100))}%` }} /></span>
          <div className="focus-timer-panel__actions">
            <button type="button" onClick={focusTimer.phase === "paused" ? onResumeFocus : onPauseFocus} disabled={focusTimer.phase === "completed"}>
              {focusTimer.phase === "paused" ? <Play size={13} /> : <Pause size={13} />}
              {focusTimer.phase === "paused" ? "继续" : "暂停"}
            </button>
            <button type="button" onClick={onAddFocusTime} disabled={focusTimer.phase === "completed"}>+5分钟</button>
            <button type="button" onClick={onFinishFocus}><Check size={13} />完成专注</button>
          </div>
        </section>
      )}

      {isArchiveMode ? (
        <ArchiveBrowser
          archives={archives}
          layout={archiveLayout}
          onSelectArchive={onSelectArchive}
        />
      ) : isDailyMode ? (
        <textarea
          className="daily-note"
          value={dailyNote}
          placeholder="Write today's notes..."
          aria-label="Daily note"
          spellCheck={false}
          onChange={(event) => onDailyNoteChange(event.currentTarget.value)}
        />
      ) : (
        <div className={listClassName} role="list">
          {displayedTodos.length === 0 ? (
            <div className="todo-empty">
              {isReviewMode ? "Nothing was written here" : isTomorrowMode ? "明天还没有安排" : "今天还很轻"}
            </div>
          ) : (
            displayedTodos.map((todo) => {
              const isActive =
                isTodayMode && todo.id === activeTodoId && !todo.completed;
              const titleLineCount = getTodoTitleLineCount(todo.title);

              return (
                <div
                  className={[
                    "todo-item",
                    todo.completed ? "todo-item--done" : "",
                    isActive ? "todo-item--active" : "",
                    !isEditableMode ? "todo-item--readonly" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={todo.id}
                  role="listitem"
                  style={
                    {
                      "--todo-title-min-height": `${titleLineCount * 19}px`,
                    } as CSSProperties
                  }
                  onDragOver={(event) => {
                    if (draggingTodoId && draggingTodoId !== todo.id && !todo.completed) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggingTodoId && draggingTodoId !== todo.id) onReorderTodo(draggingTodoId, todo.id);
                    setDraggingTodoId(null);
                  }}
                >
                  {isEditableMode && !todo.completed ? (
                    <span
                      className="todo-drag-handle"
                      draggable
                      title="拖动调整优先级"
                      onDragStart={(event) => {
                        setDraggingTodoId(todo.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", todo.id);
                      }}
                      onDragEnd={() => setDraggingTodoId(null)}
                    ><GripVertical size={15} strokeWidth={2.2} /></span>
                  ) : <span className="todo-drag-spacer" />}
                  <button
                    className="todo-check"
                    type="button"
                    aria-pressed={todo.completed}
                    disabled={!isEditableMode}
                    title={todo.completed ? "标记未完成" : "完成"}
                    aria-label={`${todo.completed ? "标记未完成" : "完成"}：${
                      todo.title
                    }`}
                    onClick={() => onToggleTodo(todo.id)}
                  >
                    {todo.completed && <Check size={14} strokeWidth={2.5} />}
                  </button>
                  {isEditableMode && editingTodoId === todo.id ? (
                    <input
                      className="todo-title-input"
                      value={todoTitleDraft}
                      aria-label="编辑任务名"
                      autoFocus
                      onChange={(event) =>
                        setTodoTitleDraft(event.currentTarget.value)
                      }
                      onBlur={commitTodoTitleEdit}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          commitTodoTitleEdit();
                        }

                        if (event.key === "Escape") {
                          setEditingTodoId(null);
                          setTodoTitleDraft("");
                        }
                      }}
                    />
                  ) : isEditableMode ? (
                    <button
                      className="todo-title todo-title--editable"
                      type="button"
                      title="编辑任务名"
                      onClick={() => startTodoTitleEdit(todo)}
                    >
                      {todo.title}
                    </button>
                  ) : (
                    <span className="todo-title">{todo.title}</span>
                  )}
                  {isEditableMode && (
                    <>
                      {isTodayMode && !focusTimer && !todo.completed && (
                        <span className="todo-focus-picker">
                          <button className="todo-focus-button" type="button" title="开始专注" aria-label={`为${todo.title}选择专注时间`} onClick={() => setFocusPickerTodoId((current) => current === todo.id ? null : todo.id)}>
                            <Timer size={15} strokeWidth={2.3} />
                          </button>
                          {focusPickerTodoId === todo.id && <span className="todo-focus-menu">
                            {[15, 25, 45, 60].map((minutes) => <button key={minutes} type="button" onClick={() => { onStartTodo(todo.id, minutes); setFocusPickerTodoId(null); }}>{minutes}分钟</button>)}
                          </span>}
                        </span>
                      )}
                      <button
                        className="todo-delete"
                        type="button"
                        title="删除"
                        aria-label={`删除：${todo.title}`}
                        onClick={() => onDeleteTodo(todo.id)}
                      >
                        <Trash2 size={14} strokeWidth={2.2} />
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

function ArchiveBrowser({
  archives,
  layout,
  onSelectArchive,
}: {
  archives: TodoArchive[];
  layout: ArchiveLayout;
  onSelectArchive: (date: string) => void;
}) {
  const handleHorizontalWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (layout !== "cards") {
      return;
    }

    event.preventDefault();
    event.currentTarget.scrollLeft += event.deltaY + event.deltaX;
  };

  if (archives.length === 0) {
    return <div className="todo-empty">No saved lists yet</div>;
  }

  if (layout === "timeline") {
    return (
      <div className="archive-timeline" role="list">
        {archives.map((archive) => (
          <button
            className="archive-timeline__item"
            key={archive.date}
            type="button"
            role="listitem"
            onClick={() => onSelectArchive(archive.date)}
          >
            <span className="archive-timeline__dot" />
            <span>{archive.date}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="archive-cards" role="list" onWheel={handleHorizontalWheel}>
      {archives.map((archive) => {
        const previewTodos = archive.todos.slice(0, 3);
        const dateParts = getDisplayDateParts(archive.date);

        return (
          <button
            className="archive-card"
            key={archive.date}
            type="button"
            role="listitem"
            onClick={() => onSelectArchive(archive.date)}
          >
            <span className="archive-card__eyebrow">TODAY</span>
            <strong className="archive-card__date">
              <span>{dateParts.year}</span>
              <span>
                {dateParts.month}
                <em>/</em>
                {dateParts.day}
              </span>
            </strong>
            <span className="archive-card__preview">
              {previewTodos.length > 0 ? (
                previewTodos.map((todo) => (
                  <span className="archive-card__todo" key={todo.id}>
                    <span
                      className={[
                        "archive-card__todo-mark",
                        todo.completed ? "archive-card__todo-mark--done" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                    <span>{todo.title}</span>
                  </span>
                ))
              ) : (
                <span className="archive-card__empty">No tasks</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function MusicPlayerPanel({
  mediaState,
  onPlayPause,
  onNext,
  onPrevious,
}: {
  mediaState: MediaState;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const isPlaying =
    mediaState.playbackStatus === "playing" ||
    (mediaState.playbackStatus !== "paused" && mediaState.audioActive);
  const isPaused = mediaState.playbackStatus === "paused";
  const hasAudioSignal = mediaState.available || mediaState.audioActive;
  const statusLabel = isPaused
    ? "Paused"
    : hasAudioSignal
      ? "Audio active"
      : "No signal";
  const peakPercent = Math.round(
    clamp(Math.log1p(mediaState.audioPeak * 160) / Math.log1p(160), 0, 1) *
      100,
  );

  return (
    <section
      className={[
        "music-player",
        hasAudioSignal ? "" : "music-player--empty",
        isPaused ? "music-player--paused" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Music player"
    >
      <div className="music-player__signal">
        <div className="music-player__status">
          <span>{statusLabel}</span>
          <strong>{peakPercent}%</strong>
        </div>
        <MusicLevelWave
          isAvailable={hasAudioSignal}
          isPlaying={isPlaying}
          audioPeak={mediaState.audioPeak}
        />
      </div>

      <div className="music-player__controls">
        <button
          className="music-control-button"
          type="button"
          title="Previous"
          aria-label="Previous track"
          onClick={onPrevious}
        >
          <SkipBack size={18} strokeWidth={2.4} />
        </button>
        <button
          className="music-control-button music-control-button--primary"
          type="button"
          title={isPlaying ? "Pause" : "Play"}
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={onPlayPause}
        >
          {isPlaying ? (
            <Pause size={20} strokeWidth={2.5} />
          ) : (
            <Play size={20} strokeWidth={2.5} />
          )}
        </button>
        <button
          className="music-control-button"
          type="button"
          title="Next"
          aria-label="Next track"
          onClick={onNext}
        >
          <SkipForward size={18} strokeWidth={2.4} />
        </button>
      </div>
    </section>
  );
}

function MusicLevelWave({
  isAvailable,
  isPlaying,
  audioPeak,
}: {
  isAvailable: boolean;
  isPlaying: boolean;
  audioPeak: number;
}) {
  const [phase, setPhase] = useState(0);
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!isAvailable && !isPlaying) {
      setPhase(0);
      return;
    }

    const interval = window.setInterval(
      () => {
        setPhase(performance.now() / (isPlaying ? 210 : 760));
      },
      prefersReducedMotion ? 460 : isPlaying ? 58 : 150,
    );

    return () => window.clearInterval(interval);
  }, [isAvailable, isPlaying, prefersReducedMotion]);

  const liftedPeak = isPlaying
    ? clamp(Math.log1p(clamp(audioPeak, 0, 1) * 185) / Math.log1p(185), 0, 1)
    : 0;
  const bars = [0.22, 0.48, 0.78, 0.54, 0.92, 0.68, 0.4, 0.72, 0.34].map(
    (bar, index) => {
      const floor = isAvailable ? 0.2 : 0.1;
      const breath =
        isAvailable && !prefersReducedMotion
          ? 0.06 + Math.sin(phase + index * 0.72) * 0.045
          : 0;
      const movement =
        liftedPeak *
        (0.34 + bar * 1.06) *
        (0.78 + Math.sin(phase * (1.05 + index * 0.05) + index * 1.35) * 0.28);

      return clamp(floor + breath + movement, 0.1, 1.08);
    },
  );

  return (
    <div className="music-player__wave" aria-hidden="true">
      {bars.map((scale, index) => (
        <span
          key={index}
          style={
            {
              "--wave-scale": scale.toFixed(3),
              "--wave-opacity": (0.3 + scale * 0.68).toFixed(3),
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function ReminderPanel({
  settings,
  schedule,
  alert,
  onChange,
  onComplete,
  onSnooze,
}: {
  settings: ReminderSettings;
  schedule: ReminderSchedule;
  alert: ReminderAlert | null;
  onChange: (settings: ReminderSettings) => void;
  onComplete: () => void;
  onSnooze: () => void;
}) {
  const update = <K extends keyof ReminderSettings>(
    key: K,
    value: ReminderSettings[K],
  ) => onChange({ ...settings, [key]: value });

  return (
    <section className="reminder-panel" aria-label="定时提醒">
      {alert && (
        <div className="reminder-alert">
          <div className="reminder-alert__message">
            <Bell size={20} />
            <strong>
              {alert.kind === "water" ? "该喝水啦" : "起来活动一下吧"}
            </strong>
          </div>
          <div className="reminder-alert__actions">
            <button type="button" onClick={onSnooze}>10 分钟后</button>
            <button className="reminder-primary" type="button" onClick={onComplete}>
              知道了
            </button>
          </div>
        </div>
      )}
      <div className="reminder-grid">
        <article className="reminder-card">
          <div className="reminder-card__heading">
            <Droplet size={18} />
            <div><strong>喝水提醒</strong><small>下次 {formatReminderTime(schedule.water)}</small></div>
            <input
              aria-label="启用喝水提醒"
              type="checkbox"
              checked={settings.waterEnabled}
              onChange={(event) => update("waterEnabled", event.target.checked)}
            />
          </div>
          <label>每 <input type="number" min="15" max="240" value={settings.waterIntervalMinutes} onChange={(event) => update("waterIntervalMinutes", clamp(Number(event.target.value) || 15, 15, 240))} /> 分钟</label>
        </article>
        <article className="reminder-card">
          <div className="reminder-card__heading">
            <Timer size={18} />
            <div><strong>久坐提醒</strong><small>下次 {formatReminderTime(schedule.sedentary)}</small></div>
            <input
              aria-label="启用久坐提醒"
              type="checkbox"
              checked={settings.sedentaryEnabled}
              onChange={(event) => update("sedentaryEnabled", event.target.checked)}
            />
          </div>
          <label>每 <input type="number" min="15" max="240" value={settings.sedentaryIntervalMinutes} onChange={(event) => update("sedentaryIntervalMinutes", clamp(Number(event.target.value) || 15, 15, 240))} /> 分钟</label>
        </article>
      </div>
      <div className="reminder-hours">
        <span>提醒时段</span>
        <label><input type="number" min="0" max="23" value={settings.startHour} onChange={(event) => update("startHour", clamp(Number(event.target.value), 0, 23))} /> 时</label>
        <span>至</span>
        <label><input type="number" min="0" max="23" value={settings.endHour} onChange={(event) => update("endHour", clamp(Number(event.target.value), 0, 23))} /> 时</label>
        <small>设置会自动保存</small>
      </div>
    </section>
  );
}

function ClipboardHistoryPanel({
  snapshot,
  onCopyItem,
  onToggleFavorite,
  onDeleteItem,
  onClear,
}: {
  snapshot: ClipboardHistorySnapshot;
  onCopyItem: (id: string) => Promise<boolean> | boolean;
  onToggleFavorite: (id: string) => Promise<void> | void;
  onDeleteItem: (id: string) => Promise<void> | void;
  onClear: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [clipboardView, setClipboardView] = useState<"all" | "favorites">("all");
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const copiedResetRef = useRef<number | null>(null);
  const confirmClearResetRef = useRef<number | null>(null);
  const itemElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const itemPositionsRef = useRef<Map<string, DOMRect>>(new Map());
  const normalizedQuery = query.trim().toLowerCase();
  const favoriteItems = useMemo(
    () => snapshot.items.filter((item) => item.favorite),
    [snapshot.items],
  );
  const viewedItems = clipboardView === "favorites" ? favoriteItems : snapshot.items;
  const filteredItems = useMemo(() => {
    if (!normalizedQuery) {
      return viewedItems;
    }

    return viewedItems.filter((item) => {
      const haystack = [
        item.preview,
        item.text ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return item.kind === "text" && haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, viewedItems]);

  useEffect(
    () => () => {
      if (copiedResetRef.current !== null) {
        window.clearTimeout(copiedResetRef.current);
      }

      if (confirmClearResetRef.current !== null) {
        window.clearTimeout(confirmClearResetRef.current);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    const visibleIds = new Set(filteredItems.map((item) => item.id));
    const nextPositions = new Map<string, DOMRect>();
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    itemElementsRef.current.forEach((element, id) => {
      if (!visibleIds.has(id)) {
        return;
      }

      const nextRect = element.getBoundingClientRect();
      const previousRect = itemPositionsRef.current.get(id);
      nextPositions.set(id, nextRect);

      if (!previousRect || prefersReducedMotion) {
        return;
      }

      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;

      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
        return;
      }

      element.getAnimations().forEach((animation) => animation.cancel());
      element.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" },
        ],
        {
          duration: 280,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        },
      );
    });

    itemPositionsRef.current = nextPositions;
  }, [filteredItems]);

  useEffect(() => {
    if (confirmClearResetRef.current !== null) {
      window.clearTimeout(confirmClearResetRef.current);
      confirmClearResetRef.current = null;
    }

    if (!isConfirmingClear) {
      return;
    }

    confirmClearResetRef.current = window.setTimeout(() => {
      setIsConfirmingClear(false);
      confirmClearResetRef.current = null;
    }, 3000);

    return () => {
      if (confirmClearResetRef.current !== null) {
        window.clearTimeout(confirmClearResetRef.current);
        confirmClearResetRef.current = null;
      }
    };
  }, [isConfirmingClear]);

  useEffect(() => {
    if (!isConfirmingClear) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const isConfirmControl = event
        .composedPath()
        .some(
          (node) =>
            node instanceof Element &&
            node.matches("[data-clipboard-confirm-control='true']"),
        );

      if (isConfirmControl) {
        return;
      }

      setIsConfirmingClear(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [isConfirmingClear]);

  useEffect(() => {
    if (snapshot.items.length === 0) {
      setIsConfirmingClear(false);
    }
  }, [snapshot.items]);

  const showCopiedState = useCallback((id: string) => {
    setCopiedItemId(id);

    if (copiedResetRef.current !== null) {
      window.clearTimeout(copiedResetRef.current);
    }

    copiedResetRef.current = window.setTimeout(() => {
      setCopiedItemId(null);
      copiedResetRef.current = null;
    }, 1100);
  }, []);

  const handleCopyItem = useCallback(
    (id: string) => {
      void Promise.resolve(onCopyItem(id)).then((didCopy) => {
        if (didCopy) {
          showCopiedState(id);
        }
      });
    },
    [onCopyItem, showCopiedState],
  );

  const handleToggleFavorite = useCallback(
    (id: string) => {
      void Promise.resolve(onToggleFavorite(id));
    },
    [onToggleFavorite],
  );

  const handleDeleteItem = useCallback(
    (id: string) => {
      setIsConfirmingClear(false);
      void Promise.resolve(onDeleteItem(id));
    },
    [onDeleteItem],
  );

  const handleClear = useCallback(() => {
    if (!isConfirmingClear) {
      setIsConfirmingClear(true);
      return;
    }

    setIsConfirmingClear(false);
    void Promise.resolve(onClear());
  }, [isConfirmingClear, onClear]);

  return (
    <section className="clipboard-panel" aria-label="剪贴板历史">
      <header className="clipboard-panel__header">
        <div className="clipboard-panel__title">
          <ClipboardList size={16} strokeWidth={2.2} />
          <span>剪贴板历史</span>
          <strong>{snapshot.items.length}</strong>
          {favoriteItems.length > 0 && (
            <em aria-label={`${favoriteItems.length} 条收藏`}>
              <Star size={10} strokeWidth={2.4} fill="currentColor" />
              {favoriteItems.length}
            </em>
          )}
        </div>
        <div className="clipboard-panel__tools">
          <span className="clipboard-shortcut-display" aria-label="展开快捷键">
            <Keyboard size={14} strokeWidth={2.3} />
            <span>{normalizeClipboardShortcut(snapshot.settings.shortcut)}</span>
          </span>
          <button
            className={[
              "clipboard-clear-button",
              isConfirmingClear ? "clipboard-clear-button--confirming" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            type="button"
            disabled={snapshot.items.length === 0}
            title={isConfirmingClear ? "确认全部清空（包含收藏）" : "全部清空"}
            aria-label={isConfirmingClear ? "确认全部清空，收藏也会删除" : "全部清空剪贴板历史和收藏"}
            onClick={handleClear}
            data-clipboard-confirm-control="true"
          >
            {isConfirmingClear ? (
              <Check className="save-check-icon" size={14} strokeWidth={2.7} />
            ) : (
              "全部清空"
            )}
          </button>
        </div>
      </header>

      <div className="clipboard-segments" aria-label="剪贴板栏目">
        <button
          className={clipboardView === "all" ? "clipboard-segment--active" : ""}
          type="button"
          aria-pressed={clipboardView === "all"}
          onClick={() => setClipboardView("all")}
        >
          全部
        </button>
        <button
          className={clipboardView === "favorites" ? "clipboard-segment--active" : ""}
          type="button"
          aria-pressed={clipboardView === "favorites"}
          onClick={() => setClipboardView("favorites")}
        >
          收藏
        </button>
      </div>

      <label className="clipboard-search">
        <Search size={15} strokeWidth={2.2} />
        <input
          value={query}
          placeholder="搜索文字"
          aria-label="搜索剪贴板文字"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {query && (
          <button
            type="button"
            title="清除搜索"
            aria-label="清除搜索"
            onClick={() => setQuery("")}
          >
            <X size={14} strokeWidth={2.4} />
          </button>
        )}
      </label>

      <div className="clipboard-list" role="list">
        {filteredItems.length === 0 ? (
          <div className="clipboard-empty">
            {snapshot.items.length === 0
              ? "复制文本或图片后会出现在这里"
              : clipboardView === "favorites" && favoriteItems.length === 0
                ? "还没有收藏剪贴记录"
                : "没有匹配的剪贴记录"}
          </div>
        ) : (
          filteredItems.map((item) => (
            <article
              className="clipboard-item"
              key={item.id}
              role="listitem"
              ref={(node) => {
                if (node) {
                  itemElementsRef.current.set(item.id, node);
                } else {
                  itemElementsRef.current.delete(item.id);
                }
              }}
            >
              <button
                className="clipboard-item__main"
                type="button"
                title="复制回剪贴板"
                onClick={() => handleCopyItem(item.id)}
              >
                {item.kind === "image" ? (
                  <span className="clipboard-item__thumb">
                    {item.image?.thumbnailDataUrl ? (
                      <img src={item.image.thumbnailDataUrl} alt="" />
                    ) : (
                      <ImageIcon size={20} strokeWidth={2.1} />
                    )}
                  </span>
                ) : (
                  <span className="clipboard-item__text-icon">
                    <ClipboardList size={17} strokeWidth={2.1} />
                  </span>
                )}
                <span className="clipboard-item__body">
                  <span className="clipboard-item__preview">{item.preview}</span>
                </span>
              </button>
              <div className="clipboard-item__actions">
                <button
                  className={[
                    "clipboard-favorite-button",
                    item.favorite ? "clipboard-favorite-button--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  title={item.favorite ? "取消收藏" : "收藏"}
                  aria-label={item.favorite ? "取消收藏剪贴记录" : "收藏剪贴记录"}
                  aria-pressed={item.favorite}
                  onClick={() => handleToggleFavorite(item.id)}
                >
                  <Star
                    size={14}
                    strokeWidth={2.3}
                    fill={item.favorite ? "currentColor" : "none"}
                  />
                </button>
                <button
                  className="clipboard-delete-button"
                  type="button"
                  title="删除"
                  aria-label="删除剪贴记录"
                  onClick={() => handleDeleteItem(item.id)}
                >
                  <Trash2 size={14} strokeWidth={2.3} />
                </button>
                <button
                  className={[
                    "clipboard-copy-button",
                    copiedItemId === item.id ? "clipboard-copy-button--copied" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  title={copiedItemId === item.id ? "已复制" : "复制"}
                  aria-label="复制回剪贴板"
                  onClick={() => handleCopyItem(item.id)}
                >
                  {copiedItemId === item.id ? (
                    <Check className="save-check-icon" size={14} strokeWidth={2.7} />
                  ) : (
                    <Copy size={14} strokeWidth={2.3} />
                  )}
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function App() {
  const [mode, setMode] = useState<IslandMode>("collapsed");
  const [isTucked, setIsTucked] = useState(false);
  const [page, setPage] = useState<IslandPage>("todo");
  const [mediaState, setMediaState] =
    useState<MediaState>(DEFAULT_MEDIA_STATE);
  const [agentStatus, setAgentStatus] =
    useState<AgentStatusSnapshot>(DEFAULT_AGENT_STATUS);
  const [reminderSettings, setReminderSettings] =
    useState<ReminderSettings>(loadReminderSettings);
  const [reminderSchedule, setReminderSchedule] =
    useState<ReminderSchedule>(loadReminderSchedule);
  const [reminderAlert, setReminderAlert] = useState<ReminderAlert | null>(null);
  const previousCodexPhase = useRef<AgentTaskPhase>("idle");
  const previousReminderAt = useRef(0);
  const isRefreshingAgentStatus = useRef(false);
  const mediaStatusLockUntil = useRef(0);
  const [settings, setSettings] = useState<IslandSettings>(loadSettings);
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [settingPresets, setSettingPresets] =
    useState<IslandPreset[]>(loadSettingPresets);
  const [activePresetId, setActivePresetId] = useState(
    () => window.localStorage.getItem(ACTIVE_PRESET_STORAGE_KEY) ?? STARTUP_DEFAULT_PRESET_ID,
  );
  const [startupPresetId, setStartupPresetId] = useState(
    () => window.localStorage.getItem(STARTUP_PRESET_STORAGE_KEY) ?? STARTUP_DEFAULT_PRESET_ID,
  );
  const [todos, setTodos] = useState<TodoItem[]>(loadTodos);
  const [tomorrowTodos, setTomorrowTodos] = useState<TodoItem[]>(loadTomorrowTodos);
  const [dailyNote, setDailyNote] = useState(loadDailyNote);
  const [draftTodo, setDraftTodo] = useState("");
  const [activeTodoId, setActiveTodoId] = useState<string | null>(
    loadActiveTodoId,
  );
  const [focusTimer, setFocusTimer] = useState<FocusTimerState | null>(loadFocusTimer);
  const [todoCompletion, setTodoCompletion] = useState<{ title: string; completedAt: number } | null>(null);
  const focusCompletionPlayed = useRef(false);
  const [currentTodoDate, setCurrentTodoDate] =
    useState<string>(loadCurrentTodoDate);
  const [archives, setArchives] = useState<TodoArchive[]>(loadTodoArchives);
  const [todoPageMode, setTodoPageMode] = useState<TodoPageMode>("today");
  const [archiveLayout, setArchiveLayout] = useState<ArchiveLayout>("cards");
  const [selectedArchiveDate, setSelectedArchiveDate] = useState<string | null>(
    null,
  );
  const [saveDirectory, setSaveDirectory] = useState(loadSaveDirectory);
  const [saveDirectoryDraft, setSaveDirectoryDraft] =
    useState(loadSaveDirectory);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savePathState, setSavePathState] = useState<SavePathState>("idle");
  const [clipboardHistory, setClipboardHistory] =
    useState<ClipboardHistorySnapshot>(DEFAULT_CLIPBOARD_HISTORY);
  const [agentHooksInstallState, setAgentHooksInstallState] =
    useState<AgentHooksInstallState>("idle");
  const [agentHooksInstallResult, setAgentHooksInstallResult] =
    useState<AgentHooksInstallResult | null>(null);
  const [agentHooksInstallError, setAgentHooksInstallError] = useState("");
  const [focusClipboardShortcutToken, setFocusClipboardShortcutToken] =
    useState(0);
  const clipboardShortcutToggleAt = useRef(0);
  const shouldInitializeDefaultSaveDirectory = useRef(
    window.localStorage.getItem(TODO_SAVE_DIRECTORY_STORAGE_KEY) === null,
  );
  const defaultSaveDirectoryRequestInFlight = useRef(false);
  const autoSaveTimer = useRef<number | null>(null);
  const autoSaveRequestId = useRef(0);
  const saveStateResetTimer = useRef<number | null>(null);
  const didHydrateAutoSave = useRef(false);
  const didCheckDate = useRef(false);
  const didShowInitialWindow = useRef(false);
  const didApplyStartupPreset = useRef(false);
  const selectedArchive =
    archives.find((archive) => archive.date === selectedArchiveDate) ?? null;
  const isTodoArchivePage =
    page === "todo" && (todoPageMode === "archive" || todoPageMode === "review");

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const storedPosition = window.localStorage.getItem(ISLAND_POSITION_STORAGE_KEY);
    let initialPosition: { x: number; y: number } | null = null;
    if (storedPosition) {
      try {
        const position = JSON.parse(storedPosition) as { x: number; y: number };
        if (Number.isFinite(position.x) && Number.isFinite(position.y)) {
          initialPosition = position;
        }
      } catch {
        window.localStorage.removeItem(ISLAND_POSITION_STORAGE_KEY);
      }
    }

    let unlisten: (() => void) | undefined;
    const initializePosition = async () => {
      if (initialPosition) {
        await invoke("set_island_custom_position", { ...initialPosition, apply: true });
      }
      unlisten = await appWindow.onMoved(({ payload }) => {
        window.localStorage.setItem(ISLAND_POSITION_STORAGE_KEY, JSON.stringify(payload));
        void invoke("set_island_custom_position", { x: payload.x, y: payload.y, apply: false });
      });
    };
    void initializePosition();
    return () => unlisten?.();
  }, []);
  const visibleTodoRows = Math.min(
    Math.max(
      todoPageMode === "daily" || isTodoArchivePage
        ? TODO_GROW_START_ROWS
        : getTodoVisualRows(todoPageMode === "tomorrow" ? tomorrowTodos : todos),
      1,
    ),
    TODO_SCROLL_START_ROWS,
  );
  const expandedIslandHeight =
    page === "todo"
      ? isTodoArchivePage
        ? TODO_ARCHIVE_EXPANDED_ISLAND_HEIGHT
        : BASE_EXPANDED_ISLAND_HEIGHT +
          Math.max(0, visibleTodoRows - TODO_GROW_START_ROWS) * TODO_ROW_HEIGHT +
          (focusTimer && todoPageMode === "today" ? 118 : 0)
      : page === "music"
        ? MUSIC_EXPANDED_ISLAND_HEIGHT
        : page === "reminder"
          ? REMINDER_EXPANDED_ISLAND_HEIGHT
        : page === "clipboard"
          ? CLIPBOARD_EXPANDED_ISLAND_HEIGHT
          : EDITOR_EXPANDED_ISLAND_HEIGHT;
  const layoutSync = useRef<{
    frame: number | null;
    inFlight: boolean;
    pending: IslandSettings;
    active: IslandSettings;
  }>({
    frame: null,
    inFlight: false,
    pending: settings,
    active: settings,
  });

  const stageStyle = useMemo(
    () =>
      ({
        "--island-opacity": settings.opacity / 100,
        "--island-scale": settings.sizeScale,
        "--expanded-island-height": `${expandedIslandHeight}px`,
        "--task-text-color": settings.taskTextColor,
        "--island-pulse-color": settings.pulseColor,
        "--island-pulse-glow-color": hexToRgba(settings.pulseColor, 0.72),
        "--island-pulse-brightness": `${settings.pulseBrightness}%`,
        "--island-background-color": settings.islandBackgroundColor,
        "--todo-background-color": settings.todoBackgroundColor,
      }) as CSSProperties,
    [
      expandedIslandHeight,
      settings.islandBackgroundColor,
      settings.opacity,
      settings.pulseBrightness,
      settings.pulseColor,
      settings.sizeScale,
      settings.taskTextColor,
      settings.todoBackgroundColor,
    ],
  );

  const syncNativeLayout = useCallback(async (nextSettings: IslandSettings) => {
    try {
      await invoke("set_island_layout", {
        layout: {
          sizeScale: nextSettings.sizeScale,
          marginY: nextSettings.marginY,
        },
      });
    } catch (error) {
      console.error("Failed to sync island layout", error);
    }
  }, []);

  const flushNativeLayout = useCallback(() => {
    const syncState = layoutSync.current;

    if (syncState.inFlight) {
      return;
    }

    const nextSettings = syncState.pending;
    syncState.active = nextSettings;
    syncState.inFlight = true;

    void syncNativeLayout(nextSettings).finally(() => {
      const latestState = layoutSync.current;
      latestState.inFlight = false;

      if (latestState.pending !== latestState.active) {
        latestState.frame = window.requestAnimationFrame(() => {
          latestState.frame = null;
          flushNativeLayout();
        });
      }
    });
  }, [syncNativeLayout]);

  const scheduleNativeLayout = useCallback(
    (nextSettings: IslandSettings) => {
      const syncState = layoutSync.current;
      syncState.pending = nextSettings;

      if (syncState.frame !== null || syncState.inFlight) {
        return;
      }

      syncState.frame = window.requestAnimationFrame(() => {
        syncState.frame = null;
        flushNativeLayout();
      });
    },
    [flushNativeLayout],
  );

  const syncNativeInteraction = useCallback(
    async (
      nextMode: IslandMode,
      nextSettings: IslandSettings,
      nextExpandedHeight: number,
      nextIsTucked: boolean,
    ) => {
      try {
        await invoke("set_island_interaction", {
          mode: nextMode,
          sizeScale: nextSettings.sizeScale,
          marginY: nextSettings.marginY,
          expandedHeight: nextExpandedHeight,
          isTucked: nextIsTucked,
        });
      } catch (error) {
        console.error("Failed to sync island interaction", error);
      }
    },
    [],
  );

  const showReadyIsland = useCallback(async () => {
    if (didShowInitialWindow.current) {
      return;
    }

    didShowInitialWindow.current = true;

    try {
      await invoke("show_ready_island");
    } catch (error) {
      console.error("Failed to show island", error);
    }
  }, []);

  const refreshClipboardHistory = useCallback(async () => {
    try {
      const snapshot = await invoke<ClipboardHistorySnapshot>(
        "get_clipboard_history",
      );
      setClipboardHistory(snapshot);
    } catch (error) {
      console.error("Failed to read clipboard history", error);
    }
  }, []);

  const refreshAgentStatus = useCallback(async () => {
    if (isRefreshingAgentStatus.current) {
      return;
    }

    isRefreshingAgentStatus.current = true;
    try {
      const snapshot = await invoke<AgentStatusSnapshot>("get_agent_status");
      setAgentStatus(snapshot);
    } catch (error) {
      console.error("Failed to read agent status", error);
      setAgentStatus(DEFAULT_AGENT_STATUS);
    } finally {
      isRefreshingAgentStatus.current = false;
    }
  }, []);

  const updateClipboardSettings = useCallback(
    async (nextSettings: ClipboardHistorySettings) => {
      const normalizedSettings = normalizeClipboardSettings(nextSettings);

      setClipboardHistory((currentHistory) => ({
        ...currentHistory,
        settings: normalizedSettings,
      }));

      try {
        const snapshot = await invoke<ClipboardHistorySnapshot>(
          "set_clipboard_history_settings",
          { settings: normalizedSettings },
        );
        setClipboardHistory(snapshot);
      } catch (error) {
        console.error("Failed to update clipboard history settings", error);
        void refreshClipboardHistory();
      }
    },
    [refreshClipboardHistory],
  );

  const copyClipboardHistoryItem = useCallback(async (id: string) => {
    try {
      const snapshot = await invoke<ClipboardHistorySnapshot>(
        "copy_clipboard_history_item",
        { id },
      );
      setClipboardHistory(snapshot);
      return true;
    } catch (error) {
      console.error("Failed to copy clipboard history item", error);
      return false;
    }
  }, []);

  const toggleClipboardHistoryFavorite = useCallback(async (id: string) => {
    try {
      const snapshot = await invoke<ClipboardHistorySnapshot>(
        "toggle_clipboard_history_favorite",
        { id },
      );
      setClipboardHistory(snapshot);
    } catch (error) {
      console.error("Failed to toggle clipboard history favorite", error);
    }
  }, []);

  const deleteClipboardHistoryItem = useCallback(async (id: string) => {
    try {
      const snapshot = await invoke<ClipboardHistorySnapshot>(
        "delete_clipboard_history_item",
        { id },
      );
      setClipboardHistory(snapshot);
    } catch (error) {
      console.error("Failed to delete clipboard history item", error);
    }
  }, []);

  const clearClipboardHistoryItems = useCallback(async () => {
    try {
      const snapshot = await invoke<ClipboardHistorySnapshot>(
        "clear_clipboard_history",
      );
      setClipboardHistory(snapshot);
    } catch (error) {
      console.error("Failed to clear clipboard history", error);
    }
  }, []);

  const minimizeIsland = useCallback(async () => {
    try {
      await invoke("minimize_island");
    } catch (error) {
      console.error("Failed to minimize island", error);
    }
  }, []);

  const setIslandMode = useCallback((nextMode: IslandMode) => {
    setMode(nextMode);
    setIsTucked(false);
  }, []);

  const tuckIsland = useCallback(() => {
    setIslandMode("collapsed");
    setIsTucked(true);
  }, [setIslandMode]);

  const revealIsland = useCallback(() => {
    setIsTucked(false);
  }, []);

  const openIslandPage = useCallback((nextPage: IslandPage) => {
    setPage(nextPage);
    setMode("expanded");
    setIsTucked(false);
  }, []);

  const openClipboardHistory = useCallback(() => {
    openIslandPage("clipboard");
  }, [openIslandPage]);

  const toggleClipboardHistory = useCallback(() => {
    const now = Date.now();

    if (now - clipboardShortcutToggleAt.current < 250) {
      return;
    }

    clipboardShortcutToggleAt.current = now;

    if (mode === "expanded" && page === "clipboard") {
      setIslandMode("collapsed");
      return;
    }

    openClipboardHistory();
  }, [mode, openClipboardHistory, page, setIslandMode]);

  const clearClipboardShortcutFocus = useCallback(() => {
    setFocusClipboardShortcutToken(0);
  }, []);

  const collapseIsland = useCallback(() => {
    setIslandMode("collapsed");
  }, [setIslandMode]);

  const refreshMediaState = useCallback(async () => {
    try {
      const nextMediaState = await invoke<MediaState>("get_media_state");

      setMediaState((currentState) => {
        const isStatusLocked = Date.now() < mediaStatusLockUntil.current;
        const nextPeak = Math.max(
          currentState.audioPeak * 0.82,
          nextMediaState.audioPeak,
        );
        const measuredAudioActive =
          nextMediaState.audioActive || nextPeak > AUDIO_ACTIVE_THRESHOLD;
        const audioActive =
          isStatusLocked && currentState.playbackStatus === "paused"
            ? false
            : measuredAudioActive;
        const playbackStatus = isStatusLocked
          ? currentState.playbackStatus
          : audioActive
            ? "playing"
            : "unavailable";

        return {
          ...nextMediaState,
          audioActive,
          audioPeak: audioActive ? nextPeak : 0,
          playbackStatus,
        };
      });
    } catch (error) {
      console.error("Failed to read media state", error);
      setMediaState((currentState) => ({
        ...DEFAULT_MEDIA_STATE,
        audioActive: currentState.audioActive,
        audioPeak: currentState.audioPeak * 0.72,
        playbackStatus: currentState.audioActive ? "playing" : "unavailable",
      }));
    }
  }, []);

  const runMediaCommand = useCallback(
    async (command: "media_play_pause" | "media_next" | "media_previous") => {
      if (command === "media_play_pause") {
        setMediaState((currentState) => {
          const isCurrentlyPlaying =
            currentState.playbackStatus === "playing" ||
            (currentState.playbackStatus !== "paused" &&
              currentState.audioActive);
          const nextStatus: MediaPlaybackStatus = isCurrentlyPlaying
            ? "paused"
            : "playing";
          mediaStatusLockUntil.current = Date.now() + 900;

          return {
            ...currentState,
            available: nextStatus === "playing" || currentState.available,
            audioActive: nextStatus === "playing",
            audioPeak:
              nextStatus === "playing"
                ? Math.max(currentState.audioPeak, 0.08)
                : 0,
            playbackStatus: nextStatus,
          };
        });
      }

      try {
        await invoke<void>(command);
      } catch (error) {
        console.error(`Failed to run media command: ${command}`, error);
      }
      window.setTimeout(() => void refreshMediaState(), 120);
      window.setTimeout(() => void refreshMediaState(), 980);
    },
    [refreshMediaState],
  );

  useEffect(() => {
    let didCancel = false;

    const refreshAudioLevel = async () => {
      try {
        const audioLevel = await invoke<AudioLevel>("get_audio_level");

        if (didCancel) {
          return;
        }

        setMediaState((currentState) => {
          const isStatusLocked = Date.now() < mediaStatusLockUntil.current;
          const shouldSuppressAudio =
            isStatusLocked && currentState.playbackStatus === "paused";
          const decayedPeak = currentState.audioPeak * 0.82;
          const nextPeak = audioLevel.active
            ? Math.max(decayedPeak, audioLevel.peak)
            : decayedPeak;
          const audioActive =
            !shouldSuppressAudio &&
            (audioLevel.active || nextPeak > AUDIO_ACTIVE_THRESHOLD * 1.5);

          return {
            ...currentState,
            audioActive,
            audioPeak: audioActive ? nextPeak : 0,
            playbackStatus:
              isStatusLocked
                ? currentState.playbackStatus
                : audioActive
                  ? "playing"
                  : currentState.playbackStatus === "paused"
                    ? "paused"
                  : "unavailable",
          };
        });
      } catch (error) {
        console.error("Failed to read audio level", error);
      }
    };

    void refreshAudioLevel();

    const interval = window.setInterval(() => {
      void refreshAudioLevel();
    }, 120);

    return () => {
      didCancel = true;
      window.clearInterval(interval);
    };
  }, []);

  const addTodo = useCallback(() => {
    const title = draftTodo.trim();

    if (!title) {
      return;
    }

    const updateTodos = todoPageMode === "tomorrow" ? setTomorrowTodos : setTodos;
    updateTodos((currentTodos) => [
      {
        id: createTodoId(),
        title,
        completed: false,
        createdAt: Date.now(),
      },
      ...currentTodos,
    ]);
    setDraftTodo("");
  }, [draftTodo, todoPageMode]);

  const toggleTodo = useCallback((id: string) => {
    const sourceTodos = todoPageMode === "tomorrow" ? tomorrowTodos : todos;
    const targetTodo = sourceTodos.find((todo) => todo.id === id);
    const updateTodos = todoPageMode === "tomorrow" ? setTomorrowTodos : setTodos;
    updateTodos((currentTodos) => {
      const index = currentTodos.findIndex((todo) => todo.id === id);
      if (index < 0) return currentTodos;
      const nextTodos = [...currentTodos];
      const [target] = nextTodos.splice(index, 1);
      const updated = { ...target, completed: !target.completed };
      if (updated.completed) {
        nextTodos.push(updated);
      } else {
        const firstCompleted = nextTodos.findIndex((todo) => todo.completed);
        nextTodos.splice(firstCompleted < 0 ? nextTodos.length : firstCompleted, 0, updated);
      }
      return nextTodos;
    });
    if (todoPageMode === "today") {
      setActiveTodoId((currentId) => (currentId === id ? null : currentId));
      setFocusTimer((timer) => timer?.todoId === id ? null : timer);
      if (targetTodo && !targetTodo.completed) {
        setTodoCompletion({ title: targetTodo.title, completedAt: Date.now() });
      }
    }
  }, [todoPageMode, todos, tomorrowTodos]);

  const updateTodoTitle = useCallback((id: string, title: string) => {
    const nextTitle = title.trim();

    if (!nextTitle) {
      return;
    }

    const updateTodos = todoPageMode === "tomorrow" ? setTomorrowTodos : setTodos;
    updateTodos((currentTodos) =>
      currentTodos.map((todo) =>
        todo.id === id ? { ...todo, title: nextTitle } : todo,
      ),
    );
  }, [todoPageMode]);

  const startTodo = useCallback(
    (id: string, minutes: number) => {
      const todo = todos.find((item) => item.id === id);

      if (!todo || todo.completed) {
        return;
      }

      setActiveTodoId(id);
      const durationSeconds = Math.max(60, Math.round(minutes * 60));
      setFocusTimer({
        todoId: id,
        title: todo.title,
        durationSeconds,
        remainingSeconds: durationSeconds,
        endAt: Date.now() + durationSeconds * 1000,
        phase: "running",
      });
      focusCompletionPlayed.current = false;
      setIslandMode("collapsed");
    },
    [activeTodoId, setIslandMode, todos],
  );

  const pauseFocusTimer = useCallback(() => {
    setFocusTimer((timer) => timer ? { ...timer, remainingSeconds: timer.endAt ? Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000)) : timer.remainingSeconds, endAt: null, phase: "paused" } : null);
  }, []);

  const resumeFocusTimer = useCallback(() => {
    setFocusTimer((timer) => timer && timer.remainingSeconds > 0 ? { ...timer, endAt: Date.now() + timer.remainingSeconds * 1000, phase: "running" } : timer);
  }, []);

  const addFocusTime = useCallback(() => {
    setFocusTimer((timer) => timer ? { ...timer, durationSeconds: timer.durationSeconds + 300, remainingSeconds: timer.remainingSeconds + 300, endAt: timer.endAt ? timer.endAt + 300_000 : null } : null);
  }, []);

  const finishFocusTimer = useCallback(() => {
    setFocusTimer((timer) => timer ? { ...timer, remainingSeconds: 0, endAt: null, phase: "completed" } : null);
    setActiveTodoId(null);
  }, []);

  const deleteTodo = useCallback((id: string) => {
    const updateTodos = todoPageMode === "tomorrow" ? setTomorrowTodos : setTodos;
    updateTodos((currentTodos) => currentTodos.filter((todo) => todo.id !== id));
    if (todoPageMode === "today") {
      setActiveTodoId((currentId) => (currentId === id ? null : currentId));
      setFocusTimer((timer) => timer?.todoId === id ? null : timer);
    }
  }, [todoPageMode]);

  const reorderTodo = useCallback((sourceId: string, targetId: string) => {
    const updateTodos = todoPageMode === "tomorrow" ? setTomorrowTodos : setTodos;
    updateTodos((currentTodos) => {
      const sourceIndex = currentTodos.findIndex((todo) => todo.id === sourceId && !todo.completed);
      const targetIndex = currentTodos.findIndex((todo) => todo.id === targetId && !todo.completed);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return currentTodos;
      const nextTodos = [...currentTodos];
      const [moved] = nextTodos.splice(sourceIndex, 1);
      nextTodos.splice(targetIndex, 0, moved);
      return nextTodos;
    });
  }, [todoPageMode]);

  const upsertArchive = useCallback(
    (
      date: string,
      todoList: TodoItem[],
      nextDailyNote: string,
      savedToDisk: boolean,
      filePath?: string,
    ) => {
      const archive: TodoArchive = {
        date,
        todos: todoList,
        dailyNote: nextDailyNote,
        savedAt: Date.now(),
        savedToDisk,
        filePath,
      };

      setArchives((currentArchives) =>
        [archive, ...currentArchives.filter((item) => item.date !== date)].sort(
          (a, b) => b.date.localeCompare(a.date),
        ),
      );
    },
    [],
  );

  const saveTodosToDisk = useCallback(
    async (date: string, todoList: TodoItem[], nextDailyNote: string) => {
      const directory = saveDirectory.trim();

      if (!directory) {
        throw new Error("Missing todo save path.");
      }

      const result = await invoke<SaveTodoResult>("save_todo_markdown", {
        directory,
        date,
        content: formatTodoDocumentAsMarkdown(todoList, nextDailyNote),
      });

      upsertArchive(date, todoList, nextDailyNote, true, result.filePath);
      window.localStorage.setItem(
        TODO_LAST_SAVED_SIGNATURE_STORAGE_KEY,
        getTodoSignature(date, todoList, nextDailyNote),
      );

      return result;
    },
    [saveDirectory, upsertArchive],
  );

  const showTodoSavedState = useCallback(() => {
    if (saveStateResetTimer.current !== null) {
      window.clearTimeout(saveStateResetTimer.current);
    }

    setSaveState("saved");
    saveStateResetTimer.current = window.setTimeout(() => {
      setSaveState("idle");
      saveStateResetTimer.current = null;
    }, 1200);
  }, []);

  const saveTodayTodos = useCallback(async () => {
    if (!saveDirectory.trim()) {
      setSaveState("needs-path");
      setPage("layout");
      setMode("expanded");
      setIsTucked(false);
      return;
    }

    setSaveState("saving");

    try {
      await saveTodosToDisk(currentTodoDate, todos, dailyNote);
      showTodoSavedState();
    } catch (error) {
      console.error("Failed to save todo markdown", error);
      setSaveState("error");
    }
  }, [
    currentTodoDate,
    dailyNote,
    saveDirectory,
    saveTodosToDisk,
    showTodoSavedState,
    todos,
  ]);

  const saveDirectoryFromEditor = useCallback(() => {
    const nextDirectory = saveDirectoryDraft.trim();

    setSaveDirectory(nextDirectory);
    setSaveDirectoryDraft(nextDirectory);
    setSaveState("idle");
    setSavePathState("saved");
    window.setTimeout(() => setSavePathState("idle"), 1200);
  }, [saveDirectoryDraft]);

  const chooseSaveDirectory = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "选择任务文件保存位置",
      });

      if (typeof selected !== "string") {
        return;
      }

      setSaveDirectory(selected);
      setSaveDirectoryDraft(selected);
      setSaveState("idle");
      setSavePathState("saved");
      window.setTimeout(() => setSavePathState("idle"), 1200);
    } catch (error) {
      console.error("Failed to choose todo save directory", error);
      setSaveState("error");
    }
  }, []);

  const showArchive = useCallback(() => {
    setTodoPageMode("archive");
    setSelectedArchiveDate(null);
    setDraftTodo("");
  }, []);

  const showToday = useCallback(() => {
    setTodoPageMode("today");
    setSelectedArchiveDate(null);
    setDraftTodo("");
  }, []);

  const showTomorrow = useCallback(() => {
    setTodoPageMode("tomorrow");
    setSelectedArchiveDate(null);
    setDraftTodo("");
  }, []);

  const showDaily = useCallback(() => {
    setTodoPageMode("daily");
    setSelectedArchiveDate(null);
    setDraftTodo("");
  }, []);

  const selectArchive = useCallback(
    (date: string) => {
      if (date === currentTodoDate) {
        showToday();
        return;
      }

      setSelectedArchiveDate(date);
      setTodoPageMode("review");
      setDraftTodo("");
    },
    [currentTodoDate, showToday],
  );

  const rolloverToToday = useCallback(
    async (nextDate: string) => {
      const signature = getTodoSignature(currentTodoDate, todos, dailyNote);
      const lastSavedSignature = window.localStorage.getItem(
        TODO_LAST_SAVED_SIGNATURE_STORAGE_KEY,
      );

      if (
        (todos.length > 0 || dailyNote.trim()) &&
        signature !== lastSavedSignature
      ) {
        if (saveDirectory.trim()) {
          try {
            await saveTodosToDisk(currentTodoDate, todos, dailyNote);
          } catch (error) {
            console.error("Failed to auto-save todo markdown", error);
            upsertArchive(currentTodoDate, todos, dailyNote, false);
          }
        } else {
          upsertArchive(currentTodoDate, todos, dailyNote, false);
        }
      }

      setTodos(tomorrowTodos);
      setTomorrowTodos([]);
      setDailyNote("");
      setActiveTodoId(null);
      setCurrentTodoDate(nextDate);
      setTodoPageMode("today");
      setSelectedArchiveDate(null);
      window.localStorage.setItem(
        TODO_LAST_SAVED_SIGNATURE_STORAGE_KEY,
        getTodoSignature(nextDate, tomorrowTodos, ""),
      );
    },
    [
      currentTodoDate,
      dailyNote,
      saveDirectory,
      saveTodosToDisk,
      todos,
      tomorrowTodos,
      upsertArchive,
    ],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    setActivePresetId(STARTUP_DEFAULT_PRESET_ID);
    window.localStorage.setItem(ACTIVE_PRESET_STORAGE_KEY, STARTUP_DEFAULT_PRESET_ID);
    scheduleNativeLayout(DEFAULT_SETTINGS);
  }, [scheduleNativeLayout]);

  const updateSettingsFromEditor = useCallback((nextSettings: IslandSettings) => {
    setSettings(nextSettings);
    setActivePresetId("");
    window.localStorage.removeItem(ACTIVE_PRESET_STORAGE_KEY);
  }, []);

  const resetIslandPosition = useCallback(async () => {
    window.localStorage.removeItem(ISLAND_POSITION_STORAGE_KEY);
    try {
      await invoke("reset_island_position");
    } catch (error) {
      console.error("Failed to reset island position", error);
    }
  }, []);

  const saveSettingsPreset = useCallback(() => {
    const presetId = createTodoId();
    setSettingPresets((currentPresets) => {
      const customPresetCount = currentPresets.filter(
        (preset) => !preset.isDefault && !isDefaultSettingPreset(preset.id),
      ).length;
      const preset: IslandPreset = {
        id: presetId,
        name: `自定义外观 ${customPresetCount + 1}`,
        settings: normalizeSettings({ ...settings }),
        createdAt: Date.now(),
        isDefault: false,
      };

      return mergeWithDefaultSettingPresets([preset, ...currentPresets]);
    });
    setActivePresetId(presetId);
    window.localStorage.setItem(ACTIVE_PRESET_STORAGE_KEY, presetId);
  }, [settings]);

  const applySettingsPreset = useCallback(
    (presetId: string) => {
      const preset = settingPresets.find((item) => item.id === presetId);

      if (!preset) {
        return;
      }

      const nextSettings = normalizeSettings(preset.settings);
      setSettings(nextSettings);
      setActivePresetId(presetId);
      window.localStorage.setItem(ACTIVE_PRESET_STORAGE_KEY, presetId);
      scheduleNativeLayout(nextSettings);
    },
    [scheduleNativeLayout, settingPresets],
  );

  const setStartupSettingsPreset = useCallback((presetId: string) => {
    const preset = settingPresets.find((item) => item.id === presetId);
    if (!preset) return;
    setStartupPresetId(presetId);
    window.localStorage.setItem(STARTUP_PRESET_STORAGE_KEY, presetId);
  }, [settingPresets]);

  const renameSettingsPreset = useCallback((presetId: string, name: string) => {
    const nextName = name.trim();

    if (
      !nextName ||
      isDefaultSettingPreset(presetId) ||
      LEGACY_DEFAULT_PRESET_NAMES.has(nextName)
    ) {
      return;
    }

    setSettingPresets((currentPresets) =>
      currentPresets.map((preset) =>
        preset.id === presetId ? { ...preset, name: nextName } : preset,
      ),
    );
  }, []);

  const deleteSettingsPreset = useCallback((presetId: string) => {
    if (isDefaultSettingPreset(presetId)) {
      return;
    }

    setSettingPresets((currentPresets) =>
      currentPresets.filter((preset) => preset.id !== presetId),
    );
    if (activePresetId === presetId) {
      const next = getDefaultSettingPresets()[0];
      setSettings(next.settings);
      setActivePresetId(next.id);
      window.localStorage.setItem(ACTIVE_PRESET_STORAGE_KEY, next.id);
    }
    if (startupPresetId === presetId) {
      setStartupPresetId(STARTUP_DEFAULT_PRESET_ID);
      window.localStorage.setItem(STARTUP_PRESET_STORAGE_KEY, STARTUP_DEFAULT_PRESET_ID);
    }
  }, [activePresetId, startupPresetId]);

  const updateLaunchAtStartup = useCallback(async (enabled: boolean) => {
    setLaunchAtStartup(enabled);

    try {
      await invoke("set_launch_at_startup", { enabled });
    } catch (error) {
      console.error("Failed to update launch at startup", error);
      setLaunchAtStartup(!enabled);
    }
  }, []);

  const installAgentHooks = useCallback(async () => {
    setAgentHooksInstallState("installing");
    setAgentHooksInstallError("");

    try {
      const result = await invoke<AgentHooksInstallResult>(
        "install_agent_status_hooks",
      );
      setAgentHooksInstallResult(result);
      setAgentHooksInstallState("installed");
      void refreshAgentStatus();
    } catch (error) {
      console.error("Failed to install agent status hooks", error);
      setAgentHooksInstallError(getErrorMessage(error));
      setAgentHooksInstallState("error");
    }
  }, [refreshAgentStatus]);

  useEffect(() => {
    void invoke<boolean>("get_launch_at_startup")
      .then(setLaunchAtStartup)
      .catch((error) => {
        console.error("Failed to read launch at startup", error);
      });
  }, []);

  useEffect(() => {
    void refreshClipboardHistory();

    let unlistenChanges: (() => void) | null = null;
    let unlistenShortcut: (() => void) | null = null;

    void listen("clipboard-history-changed", () => {
      void refreshClipboardHistory();
    })
      .then((nextUnlisten) => {
        unlistenChanges = nextUnlisten;
      })
      .catch((error) => {
        console.error("Failed to listen for clipboard history changes", error);
      });

    void listen("clipboard-history-shortcut", () => {
      toggleClipboardHistory();
    })
      .then((nextUnlisten) => {
        unlistenShortcut = nextUnlisten;
      })
      .catch((error) => {
        console.error("Failed to listen for clipboard history shortcut", error);
      });

    return () => {
      unlistenChanges?.();
      unlistenShortcut?.();
    };
  }, [refreshClipboardHistory, toggleClipboardHistory]);

  useEffect(() => {
    void refreshMediaState();

    const interval = window.setInterval(() => {
      void refreshMediaState();
    }, 1500);

    return () => window.clearInterval(interval);
  }, [refreshMediaState]);

  useEffect(() => {
    void refreshAgentStatus();

    const interval = window.setInterval(() => {
      void refreshAgentStatus();
    }, 200);

    return () => window.clearInterval(interval);
  }, [refreshAgentStatus]);

  useEffect(() => {
    window.localStorage.setItem(
      REMINDER_SETTINGS_STORAGE_KEY,
      JSON.stringify(reminderSettings),
    );
  }, [reminderSettings]);

  useEffect(() => {
    window.localStorage.setItem(
      REMINDER_SCHEDULE_STORAGE_KEY,
      JSON.stringify(reminderSchedule),
    );
  }, [reminderSchedule]);

  useEffect(() => {
    const phase = agentStatus.codex.phase;
    const phaseChanged = previousCodexPhase.current !== phase;
    previousCodexPhase.current = phase;

    if (
      phaseChanged &&
      settings.soundEnabled &&
      Date.now() - agentStatus.codex.updatedAt < 3_000 &&
      (phase === "completed" || phase === "failed")
    ) {
      playFeedbackSound(phase, settings.soundVolume);
    }
  }, [agentStatus.codex.phase, agentStatus.codex.updatedAt, settings.soundEnabled, settings.soundVolume]);

  useEffect(() => {
    if (
      reminderAlert &&
      reminderAlert.triggeredAt !== previousReminderAt.current
    ) {
      previousReminderAt.current = reminderAlert.triggeredAt;
      if (settings.soundEnabled) {
        playFeedbackSound("reminder", settings.soundVolume);
      }
    }
  }, [reminderAlert, settings.soundEnabled, settings.soundVolume]);

  useEffect(() => {
    const checkReminders = () => {
      if (reminderAlert || !isReminderActiveNow(reminderSettings)) return;
      const now = Date.now();
      const dueKind: ReminderKind | null =
        reminderSettings.waterEnabled && now >= reminderSchedule.water
          ? "water"
          : reminderSettings.sedentaryEnabled && now >= reminderSchedule.sedentary
            ? "sedentary"
            : null;
      if (!dueKind) return;

      const intervalMinutes =
        dueKind === "water"
          ? reminderSettings.waterIntervalMinutes
          : reminderSettings.sedentaryIntervalMinutes;
      setReminderSchedule((current) => ({
        ...current,
        [dueKind]: now + intervalMinutes * 60_000,
      }));
      setReminderAlert({ kind: dueKind, triggeredAt: now });
      setMode("collapsed");
      setIsTucked(false);
    };

    checkReminders();
    const interval = window.setInterval(checkReminders, 15_000);
    return () => window.clearInterval(interval);
  }, [reminderAlert, reminderSchedule, reminderSettings]);

  useEffect(() => {
    if (
      !shouldInitializeDefaultSaveDirectory.current ||
      saveDirectory.trim() ||
      defaultSaveDirectoryRequestInFlight.current
    ) {
      return;
    }

    let didCancel = false;
    defaultSaveDirectoryRequestInFlight.current = true;

    void invoke<string>("get_default_todo_save_directory")
      .then((defaultDirectory) => {
        if (didCancel) {
          return;
        }

        const nextDirectory = defaultDirectory.trim();

        if (!nextDirectory) {
          return;
        }

        shouldInitializeDefaultSaveDirectory.current = false;
        setSaveDirectory((currentDirectory) =>
          currentDirectory.trim() ? currentDirectory : nextDirectory,
        );
        setSaveDirectoryDraft((currentDirectory) =>
          currentDirectory.trim() ? currentDirectory : nextDirectory,
        );
      })
      .catch((error) => {
        console.error("Failed to resolve default todo save path", error);
      })
      .finally(() => {
        if (!didCancel) {
          defaultSaveDirectoryRequestInFlight.current = false;
        }
      });

    return () => {
      didCancel = true;
      defaultSaveDirectoryRequestInFlight.current = false;
    };
  }, [saveDirectory]);

  useEffect(() => {
    if (didApplyStartupPreset.current) return;
    didApplyStartupPreset.current = true;
    const preset = settingPresets.find((item) => item.id === startupPresetId)
      ?? settingPresets.find((item) => item.id === STARTUP_DEFAULT_PRESET_ID);
    if (preset) {
      const nextSettings = normalizeSettings(preset.settings);
      setSettings(nextSettings);
      setActivePresetId(preset.id);
      window.localStorage.setItem(ACTIVE_PRESET_STORAGE_KEY, preset.id);
    }
  }, [settingPresets, startupPresetId]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(
      SETTINGS_PRESETS_STORAGE_KEY,
      JSON.stringify(settingPresets),
    );
  }, [settingPresets]);

  useEffect(() => {
    window.localStorage.setItem(TODOS_STORAGE_KEY, JSON.stringify(todos));
  }, [todos]);

  useEffect(() => {
    window.localStorage.setItem(TOMORROW_TODOS_STORAGE_KEY, JSON.stringify(tomorrowTodos));
  }, [tomorrowTodos]);

  useEffect(() => {
    if (focusTimer) {
      window.localStorage.setItem(FOCUS_TIMER_STORAGE_KEY, JSON.stringify(focusTimer));
    } else {
      window.localStorage.removeItem(FOCUS_TIMER_STORAGE_KEY);
    }
  }, [focusTimer]);

  useEffect(() => {
    if (focusTimer?.phase !== "running" || !focusTimer.endAt) return;
    const update = () => {
      setFocusTimer((timer) => {
        if (!timer || timer.phase !== "running" || !timer.endAt) return timer;
        const remainingSeconds = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
        return remainingSeconds === 0
          ? { ...timer, remainingSeconds: 0, endAt: null, phase: "completed" }
          : { ...timer, remainingSeconds };
      });
    };
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [focusTimer?.phase, focusTimer?.endAt]);

  useEffect(() => {
    if (focusTimer?.phase !== "completed") return;
    if (!focusCompletionPlayed.current && settings.soundEnabled) {
      focusCompletionPlayed.current = true;
      playFeedbackSound("completed", settings.soundVolume);
    }
    const timer = window.setTimeout(() => setFocusTimer(null), 5000);
    return () => window.clearTimeout(timer);
  }, [focusTimer?.phase, settings.soundEnabled, settings.soundVolume]);

  useEffect(() => {
    if (!todoCompletion) return;
    if (settings.soundEnabled) playFeedbackSound("completed", settings.soundVolume);
    const timer = window.setTimeout(() => setTodoCompletion(null), 4000);
    return () => window.clearTimeout(timer);
  }, [todoCompletion?.completedAt, settings.soundEnabled, settings.soundVolume]);

  useEffect(() => {
    window.localStorage.setItem(DAILY_NOTE_STORAGE_KEY, dailyNote);
  }, [dailyNote]);

  useEffect(() => {
    window.localStorage.setItem(TODO_DATE_STORAGE_KEY, currentTodoDate);
  }, [currentTodoDate]);

  useEffect(() => {
    window.localStorage.setItem(TODO_ARCHIVE_STORAGE_KEY, JSON.stringify(archives));
  }, [archives]);

  useEffect(() => {
    if (!saveDirectory && shouldInitializeDefaultSaveDirectory.current) {
      return;
    }

    window.localStorage.setItem(TODO_SAVE_DIRECTORY_STORAGE_KEY, saveDirectory);
  }, [saveDirectory]);

  useEffect(() => {
    if (!didHydrateAutoSave.current) {
      didHydrateAutoSave.current = true;
      return;
    }

    if (autoSaveTimer.current !== null) {
      window.clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }

    if (!saveDirectory.trim()) {
      return;
    }

    const signature = getTodoSignature(currentTodoDate, todos, dailyNote);
    const lastSavedSignature = window.localStorage.getItem(
      TODO_LAST_SAVED_SIGNATURE_STORAGE_KEY,
    );

    if (!todos.length && !dailyNote.trim() && !lastSavedSignature) {
      return;
    }

    if (signature === lastSavedSignature) {
      return;
    }

    const timer = window.setTimeout(() => {
      autoSaveTimer.current = null;
      autoSaveRequestId.current += 1;
      const requestId = autoSaveRequestId.current;

      void saveTodosToDisk(currentTodoDate, todos, dailyNote)
        .catch((error) => {
          if (requestId === autoSaveRequestId.current) {
            console.error("Failed to auto-save todo markdown", error);
            setSaveState("error");
          }
        });
    }, 700);

    autoSaveTimer.current = timer;

    return () => {
      if (autoSaveTimer.current === timer) {
        window.clearTimeout(timer);
        autoSaveTimer.current = null;
      }
    };
  }, [
    currentTodoDate,
    dailyNote,
    saveDirectory,
    saveTodosToDisk,
    todos,
  ]);

  useEffect(
    () => () => {
      if (autoSaveTimer.current !== null) {
        window.clearTimeout(autoSaveTimer.current);
      }

      if (saveStateResetTimer.current !== null) {
        window.clearTimeout(saveStateResetTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (activeTodoId) {
      window.localStorage.setItem(ACTIVE_TODO_STORAGE_KEY, activeTodoId);
      return;
    }

    window.localStorage.removeItem(ACTIVE_TODO_STORAGE_KEY);
  }, [activeTodoId]);

  useEffect(() => {
    if (
      activeTodoId &&
      !todos.some((todo) => todo.id === activeTodoId && !todo.completed)
    ) {
      setActiveTodoId(null);
    }
  }, [activeTodoId, todos]);

  useEffect(() => {
    if (didCheckDate.current) {
      return;
    }

    didCheckDate.current = true;
    const today = getLocalDateString();

    if (currentTodoDate !== today) {
      void rolloverToToday(today);
    }
  }, [currentTodoDate, rolloverToToday]);

  useEffect(() => {
    const checkForNewDay = () => {
      const today = getLocalDateString();

      if (currentTodoDate !== today) {
        void rolloverToToday(today);
      }
    };

    const interval = window.setInterval(checkForNewDay, 30_000);
    return () => window.clearInterval(interval);
  }, [currentTodoDate, rolloverToToday]);

  useEffect(() => {
    scheduleNativeLayout(settings);
  }, [settings.marginY, scheduleNativeLayout]);

  useEffect(() => {
    void syncNativeInteraction(
      mode,
      settings,
      expandedIslandHeight,
      isTucked,
    ).finally(() => {
      void showReadyIsland();
    });
  }, [
    expandedIslandHeight,
    isTucked,
    mode,
    settings.marginY,
    settings.sizeScale,
    showReadyIsland,
    syncNativeInteraction,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (matchesClipboardShortcut(event, clipboardHistory.settings.shortcut)) {
        event.preventDefault();
        toggleClipboardHistory();
        return;
      }

      if (event.key === "Escape") {
        collapseIsland();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clipboardHistory.settings.shortcut, collapseIsland, toggleClipboardHistory]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let unlisten: (() => void) | null = null;

    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused && mode === "expanded") {
          collapseIsland();
        }
      })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
      })
      .catch((error) => {
        console.error("Failed to listen for island focus changes", error);
      });

    return () => {
      unlisten?.();
    };
  }, [collapseIsland, mode]);

  const activeTaskTitle = useMemo(() => {
    const activeTodo = todos.find(
      (todo) => todo.id === activeTodoId && !todo.completed,
    );

    return activeTodo?.title ?? null;
  }, [activeTodoId, todos]);
  const openTodoCount = useMemo(
    () => todos.filter((todo) => !todo.completed).length,
    [todos],
  );
  const nextTodoTitle = useMemo(
    () => todos.find((todo) => !todo.completed)?.title ?? null,
    [todos],
  );
  const isAgentRunning = useMemo(
    () =>
      agentStatus.codex.phase === "running" ||
      agentStatus.claudeCode.phase === "running",
    [agentStatus],
  );
  const updateReminderSettings = useCallback(
    (next: ReminderSettings) => {
      const now = Date.now();
      setReminderSchedule((current) => ({
        water:
          next.waterEnabled !== reminderSettings.waterEnabled ||
          next.waterIntervalMinutes !== reminderSettings.waterIntervalMinutes
            ? now + next.waterIntervalMinutes * 60_000
            : current.water,
        sedentary:
          next.sedentaryEnabled !== reminderSettings.sedentaryEnabled ||
          next.sedentaryIntervalMinutes !== reminderSettings.sedentaryIntervalMinutes
            ? now + next.sedentaryIntervalMinutes * 60_000
            : current.sedentary,
      }));
      setReminderSettings(next);
    },
    [reminderSettings],
  );
  const snoozeReminder = useCallback(() => {
    if (reminderAlert) {
      setReminderSchedule((current) => ({
        ...current,
        [reminderAlert.kind]: Date.now() + 10 * 60_000,
      }));
    }
    setReminderAlert(null);
  }, [reminderAlert]);

  return (
    <main className="stage" style={stageStyle}>
      <IslandShell
        mode={mode}
        page={page}
        isTucked={isTucked}
        showTitle={settings.showTitle}
        activeTaskTitle={activeTaskTitle}
        nextTodoTitle={nextTodoTitle}
        pendingTodoCount={openTodoCount}
        focusTimer={focusTimer}
        todoCompletion={todoCompletion}
        mediaState={mediaState}
        agentStatus={agentStatus}
        isAgentRunning={isAgentRunning}
        reminderAlert={reminderAlert}
        onOpenPage={openIslandPage}
        onOpenReminder={() => {
          setPage("reminder");
          setMode("expanded");
        }}
        onCollapse={collapseIsland}
        onMinimize={minimizeIsland}
        onTuck={tuckIsland}
        onReveal={revealIsland}
        onPageChange={setPage}
      >
        {page === "reminder" && (
          <ReminderPanel
            settings={reminderSettings}
            schedule={reminderSchedule}
            alert={reminderAlert}
            onChange={updateReminderSettings}
            onComplete={() => setReminderAlert(null)}
            onSnooze={snoozeReminder}
          />
        )}
        {page === "layout" && (
          <LayoutEditor
            settings={settings}
            clipboardSettings={clipboardHistory.settings}
            saveDirectoryDraft={saveDirectoryDraft}
            savePathState={savePathState}
            highlightSavePath={saveState === "needs-path"}
            focusClipboardShortcutToken={focusClipboardShortcutToken}
            presets={settingPresets}
            activePresetId={activePresetId}
            startupPresetId={startupPresetId}
            launchAtStartup={launchAtStartup}
            agentHooksInstallState={agentHooksInstallState}
            agentHooksInstallResult={agentHooksInstallResult}
            agentHooksInstallError={agentHooksInstallError}
            onSettingsChange={updateSettingsFromEditor}
            onClipboardSettingsChange={updateClipboardSettings}
            onReset={resetSettings}
            onResetPosition={resetIslandPosition}
            onSaveDirectoryDraftChange={setSaveDirectoryDraft}
            onSaveDirectory={saveDirectoryFromEditor}
            onChooseSaveDirectory={chooseSaveDirectory}
            onSavePreset={saveSettingsPreset}
            onApplyPreset={applySettingsPreset}
            onSetStartupPreset={setStartupSettingsPreset}
            onRenamePreset={renameSettingsPreset}
            onDeletePreset={deleteSettingsPreset}
            onLaunchAtStartupChange={updateLaunchAtStartup}
            onInstallAgentHooks={installAgentHooks}
            onClipboardShortcutFocusHandled={clearClipboardShortcutFocus}
          />
        )}
        {page === "music" && (
          <MusicPlayerPanel
            mediaState={mediaState}
            onPlayPause={() => void runMediaCommand("media_play_pause")}
            onNext={() => void runMediaCommand("media_next")}
            onPrevious={() => void runMediaCommand("media_previous")}
          />
        )}
        {page === "clipboard" && (
          <ClipboardHistoryPanel
            snapshot={clipboardHistory}
            onCopyItem={copyClipboardHistoryItem}
            onToggleFavorite={(id) => void toggleClipboardHistoryFavorite(id)}
            onDeleteItem={(id) => void deleteClipboardHistoryItem(id)}
            onClear={() => void clearClipboardHistoryItems()}
          />
        )}
        {page === "todo" && (
          <TodoNotebook
            todos={todoPageMode === "tomorrow" ? tomorrowTodos : todos}
            dailyNote={dailyNote}
            draft={draftTodo}
            activeTodoId={activeTodoId}
            focusTimer={focusTimer}
            pageMode={todoPageMode}
            archives={archives}
            archiveLayout={archiveLayout}
            selectedArchive={selectedArchive}
            saveState={saveState}
            onDraftChange={setDraftTodo}
            onAddTodo={addTodo}
            onToggleTodo={toggleTodo}
            onUpdateTodo={updateTodoTitle}
            onStartTodo={startTodo}
            onPauseFocus={pauseFocusTimer}
            onResumeFocus={resumeFocusTimer}
            onAddFocusTime={addFocusTime}
            onFinishFocus={finishFocusTimer}
            onDeleteTodo={deleteTodo}
            onReorderTodo={reorderTodo}
            onSaveToday={saveTodayTodos}
            onShowArchive={showArchive}
            onShowDaily={showDaily}
            onShowToday={showToday}
            onShowTomorrow={showTomorrow}
            onDailyNoteChange={setDailyNote}
            onArchiveLayoutChange={setArchiveLayout}
            onSelectArchive={selectArchive}
          />
        )}
      </IslandShell>
    </main>
  );
}

export default App;
