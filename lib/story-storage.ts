import { getNow } from "@/lib/virtual-time";
import Dexie from "dexie";
import { formatChatTimestamp } from "./llm-prompt-assembler";

export type StoryUiPrefs = {
  hideBubble?: boolean;
  hideAvatar?: boolean;
  hideTimestamp?: boolean;
  theme?: string;
  /** 是否启用剧情页的角色绑定语音。 */
  voiceEnabled?: boolean;
  /** 当前角色剧情页独立壁纸（data URL 或可访问 URL）。 */
  wallpaper?: string;
  /** 是否在剧情输入栏显示自动阅读控制。 */
  autoReadingEnabled?: boolean;
  /** 自动阅读滚动速度，单位为像素/秒。 */
  autoReadingSpeed?: number;
  /** 是否在“续写”右侧显示快捷输入面板按钮。 */
  quickInputEnabled?: boolean;
  /** 快捷输入面板的选项列表，点按即插入到输入框光标处。 */
  quickInputOptions?: string[];
  /** 点按选项插入后，光标落在插入内容的左边/中间/右边。 */
  quickInputCursor?: "left" | "middle" | "right";
};

/** 快捷输入面板默认选项：成对引号 + 常用标点。 */
export const STORY_DEFAULT_QUICK_INPUT_OPTIONS = ["“”", "「」", "，", "？", "……"];

export type StoryTailScheme = {
  id: string;
  name: string;
  /** 写入生成提示词的输出格式/契约。 */
  prompt: string;
  /** 在沙盒 iframe 中运行的 HTML/CSS/JS 渲染模板。 */
  renderHtml?: string;
  /** 传给渲染模板的可编辑预览原文。 */
  preview: string;
};

// ── 剧情尾部内置方案（剧情设置页与小卷工具共用）──────────
// 渲染画布在沙盒 iframe 里运行，AI 输出原文经 window.STORY_RAW / {{RAW}} 注入。

export const STORY_DEFAULT_STATUS_RENDER = `<style>
:root{--bg:#fff;--text:#334155;--sub:#94a3b8;--line:#e2e8f0}
@media(prefers-color-scheme:dark){:root{--bg:#1c1c1e;--text:#e5e7eb;--sub:#94a3b8;--line:#334155}}
*{box-sizing:border-box}body{margin:0;background:transparent;color:var(--text);font:13px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
.status{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:2px}
.item{min-width:0;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--bg)}
.key{display:block;color:var(--sub);font-size:10px;margin-bottom:2px}.value{display:block;overflow-wrap:anywhere;white-space:pre-wrap}
</style>
<div id="status" class="status"></div>
<script>
const root=document.getElementById('status');
const rows=(window.STORY_RAW||'').split(/\\n+/).flatMap(line=>line.split(/\\s{2,}/)).map(v=>v.trim()).filter(Boolean);
for(const row of rows){const parts=row.split(/[｜|：:]/);const item=document.createElement('div');item.className='item';const key=document.createElement('span');key.className='key';key.textContent=parts.length>1?parts.shift().trim():'状态';const value=document.createElement('span');value.className='value';value.textContent=parts.join('｜').trim()||row;item.append(key,value);root.append(item)}
</script>`;

export const STORY_DEFAULT_THEATER_RENDER = `<style>
:root{--paper:#fffdf8;--text:#4b5563;--sub:#9a8f80;--line:#eadfce}
@media(prefers-color-scheme:dark){:root{--paper:#24211d;--text:#e7e1d8;--sub:#a89f94;--line:#4a433a}}
*{box-sizing:border-box}body{margin:0;background:transparent;color:var(--text);font:13px/1.8 Georgia,"Songti SC",serif}
.theater{position:relative;padding:16px 17px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}
.title{margin-bottom:7px;color:var(--sub);font:10px/1.2 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;letter-spacing:.22em}.text{white-space:pre-wrap;overflow-wrap:anywhere}
</style>
<section class="theater"><div class="title">小剧场</div><div id="text" class="text"></div></section>
<script>document.getElementById('text').textContent=window.STORY_RAW||''</script>`;

export const STORY_DEFAULT_STATUS_SCHEME: StoryTailScheme = {
  id: "status-default",
  name: "关系温度卡",
  prompt: "在正文末尾输出 <story_status>，简洁记录当前时间、地点、关系温度和双方状态；内容会进入下一轮上下文。",
  renderHtml: STORY_DEFAULT_STATUS_RENDER,
  preview: "时间｜夜晚  地点｜窗边\n关系温度｜72%  状态｜靠近",
};

export const STORY_DEFAULT_STATUS_HTML_SCHEME: StoryTailScheme = {
  id: "status-html",
  name: "自定义 HTML 状态栏",
  prompt: "在正文末尾输出 <story_status>，依次记录时间、地点、关系与双方状态；只输出结构化纯文本，不要自行输出 HTML。内容会进入下一轮上下文。",
  renderHtml: STORY_DEFAULT_STATUS_RENDER,
  preview: "时间｜夜晚  地点｜窗边\n关系｜逐渐靠近  状态｜安静相伴",
};

export const STORY_DEFAULT_THEATER_SCHEME: StoryTailScheme = {
  id: "theater-default",
  name: "片尾彩蛋",
  prompt: "在正文末尾输出 <story_theater>，写一段不影响主线的短小片尾彩蛋；默认仅展示，不进入下一轮上下文。",
  renderHtml: STORY_DEFAULT_THEATER_RENDER,
  preview: "片尾彩蛋｜如果那一刻被拍成照片，大概会被珍藏很久。",
};

export const STORY_DEFAULT_FURRY_THEATER_SCHEME: StoryTailScheme = {
  id: "theater-furry",
  name: "毛茸茸派对小剧场",
  prompt: "在正文末尾输出 <story_theater>，写一段“毛茸茸派对”小剧场：假设角色和用户都是某一种毛茸茸的动物，基于刚刚发生的剧情，描写一段他们以动物形态互动的小故事；默认仅展示，不进入下一轮上下文。",
  renderHtml: STORY_DEFAULT_THEATER_RENDER,
  preview: "毛茸茸派对｜大尾巴扫了扫你的鼻尖，你们依偎在阳光下打着呼噜。",
};

/** 读取某剧情会话设置里的尾部方案；从未配置过时返回内置默认方案（与设置页一致）。 */
export function loadStoryTailSchemes(settings: StoryCharacterSettings | undefined): {
  statusSchemes: StoryTailScheme[];
  theaterSchemes: StoryTailScheme[];
} {
  return {
    statusSchemes: settings?.statusSchemes?.length ? settings.statusSchemes : [STORY_DEFAULT_STATUS_SCHEME, STORY_DEFAULT_STATUS_HTML_SCHEME],
    theaterSchemes: settings?.theaterSchemes?.length ? settings.theaterSchemes : [STORY_DEFAULT_THEATER_SCHEME, STORY_DEFAULT_FURRY_THEATER_SCHEME],
  };
}

/** 剧情正文文风方案：只约束 AI 的写作方式，不定义任何尾部输出结构。 */
export type StoryProseStyleScheme = {
  id: string;
  name: string;
  prompt: string;
};

export type StoryPromptEntry = {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
};

export type StoryCharacterSettings = {
  presetName?: string;
  extraPrompt?: string;
  customPromptEntries?: StoryPromptEntry[];
  enabledPresetPromptIds?: string[];
  minChars?: number;
  maxChars?: number;
  userPerspective?: "second" | "third" | "username";
  proseStyle?: string;
  proseStylePrompt?: string;
  proseStyleSchemes?: StoryProseStyleScheme[];
  activeProseStyleSchemeId?: string;
  statusSchemes?: StoryTailScheme[];
  activeStatusSchemeId?: string;
  theaterSchemes?: StoryTailScheme[];
  activeTheaterSchemeId?: string;
  floatingPhoneEnabled?: boolean;
  floatingPhoneInContext?: boolean;
};

export type StorySession = {
  id: string;
  characterId: string;
  title?: string;
  updatedAt: string;
  customCSS?: string;
  foldTags?: string;            // Comma-separated tag names to fold for this session.
  contextExcludedTags?: string; // Comma-separated tag names stripped before sending story history to the LLM.
  uiPrefs?: StoryUiPrefs;
  /** 剧情 APP 专属设置；每个角色的唯一会话各自独立保存。 */
  settings?: StoryCharacterSettings;
  lastMessageId?: string;
  lastMessagePreview?: string;
};

export type StoryMessageRole = "user" | "assistant" | "system";

export type StoryMessage = {
  id: string;
  sessionId: string;
  role: StoryMessageRole;
  rawContent: string;
  renderedContent?: string;
  storySummary?: string;
  regexSignature?: string;
  parserVersion?: number;
  createdAt: string;
};

export type StoryProjectionEntry = {
  id: string;
  timestamp: string;
  content: string;
};

class StoryDatabase extends Dexie {
  sessions!: Dexie.Table<StorySession, string>;
  messages!: Dexie.Table<StoryMessage, string>;

  constructor() {
    super("AiPhoneStoryDB");
    this.version(1).stores({
      sessions: "id, characterId, updatedAt",
      messages: "id, sessionId, createdAt",
    });
  }
}

const storyDb = new StoryDatabase();

let _hydrated = false;
let _sessionsCache: StorySession[] = [];
let _messagesCache: StoryMessage[] = [];

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseTime(value: string | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getStorySessionActivityTime(session: StorySession): number {
  const lastMessageTime = _messagesCache
    .filter((message) => message.sessionId === session.id)
    .reduce((latest, message) => Math.max(latest, parseTime(message.createdAt)), 0);
  return Math.max(lastMessageTime, parseTime(session.updatedAt));
}

function isPreferredStorySession(candidate: StorySession, current: StorySession): boolean {
  const candidateTime = getStorySessionActivityTime(candidate);
  const currentTime = getStorySessionActivityTime(current);
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  const candidateUpdated = parseTime(candidate.updatedAt);
  const currentUpdated = parseTime(current.updatedAt);
  if (candidateUpdated !== currentUpdated) return candidateUpdated > currentUpdated;
  return candidate.id.localeCompare(current.id) > 0;
}

function normalizeStorySessions(sessions: StorySession[]): { items: StorySession[]; changed: boolean } {
  const normalized: StorySession[] = [];
  const indexByCharacter = new Map<string, number>();
  let changed = false;

  for (const session of sessions) {
    const id = session.id?.trim();
    const characterId = session.characterId?.trim();
    if (!id || !characterId) {
      changed = true;
      continue;
    }
    const item = id === session.id && characterId === session.characterId
      ? session
      : { ...session, id, characterId };
    const existingIndex = indexByCharacter.get(characterId);
    if (existingIndex === undefined) {
      indexByCharacter.set(characterId, normalized.length);
      normalized.push(item);
      if (item !== session) changed = true;
      continue;
    }

    changed = true;
    if (isPreferredStorySession(item, normalized[existingIndex])) {
      normalized[existingIndex] = item;
    }
  }

  return { items: normalized, changed };
}

function persistStorySessionsSnapshot(sessions: StorySession[]): void {
  storyDb.transaction("rw", storyDb.sessions, async () => {
    await storyDb.sessions.clear();
    await storyDb.sessions.bulkPut(sessions);
  }).catch(() => undefined);
}

export async function hydrateStoryStorage(): Promise<void> {
  if (_hydrated || typeof window === "undefined") return;
  const [sessions, messages] = await Promise.all([
    storyDb.sessions.toArray().catch(() => []),
    storyDb.messages.toArray().catch(() => []),
  ]);
  _messagesCache = messages;
  const normalized = normalizeStorySessions(sessions);
  _sessionsCache = normalized.items;
  if (normalized.changed) persistStorySessionsSnapshot(normalized.items);
  _hydrated = true;
}

export function loadStorySessions(): StorySession[] {
  const normalized = normalizeStorySessions(_sessionsCache);
  if (normalized.changed) _sessionsCache = normalized.items;
  // 空值安全：旧版本/异常导入的数据可能缺 updatedAt，排序不能让页面崩溃
  return [..._sessionsCache].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function loadStoryMessages(sessionId: string): StoryMessage[] {
  return _messagesCache
    .filter((message) => message.sessionId === sessionId)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

export function createOrGetStorySession(characterId: string): StorySession {
  const normalized = normalizeStorySessions(_sessionsCache);
  if (normalized.changed) {
    _sessionsCache = normalized.items;
    persistStorySessionsSnapshot(normalized.items);
  }
  const existing = _sessionsCache.find((session) => session.characterId === characterId);
  if (existing) return existing;

  const session: StorySession = {
    id: generateId("story_sess"),
    characterId,
    updatedAt: getNow().toISOString(),
    foldTags: "think,thinking,story_status,story_theater",
    contextExcludedTags: "think,thinking,story_theater",
    uiPrefs: {},
  };
  _sessionsCache.unshift(session);
  storyDb.sessions.put(session).catch(() => undefined);
  return session;
}

export function updateStorySession(sessionId: string, updates: Partial<StorySession>): StorySession | null {
  const idx = _sessionsCache.findIndex((session) => session.id === sessionId);
  if (idx === -1) return null;
  const next: StorySession = {
    ..._sessionsCache[idx],
    ...updates,
    uiPrefs: { ..._sessionsCache[idx].uiPrefs, ...updates.uiPrefs },
    updatedAt: updates.updatedAt || getNow().toISOString(),
  };
  _sessionsCache[idx] = next;
  storyDb.sessions.put(next).catch(() => undefined);
  return next;
}

export function pushStoryMessage(
  input: Omit<StoryMessage, "id" | "createdAt">
): StoryMessage {
  const message: StoryMessage = {
    ...input,
    id: generateId("story_msg"),
    createdAt: getNow().toISOString(),
  };
  _messagesCache.push(message);
  storyDb.messages.put(message).catch(() => undefined);

  const previewSource = message.renderedContent || message.rawContent;
  const preview = previewSource.replace(/\s+/g, " ").trim().slice(0, 64);
  updateStorySession(message.sessionId, {
    lastMessageId: message.id,
    lastMessagePreview: preview,
    updatedAt: message.createdAt,
  });

  return message;
}

/** Delete a single story message */
export function deleteStoryMessage(messageId: string): void {
    _messagesCache = _messagesCache.filter(m => m.id !== messageId);
    storyDb.messages.delete(messageId).catch(() => undefined);
}

/** Delete a message and all messages after it (by createdAt in same session) */
export function deleteStoryMessagesFrom(sessionId: string, messageId: string): void {
    const msg = _messagesCache.find(m => m.id === messageId);
    if (!msg) return;
    const idsToDelete = _messagesCache
        .filter(m => m.sessionId === sessionId && m.createdAt >= msg.createdAt)
        .map(m => m.id);
    _messagesCache = _messagesCache.filter(m => !idsToDelete.includes(m.id));
    storyDb.messages.bulkDelete(idsToDelete).catch(() => undefined);
}

/** Edit a story message's rawContent (renderedContent will be rebuilt by cache invalidation) */
export function editStoryMessage(messageId: string, newRawContent: string): void {
    const idx = _messagesCache.findIndex(m => m.id === messageId);
    if (idx === -1) return;
    _messagesCache[idx] = {
        ..._messagesCache[idx],
        rawContent: newRawContent,
        renderedContent: undefined,
        regexSignature: undefined,
        parserVersion: undefined,
    };
    storyDb.messages.put(_messagesCache[idx]).catch(() => undefined);
}

export function replaceStoryMessages(sessionId: string, messages: StoryMessage[]): void {
  _messagesCache = _messagesCache.filter((message) => message.sessionId !== sessionId);
  _messagesCache.push(...messages);
  storyDb.messages.where("sessionId").equals(sessionId).delete()
    .then(() => storyDb.messages.bulkPut(messages))
    .catch(() => undefined);
}

function compactProjectionText(text: string, maxLen = 160): string {
  const plain = text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  return plain.length > maxLen ? `${plain.slice(0, maxLen)}...` : plain;
}

export function loadStoryProjectionEntries(
  characterId: string,
  options?: { afterTimestamp?: string; userName?: string; charName?: string }
): StoryProjectionEntry[] {
  const session = _sessionsCache.find((item) => item.characterId === characterId);
  if (!session) return [];
  const messages = loadStoryMessages(session.id);
  const projections: StoryProjectionEntry[] = [];

  for (let i = 0; i < messages.length; i++) {
    const current = messages[i];
    if (current.role !== "assistant") continue;
    if (options?.afterTimestamp && current.createdAt <= options.afterTimestamp) continue;

    if (!current.storySummary) continue;
    const summaryText = compactProjectionText(current.storySummary, 500);
    if (!summaryText) continue;

    const ts = formatChatTimestamp(current.createdAt);
    projections.push({
      id: `story_projection_${current.id}`,
      timestamp: current.createdAt,
      content: `[事件 ${ts}] ${summaryText}`,
    });
  }

  return projections;
}
