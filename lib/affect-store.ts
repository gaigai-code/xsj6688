// lib/affect-store.ts
// 通用情绪状态 store：按 ownerId 隔离，一份代码服务 mascot + 所有角色卡。
//
//   - mascot（小卷）用固定 ownerId "mascot"
//   - 角色卡用 character.id（char_xxx）
//   - 持久化到单个 kv key ai_phone_affect_v1，存 Record<ownerId, AffectState>
//   - 惰性 catch-up：读情绪前调 advanceAffectTo(getNowMs())，不跑后台定时器
//   - 时间统一用 getNowMs()（虚拟时间真相源）

import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { getNowMs } from "./virtual-time";
import { loadCharacters } from "./character-storage";
import { recordAffectHistory, describeAffectEvent } from "./affect-history";
import { recordSampleIfDue, recordSamplesDuringCatchUp, resetAffectSamples } from "./affect-samples";
import {
  AFFECT_DIMS,
  advance,
  applyAutoSleep,
  buildDisplay,
  createInitialAffectState,
  ingestEvent,
  type AffectDim,
  type AffectEvent,
  type AffectLabel,
  type AffectState,
  type DimLevels,
  type SleepStatus,
} from "./affect-model";

export const AFFECT_KEY = "ai_phone_affect_v1";
export const MASCOT_OWNER_ID = "mascot";
export const AFFECT_UPDATED_EVENT = "affect-updated";

/** 睡眠窗口（默认 23:30 – 07:00），小数小时。后续可做成角色级配置。 */
export const DEFAULT_SLEEP_WINDOW = { startHour: 23.5, endHour: 7 };

registerKvMigration(AFFECT_KEY);

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedStates: Record<string, AffectState> = {};

// ── 归一化（反序列化 + 字段回填，schema 演进安全）──────────────────────────

function normalizeState(raw: unknown, nowMs: number): AffectState | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Partial<AffectState>;
  const state = createInitialAffectState(nowMs);

  // base / mood：回填缺失维度（缺的补 neutral）
  if (src.base && typeof src.base === "object") {
    for (const k of AFFECT_DIMS) {
      const v = (src.base as Partial<DimLevels>)[k];
      if (typeof v === "number" && Number.isFinite(v)) state.base[k] = Math.min(Math.max(v, 0), 1);
    }
  }
  if (src.mood && typeof src.mood === "object") {
    for (const k of AFFECT_DIMS) {
      const v = (src.mood as Partial<DimLevels>)[k];
      if (typeof v === "number" && Number.isFinite(v)) state.mood[k] = Math.min(Math.max(v, 0), 1);
    }
  }

  if (typeof src.snapshotAtMs === "number") state.snapshotAtMs = src.snapshotAtMs;
  if (typeof src.lastInteractionAtMs === "number") state.lastInteractionAtMs = src.lastInteractionAtMs;
  if (typeof src.lastTimeAccumulatedAtMs === "number") state.lastTimeAccumulatedAtMs = src.lastTimeAccumulatedAtMs;

  if (src.unansweredThread && typeof src.unansweredThread === "object") {
    state.unansweredThread = {
      sentAtMs: typeof src.unansweredThread.sentAtMs === "number" ? src.unansweredThread.sentAtMs : nowMs,
      stakes: src.unansweredThread.stakes === "high" ? "high" : "normal",
      milestonesApplied: Array.isArray(src.unansweredThread.milestonesApplied)
        ? src.unansweredThread.milestonesApplied.filter((m): m is string => typeof m === "string")
        : [],
    };
  }
  if (Array.isArray(src.processedCalendarIds)) {
    state.processedCalendarIds = src.processedCalendarIds.filter((id): id is string => typeof id === "string");
  }
  if (Array.isArray(src.recentLabels)) {
    state.recentLabels = src.recentLabels
      .filter(e => e && typeof e === "object" && typeof (e as { label?: unknown }).label === "string" && typeof (e as { atMs?: unknown }).atMs === "number")
      .map(e => ({ label: (e as { label: AffectState["recentLabels"][number]["label"] }).label, atMs: (e as { atMs: number }).atMs }));
  }

  if (src.sleep && typeof src.sleep === "object") {
    const s = src.sleep;
    if (typeof s.status === "string" && ["awake", "asleep", "interrupted"].includes(s.status)) state.sleep.status = s.status as SleepStatus;
    if (typeof s.lastSleepDurationHours === "number") state.sleep.lastSleepDurationHours = s.lastSleepDurationHours;
    if (typeof s.lastSleepStartedAtMs === "number") state.sleep.lastSleepStartedAtMs = s.lastSleepStartedAtMs;
    if (typeof s.lastWakeAtMs === "number") state.sleep.lastWakeAtMs = s.lastWakeAtMs;
    if (typeof s.accumulatedSleepHours === "number") state.sleep.accumulatedSleepHours = s.accumulatedSleepHours;
    if (typeof s.lastInterruptedAtMs === "number") state.sleep.lastInterruptedAtMs = s.lastInterruptedAtMs;
    if (typeof s.interruptFatigueBonus === "number") state.sleep.interruptFatigueBonus = s.interruptFatigueBonus;
    if (typeof s.baseAtSleep === "number") state.sleep.baseAtSleep = s.baseAtSleep;
    if (typeof s.estimated === "boolean") state.sleep.estimated = s.estimated;
  }

  if (typeof src.lastIntimacyAtMs === "number") state.lastIntimacyAtMs = src.lastIntimacyAtMs;
  if (typeof src.frustration === "number") state.frustration = Math.max(0, Math.min(src.frustration, 3));
  if (typeof src.rejectionStreak === "number") state.rejectionStreak = Math.max(0, src.rejectionStreak);
  if (typeof src.frustrationPeakAtMs === "number") state.frustrationPeakAtMs = src.frustrationPeakAtMs;
  if (Array.isArray(src.lustIntentionPending)) {
    state.lustIntentionPending = src.lustIntentionPending
      .filter(i => i && typeof i === "object" && typeof (i as { id?: unknown }).id === "string")
      .map(i => ({
        id: (i as { id: string }).id,
        createdAtMs: typeof (i as { createdAtMs?: unknown }).createdAtMs === "number" ? (i as { createdAtMs: number }).createdAtMs : nowMs,
        expiresAtMs: typeof (i as { expiresAtMs?: unknown }).expiresAtMs === "number" ? (i as { expiresAtMs: number }).expiresAtMs : nowMs,
      }));
  }
  if (typeof src.lustIntentionLastRollAtMs === "number") state.lustIntentionLastRollAtMs = src.lustIntentionLastRollAtMs;
  if (typeof src.lastIntentionAddedAtMs === "number") state.lastIntentionAddedAtMs = src.lastIntentionAddedAtMs;

  if (src.neutralOverrides && typeof src.neutralOverrides === "object") {
    const overrides: Partial<Record<AffectDim, number>> = {};
    for (const k of AFFECT_DIMS) {
      const v = (src.neutralOverrides as Partial<Record<AffectDim, number>>)[k];
      if (typeof v === "number" && Number.isFinite(v)) overrides[k] = Math.min(Math.max(v, 0), 1);
    }
    if (Object.keys(overrides).length > 0) state.neutralOverrides = overrides;
  }

  return state;
}

// ── 加载 / 持久化 ────────────────────────────────────────────────────────────

function loadAll(): Record<string, AffectState> {
  if (typeof window === "undefined") return cachedStates;
  const raw = kvGet(AFFECT_KEY);
  if (raw === cachedRaw) return cachedStates;
  cachedRaw = raw;
  if (!raw) {
    cachedStates = {};
    return cachedStates;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const states: Record<string, AffectState> = {};
    if (parsed && typeof parsed === "object") {
      const nowMs = getNowMs();
      for (const [id, st] of Object.entries(parsed as Record<string, unknown>)) {
        const normalized = normalizeState(st, nowMs);
        if (normalized) states[id] = normalized;
      }
    }
    cachedStates = states;
  } catch {
    cachedStates = {};
  }
  return cachedStates;
}

function persist(): void {
  cachedRaw = JSON.stringify(cachedStates);
  if (typeof window !== "undefined") {
    kvSet(AFFECT_KEY, cachedRaw);
    window.dispatchEvent(new CustomEvent(AFFECT_UPDATED_EVENT));
  }
  for (const listener of listeners) listener();
}

function ensureState(ownerId: string): AffectState {
  const all = loadAll();
  if (!all[ownerId]) {
    all[ownerId] = createInitialAffectState(getNowMs(), inferOverridesForOwner(ownerId));
    cachedStates = all;
    persist();
  }
  return all[ownerId];
}

/** 惰性推进：decay + 时间累积 + 睡眠窗口自动切换，推进到当前虚拟时间。
 *  推进前先沿采样网格补记闲置期曲线（recordSamplesDuringCatchUp 会把 snapshotAtMs 逐步推到 now）。 */
function advanceOwner(ownerId: string, state: AffectState): void {
  const nowMs = getNowMs();
  recordSamplesDuringCatchUp(ownerId, state, nowMs, DEFAULT_SLEEP_WINDOW);
  advance(state, nowMs);
  applyAutoSleep(state, nowMs, DEFAULT_SLEEP_WINDOW);
  if (!state.display) state.display = buildDisplay(state, nowMs);
}

// ── 对外 API ─────────────────────────────────────────────────────────────────

export function getAffectDisplay(ownerId: string): DimLevels {
  const state = ensureState(ownerId);
  advanceOwner(ownerId, state);
  const display = { ...state.display! };
  // 定时采样：到点自动补记（幂等）
  recordSampleIfDue(ownerId, display, getNowMs());
  return display;
}

export type AffectMeta = {
  mood: DimLevels;
  sleepStatus: SleepStatus;
  sleepDurationHours: number;
  frustration: number;
  pendingIntentionCount: number;
  rejectionStreak: number;
};

export function getAffectMeta(ownerId: string): AffectMeta {
  const state = ensureState(ownerId);
  advanceOwner(ownerId, state);
  if (state.display) recordSampleIfDue(ownerId, state.display, getNowMs());
  return {
    mood: { ...state.mood },
    sleepStatus: state.sleep.status,
    sleepDurationHours: state.sleep.lastSleepDurationHours,
    frustration: state.frustration,
    pendingIntentionCount: state.lustIntentionPending.length,
    rejectionStreak: state.rejectionStreak,
  };
}

export function ingestAffectEvent(ownerId: string, ev: AffectEvent): void {
  const state = ensureState(ownerId);
  advanceOwner(ownerId, state);
  const nowMs = getNowMs();
  ingestEvent(state, ev, nowMs);
  const display = buildDisplay(state, nowMs);
  state.display = display;
  // 写路径兜底：事件后也到点补记当前点（聊天中不读面板也有曲线）
  recordSampleIfDue(ownerId, display, nowMs);
  const kind = ev.type;
  const label = ev.type === "msg_user" ? ev.label : undefined;
  const calendarType = ev.type === "calendar" ? ev.calendarType : undefined;
  recordAffectHistory(ownerId, {
    atMs: nowMs,
    kind,
    text: describeAffectEvent(kind, label, calendarType),
    display: { ...display },
    frustration: state.frustration,
  });
  persist();
}

/** 清除某个角色的情绪（角色被删除时调用）。 */
export function resetAffect(ownerId: string): void {
  const all = loadAll();
  if (all[ownerId]) {
    delete all[ownerId];
    cachedStates = all;
    persist();
  }
  resetAffectSamples(ownerId);
}

export function subscribeAffect(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── 性格底子定制（neutral 覆盖）──────────────────────────────────────────────

const PERSONA_NEUTRAL_RULES: { dim: AffectDim; patterns: RegExp[]; neutral: number }[] = [
  { dim: "anxiety", patterns: [/焦虑/, /敏感/, /不安/, /缺乏安全感/, /患得患失/, /anxious/i], neutral: 0.35 },
  { dim: "contentment", patterns: [/乐观/, /知足/, /佛系/, /安定/, /平和/, /calm/i], neutral: 0.50 },
  { dim: "elation", patterns: [/开朗/, /活泼/, /元气/, /energetic/i], neutral: 0.35 },
  { dim: "longing", patterns: [/粘人/, /黏人/, /依赖/, /怕孤独/, /needy/i], neutral: 0.45 },
  { dim: "possessiveness", patterns: [/占有欲/, /强势/, /霸道/, /possessive/i], neutral: 0.45 },
  { dim: "intimacy", patterns: [/高冷/, /慢热/, /疏离/, /冷淡/, /cold/i], neutral: 0.18 },
  { dim: "play", patterns: [/调皮/, /爱玩/, /幽默/, /风趣/, /playful/i], neutral: 0.40 },
  { dim: "protectiveness", patterns: [/保护欲/, /照顾/, /护短/, /protective/i], neutral: 0.40 },
  { dim: "dejection", patterns: [/悲观/, /抑郁/, /丧/, /消沉/, /depressed/i], neutral: 0.30 },
  { dim: "irritability", patterns: [/暴躁/, /易怒/, /暴脾气/, /irritable/i], neutral: 0.30 },
];

/** 从角色设定文本（personality + persona）推断性情锚点覆盖。 */
export function inferNeutralOverridesFromPersona(text: string): Partial<Record<AffectDim, number>> {
  const overrides: Partial<Record<AffectDim, number>> = {};
  if (!text) return overrides;
  for (const rule of PERSONA_NEUTRAL_RULES) {
    if (rule.patterns.some(p => p.test(text))) {
      overrides[rule.dim] = rule.neutral;
    }
  }
  return overrides;
}

function inferOverridesForOwner(ownerId: string): Partial<Record<AffectDim, number>> | undefined {
  if (ownerId === MASCOT_OWNER_ID || !ownerId.startsWith("char_")) return undefined;
  try {
    const char = loadCharacters().find(c => c.id === ownerId);
    if (!char) return undefined;
    const overrides = inferNeutralOverridesFromPersona(`${char.personality || ""}\n${char.persona || ""}`);
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  } catch {
    return undefined;
  }
}

/** 手动设置某角色的性情锚点覆盖（可选；角色卡首次创建时已自动推断）。 */
export function setAffectNeutralOverrides(ownerId: string, overrides: Partial<Record<AffectDim, number>>): void {
  const state = ensureState(ownerId);
  const cleaned: Partial<Record<AffectDim, number>> = {};
  for (const k of AFFECT_DIMS) {
    const v = overrides[k];
    if (typeof v === "number" && Number.isFinite(v)) cleaned[k] = Math.min(Math.max(v, 0), 1);
  }
  state.neutralOverrides = Object.keys(cleaned).length > 0 ? cleaned : undefined;
  persist();
}

// ── 亲密意图联动（挫败）───────────────────────────────────────────────────────

const REJECT_HARD_LABELS = new Set<AffectLabel>(["hostile"]);
const REJECT_SOFT_LABELS = new Set<AffectLabel>(["cold", "distant"]);

/**
 * 摄入一条用户消息，并联动亲密意图：
 * 角色有 pending 亲密意图（lust 高时自动生成）时，用户拒绝类消息触发挫败。
 */
export function ingestUserMessage(ownerId: string, label: AffectLabel, confidence: number): void {
  ingestAffectEvent(ownerId, { type: "msg_user", label, confidence });
  const meta = getAffectMeta(ownerId);
  if (meta.pendingIntentionCount > 0) {
    if (REJECT_HARD_LABELS.has(label)) {
      ingestAffectEvent(ownerId, { type: "lust_rejection_hard" });
    } else if (REJECT_SOFT_LABELS.has(label)) {
      ingestAffectEvent(ownerId, { type: "lust_rejection_soft" });
    }
  }
}
