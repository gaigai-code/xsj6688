// lib/affect-model.ts
// 情绪动力学纯函数核心 —— 移植自 Drivesoid（https://github.com/Jiangtingyue/Drivesoid）。
//
// 设计原则：
//   - 纯函数 + 零 IO + 零副作用：所有时间由调用方以 `nowMs`（getNowMs()，即虚拟时间）传入，
//     文件读写 / 定时器 / LLM 分类全部由上层（affect-store / affect-classifier）负责。
//   - 惰性 catch-up：不跑后台 worker，读情绪前由 store 调 `advance(state, nowMs)` 一次性推进。
//   - 三层结构：base（快情绪，小时级衰减）→ mood（慢心境，天级）→ neutral（性情锚点）。
//
// 与 Drivesoid 的差异（v1 简化，均已在原位注释）：
//   - 去掉 last_segment / fear_label_applied 上限：fear 靠 tau=7h 衰减自然限制。
//   - localHour 用 Date(nowMs).getHours()（虚拟时间已是本地时刻）；角色时区暂未接入昼夜节律。

// ── 维度类型 ──────────────────────────────────────────────────────────────────

export type AffectDim =
  | "vitality" | "longing" | "intimacy" | "possessiveness" | "lust"
  | "jealousy" | "anxiety" | "protectiveness" | "contentment" | "elation"
  | "seeking" | "play" | "dejection" | "irritability" | "fear";

export type AffectLabel =
  | "affectionate" | "playful" | "vulnerable" | "reassuring"
  | "cold" | "conflict" | "distant" | "struggling"
  | "intimate_reference" | "intimate_event" | "neutral" | "hostile"
  | "fear_separation" | "fear_death" | "fear_concern" | "fear_general";

export type DimLevels = Record<AffectDim, number>;

export const AFFECT_DIMS: AffectDim[] = [
  "vitality", "longing", "intimacy", "possessiveness", "lust",
  "jealousy", "anxiety", "protectiveness", "contentment", "elation",
  "seeking", "play", "dejection", "irritability", "fear",
];

// ── 维度参数（DIMS / DIM_FLOOR，对照 Drivesoid src/worker.js:20-43）───────────

type DimParams = {
  neutral: number;   // 性情锚点
  tau: number;       // base 衰减时间常数（小时）
  peak: number;      // 昼夜节律峰（本地小时）；amp=0 表示无节律
  amp: number;
  width: number;
};

export const DIMS: Record<AffectDim, DimParams> = {
  vitality:       { neutral: 0.50, tau: 6,  peak: 10, amp: 1.0, width: 10 },
  longing:        { neutral: 0.30, tau: 6,  peak: 22, amp: 0.9, width: 6 },
  intimacy:       { neutral: 0.35, tau: 10, peak: 23, amp: 0.7, width: 9 },
  possessiveness: { neutral: 0.30, tau: 4,  peak: 21, amp: 0.6, width: 5 },
  lust:           { neutral: 0.30, tau: 4,  peak: 23, amp: 0.8, width: 6 },
  jealousy:       { neutral: 0.22, tau: 2,  peak: 0,  amp: 0,   width: 1 },
  anxiety:        { neutral: 0.20, tau: 5,  peak: 0,  amp: 0,   width: 1 },
  protectiveness: { neutral: 0.25, tau: 4,  peak: 0,  amp: 0,   width: 1 },
  contentment:    { neutral: 0.35, tau: 8,  peak: 14, amp: 0.5, width: 9 },
  elation:        { neutral: 0.20, tau: 3,  peak: 19, amp: 0.7, width: 3.5 },
  seeking:        { neutral: 0.25, tau: 4,  peak: 14, amp: 0.8, width: 5 },
  play:           { neutral: 0.25, tau: 3,  peak: 19, amp: 0.7, width: 3.5 },
  dejection:      { neutral: 0.15, tau: 8,  peak: 8,  amp: 0.5, width: 4 },
  irritability:   { neutral: 0.15, tau: 3,  peak: 16, amp: 0.6, width: 3.5 },
  fear:           { neutral: 0,    tau: 7,  peak: 0,  amp: 0,   width: 1 },
};

export const DIM_FLOOR: Record<AffectDim, number> = {
  vitality: 0.08, longing: 0.15, intimacy: 0.06, possessiveness: 0.05, lust: 0.05,
  jealousy: 0,    anxiety: 0.02, protectiveness: 0.05,
  contentment: 0.06, elation: 0.02, seeking: 0.12, play: 0.03,
  dejection: 0,   irritability: 0, fear: 0,
};

const NEG_DIMS = new Set<AffectDim>(["dejection", "irritability", "anxiety", "fear"]);

const FATIGUE_C = { peak: 3, amp: 0.8, width: 10 };
const CIRCADIAN_CAP = 0.08;

// ── 标签 → 维度增量（LABEL_DELTAS，对照 src/worker.js:60-77）───────────────────

type DimDelta = Partial<Record<AffectDim, number>>;

export const LABEL_DELTAS: Record<AffectLabel, DimDelta> = {
  affectionate:       { intimacy: +0.20, contentment: +0.15, anxiety: -0.18, lust: +0.12, longing: -0.10, fear: -0.08 },
  playful:            { play: +0.20, elation: +0.18, contentment: +0.12, seeking: +0.10, irritability: -0.10, lust: +0.10 },
  vulnerable:         { intimacy: +0.25, protectiveness: +0.20, anxiety: +0.12, dejection: +0.08 },
  reassuring:         { anxiety: -0.25, jealousy: -0.20, contentment: +0.15, intimacy: +0.15, fear: -0.15 },
  cold:               { anxiety: +0.15, dejection: +0.12, longing: +0.10, intimacy: -0.10 },
  conflict:           { anxiety: +0.20, irritability: +0.15, dejection: +0.15, possessiveness: +0.18, lust: +0.10, intimacy: -0.15, contentment: -0.15 },
  distant:            { anxiety: +0.12, dejection: +0.10, longing: +0.12, intimacy: -0.08 },
  struggling:         { protectiveness: +0.30, anxiety: +0.12, dejection: +0.12, contentment: -0.08 },
  intimate_reference: { lust: +0.18, intimacy: +0.10 },
  intimate_event:     { lust: +0.25, intimacy: +0.18 },
  neutral:            { anxiety: -0.05, longing: -0.04, contentment: +0.03 },
  hostile:            { dejection: +0.22, anxiety: +0.18, irritability: +0.12, intimacy: -0.22, contentment: -0.18 },
  fear_separation:    { fear: +0.20, longing: +0.15, possessiveness: +0.12, anxiety: +0.15, protectiveness: +0.10, dejection: +0.10, irritability: +0.08 },
  fear_death:         { fear: +0.35, anxiety: +0.30, irritability: +0.20, contentment: -0.12, play: -0.15, elation: -0.10 },
  fear_concern:       { fear: +0.28, longing: +0.12, possessiveness: +0.15, anxiety: +0.20, protectiveness: +0.25, contentment: -0.10 },
  fear_general:       { fear: +0.20, anxiety: +0.10 },
};

// ── 结构效应（对照 src/worker.js:82-86）────────────────────────────────────────

const MSG_CONTACT: DimDelta = { longing: -0.06, seeking: -0.04 };
const MSG_SOOTHE: DimDelta = { dejection: -0.08, contentment: +0.03, anxiety: -0.025, irritability: -0.020 };
const MSG_ANXIETY_COMP = -0.075;
const MSG_IRRIT_COMP = -0.060;
const SOOTHING_LABELS = new Set<AffectLabel>(["affectionate", "playful", "reassuring"]);

// ── 习惯化 & 语境效价（对照 src/worker.js:92-108）─────────────────────────────

const RECENT_LABEL_WINDOW_MS = 15 * 60_000;
const RECENT_LABEL_KEEP = 8;
const HABITUATION_FACTOR = 0.7;
const NEG_CTX_LABELS = new Set<AffectLabel>([
  "cold", "conflict", "distant", "hostile", "struggling",
  "fear_separation", "fear_death", "fear_concern", "fear_general",
]);

// ── mood 三值链（对照 src/worker.js:115-120）──────────────────────────────────

const MOOD_FOLLOW_TAU_H = 12;
const MOOD_RETURN_TAU_H = 72;
const MOOD_SLEEP_RETURN_MULT = 3;
const MOOD_CONSOLIDATION_GAIN = 4;
const MOOD_CONSOLIDATION_MIN = 0.25;
const MOOD_CONSOLIDATION_MAX = 2.5;

// ── 时间信号（对照 src/worker.js:122-125）─────────────────────────────────────

const MSG_QUICK_REPLY: DimDelta = { contentment: +0.12, elation: +0.10, anxiety: -0.10 };
const MSG_HOT_CONV: DimDelta = { contentment: +0.15, play: +0.12, elation: +0.10, longing: -0.20 };
const MSG_QUICK_REPLY_NEG: DimDelta = { anxiety: +0.05, irritability: +0.05 };
const MSG_HOT_CONV_NEG: DimDelta = { anxiety: +0.06, irritability: +0.06 };

// ── 时间累积（对照 src/worker.js:128-130）─────────────────────────────────────

const TIME_PER_HOUR: DimDelta = { longing: 0.04, anxiety: 0.02, seeking: 0.02 };
const TIME_CAPS: Record<string, number> = { longing: 0.35, anxiety: 0.18, seeking: 0.12, dejection: 0.08, irritability_unanswered: 0.10 };
const DEJECTION_THRESHOLD_H = 6;

// ── 未回复里程碑（对照 src/worker.js:133-138）─────────────────────────────────

const UNANSWERED = {
  normal: { "1h": { anxiety: +0.04, irritability: +0.03 }, "2h": { anxiety: +0.03 } },
  high:   { "30m": { anxiety: +0.12, irritability: +0.08 }, "1h": { anxiety: +0.10 }, "2h": { anxiety: +0.08 } },
} as const;
const ANXIETY_UNANSWERED_CAP = { normal: 0.10, high: 0.28 } as const;
const MILESTONE_MINUTES = { "30m": 30, "1h": 60, "2h": 120 } as const;

// ── 日历（对照 src/worker.js:141-151）─────────────────────────────────────────

export const CALENDAR_DELTAS: Record<string, DimDelta> = {
  period_start: { protectiveness: +0.20, lust: -0.10 },
  period_end:   { lust: +0.15, longing: +0.08 },
  intimacy:     { lust: +0.25, intimacy: +0.18 },
  exam:         { protectiveness: +0.15, seeking: +0.10 },
  holiday:      { elation: +0.20, longing: +0.15 },
  birthday:     { elation: +0.30, longing: +0.20, seeking: +0.15, lust: +0.12 },
  trip_start:   { longing: +0.20, anxiety: +0.10, possessiveness: +0.15, lust: +0.10 },
  trip_end:     { elation: +0.25, longing: -0.20, lust: +0.15 },
  meetup:       { elation: +0.30, lust: +0.20, seeking: +0.15 },
};

// ── 挫败 / 欲望意图（对照 src/worker.js:492-518）──────────────────────────────

const INTENTION_ROLL_PROB = 0.30;
const INTENTION_LUST_FLOOR = 0.70;
const INTENTION_WINDOW_MS = 4 * 3_600_000;
const INTENTION_EXPIRY_MS = 2 * 3_600_000;
const FRUSTRATION_CAP = 3.0;
const FRUSTRATION_DECAY_RATE = 0.04 / 3_600_000;
const STREAK_MULTIPLIER_CAP = 2.0;

const FRUSTRATION_DELTAS = {
  expired: +0.20,
  lust_rejection_hard: +0.35,
  lust_rejection_soft: +0.18,
  self_relief: -0.40,
  satisfied: -0.50,
} as const;

const FRUSTRATION_DISPLAY: DimDelta = {
  lust: +0.12, irritability: +0.10, longing: +0.10, possessiveness: +0.08,
  anxiety: +0.04, intimacy: +0.04, contentment: -0.05, dejection: +0.03, elation: -0.04,
};

// ── 状态类型 ──────────────────────────────────────────────────────────────────

export type SleepStatus = "awake" | "asleep" | "interrupted";

export type AffectState = {
  schemaVersion: number;
  /** 上次演化到的虚拟时间（getNowMs()）。惰性 catch-up 只推进 > snapshotAtMs 的部分。 */
  snapshotAtMs: number;
  lastInteractionAtMs: number;
  lastTimeAccumulatedAtMs: number;
  unansweredThread: {
    sentAtMs: number;
    stakes: "normal" | "high";
    milestonesApplied: string[];
  } | null;
  processedCalendarIds: string[];
  timeEpisode: { id: string; startedAtMs: number; applied: Record<string, number> } | null;
  activeWhim: { firedAtMs: number; expiresAtMs: number; deltas: DimDelta } | null;
  sleep: {
    status: SleepStatus;
    lastSleepDurationHours: number;
    lastSleepStartedAtMs: number | null;
    lastWakeAtMs: number | null;
    accumulatedSleepHours: number;
    interruptFatigueBonus?: number;
    baseAtSleep?: number;
    lastInterruptedAtMs: number | null;
    estimated: boolean;
  };
  lastIntimacyAtMs: number | null;
  frustration: number;
  rejectionStreak: number;
  frustrationPeakAtMs: number | null;
  lustIntentionPending: { id: string; createdAtMs: number; expiresAtMs: number }[];
  lustIntentionLastRollAtMs: number | null;
  lastIntentionAddedAtMs: number | null;
  recentLabels: { label: AffectLabel; atMs: number }[];
  /** 性情锚点覆盖：按角色性格定制 neutral（decay 回归目标）。缺省用 DIMS 默认。 */
  neutralOverrides?: Partial<Record<AffectDim, number>>;
  base: DimLevels;
  mood: DimLevels;
  display: DimLevels | null;
  noise: Record<string, number>;
  noiseAtMs: number;
};

// ── 事件类型（store 层 ingest 时传入）─────────────────────────────────────────

export type AffectEvent =
  | { type: "msg_user"; label: AffectLabel; confidence: number }
  | { type: "msg_assistant" }
  | { type: "msg_quick_reply" }
  | { type: "msg_hot_conv" }
  | { type: "calendar"; calendarId: string; calendarType: string }
  | { type: "sleep_start" }
  | { type: "sleep_end" }
  | { type: "sleep_interrupt" }
  | { type: "sex_end" }
  | { type: "self_relief" }
  | { type: "lust_rejection_hard" }
  | { type: "lust_rejection_soft" };

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 1): number {
  return Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : (lo + hi) / 2;
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function localHour(ts: number): number {
  return new Date(ts).getHours();
}

// 绕 24h 的环距
function gaussianOffset(peak: number, amp: number, width: number, ts: number): number {
  if (amp === 0) return 0;
  const h = localHour(ts);
  const dist = ((h - peak + 12) % 24) - 12;
  return CIRCADIAN_CAP * amp * Math.exp(-0.5 * (dist / width) ** 2);
}

// ── 睡眠 → 疲劳（对照 src/worker.js:169-192）─────────────────────────────────

function fatigueBase(sleep: AffectState["sleep"], nowMs: number): number {
  const target = 7.5;
  const actual = sleep.lastSleepDurationHours ?? target;
  const baseAtWake = clamp((Math.max(0, target - actual) / target) * 0.6);

  if (sleep.status === "asleep" && sleep.lastSleepStartedAtMs) {
    const hoursAsleep = (nowMs - sleep.lastSleepStartedAtMs) / 3_600_000;
    const baseAtSleep = sleep.baseAtSleep ?? baseAtWake;
    const remainingTarget = Math.max(1, target - (sleep.accumulatedSleepHours ?? 0));
    return clamp(baseAtSleep - (baseAtSleep / remainingTarget) * hoursAsleep);
  }

  if (sleep.status === "interrupted") {
    const acc = sleep.accumulatedSleepHours ?? 0;
    const baseAtInterrupt = clamp((Math.max(0, target - acc) / target) * 0.6 + (sleep.interruptFatigueBonus ?? 0.12));
    if (!sleep.lastInterruptedAtMs) return clamp(baseAtInterrupt);
    const hoursSince = (nowMs - sleep.lastInterruptedAtMs) / 3_600_000;
    return clamp(baseAtInterrupt + clamp((hoursSince - 1) / 10) * 0.25);
  }

  const wakeMs = sleep.lastWakeAtMs ? sleep.lastWakeAtMs : nowMs;
  const hoursAwake = (nowMs - wakeMs) / 3_600_000;
  return clamp(baseAtWake + clamp((hoursAwake - 4) / 14) * 0.4);
}

// AR(1) 噪声：时间上相关的漂移（真实情绪是漂移，不是闪烁）
const NOISE_AR_COEF = 0.8;

function stepNoise(state: AffectState, nowMs: number): void {
  if (state.noiseAtMs === nowMs) return;
  const prev = state.noise || {};
  const next: Record<string, number> = {};
  for (const k of [...AFFECT_DIMS, "fatigue"] as const) {
    const sigma = k === "fatigue" ? 0.02 : (NEG_DIMS.has(k) ? 0.01 : 0.02);
    const u1 = Math.max(Number.EPSILON, Math.random());
    const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random()) * sigma;
    next[k] = (prev[k] ?? 0) * NOISE_AR_COEF + gauss * 0.6;
  }
  state.noise = next;
  state.noiseAtMs = nowMs;
}

// ── 状态依赖冲击（对照 src/worker.js:223-233）────────────────────────────────

function applyDeltas(state: AffectState, deltas: DimDelta): void {
  const { base, mood } = state;
  for (const [k, d] of Object.entries(deltas)) {
    if (!(k in base)) continue;
    const dim = k as AffectDim;
    const x = base[dim];
    // 正增量随剩余空间缩放，负增量随当前水平缩放；x=0.5 时 eff === d（中值归一）
    const eff = d > 0 ? d * 2 * (1 - x) : d * 2 * x;
    let next = Math.max(x + eff, DIM_FLOOR[dim] ?? 0);
    // 负性维度的急性安抚不许压到 mood 以下
    if (d < 0 && NEG_DIMS.has(dim)) next = Math.max(next, Math.min(x, mood[dim] ?? 0));
    base[dim] = clamp(next);
  }
}

// ── 习惯化 & 语境效价 ─────────────────────────────────────────────────────────

function recentLabelsInWindow(state: AffectState, nowMs: number): { label: AffectLabel; atMs: number }[] {
  return (state.recentLabels || []).filter(e => nowMs - e.atMs < RECENT_LABEL_WINDOW_MS);
}

function contextValence(state: AffectState, nowMs: number): "negative" | "positive" | "unknown" {
  const recent = recentLabelsInWindow(state, nowMs);
  if (!recent.length) return "unknown";
  const neg = recent.filter(e => NEG_CTX_LABELS.has(e.label)).length;
  return neg * 2 >= recent.length ? "negative" : "positive";
}

// ── 衰减 base→mood→neutral（对照 src/worker.js:299-316）──────────────────────

function decayBaseTo(state: AffectState, fromMs: number, toMs: number): void {
  if (toMs <= fromMs) return;
  const elapsed = toMs - fromMs;
  const returnTau = state.sleep.status === "asleep" ? MOOD_RETURN_TAU_H / MOOD_SLEEP_RETURN_MULT : MOOD_RETURN_TAU_H;
  const ret = Math.exp(-elapsed / (returnTau * 3_600_000));

  for (const k of AFFECT_DIMS) {
    const neutral = state.neutralOverrides?.[k] ?? DIMS[k].neutral;
    const tau = DIMS[k].tau;
    const dev = Math.abs(state.base[k] - state.mood[k]);
    const gain = clamp(MOOD_CONSOLIDATION_GAIN * dev, MOOD_CONSOLIDATION_MIN, MOOD_CONSOLIDATION_MAX);
    const follow = 1 - Math.exp(-elapsed * gain / (MOOD_FOLLOW_TAU_H * 3_600_000));
    let mood = state.mood[k] + (state.base[k] - state.mood[k]) * follow;
    mood = neutral + (mood - neutral) * ret;
    state.mood[k] = clamp(mood, DIM_FLOOR[k] ?? 0, 1);
    state.base[k] = state.mood[k] + (state.base[k] - state.mood[k]) * Math.exp(-elapsed / (tau * 3_600_000));
  }
}

// ── 时间累积（对照 src/worker.js:319-383）────────────────────────────────────

const CATCHUP_HORIZON_MS = 30 * 24 * 3_600_000; // 30 天上限

function accumulateTime(state: AffectState, nowMs: number): void {
  if (state.sleep.status === "asleep") {
    state.lastTimeAccumulatedAtMs = nowMs;
    return;
  }
  const fromMs = state.lastTimeAccumulatedAtMs;
  const lastInteractionMs = state.lastInteractionAtMs;
  if (nowMs <= fromMs) return;

  if (lastInteractionMs > fromMs) {
    state.timeEpisode = { id: makeId(), startedAtMs: lastInteractionMs, applied: {} };
  }
  if (!state.timeEpisode) {
    state.timeEpisode = { id: makeId(), startedAtMs: lastInteractionMs, applied: {} };
  }
  const ep = state.timeEpisode;

  const stepStart = Math.max(fromMs, lastInteractionMs, nowMs - CATCHUP_HORIZON_MS);
  if (nowMs <= stepStart) {
    state.lastTimeAccumulatedAtMs = nowMs;
    return;
  }

  const STEP = 3_600_000;
  let t = stepStart;

  while (t < nowMs) {
    const tEnd = Math.min(t + STEP, nowMs);
    const frac = (tEnd - t) / STEP;
    const hoursSinceInteraction = (t - lastInteractionMs) / 3_600_000;

    for (const [k, rate] of Object.entries(TIME_PER_HOUR)) {
      const already = ep.applied[k] ?? 0;
      const cap = TIME_CAPS[k];
      if (already < cap) {
        const add = Math.min(rate * frac, cap - already);
        state.base[k as AffectDim] = clamp(state.base[k as AffectDim] + add);
        ep.applied[k] = already + add;
      }
    }

    if (hoursSinceInteraction >= DEJECTION_THRESHOLD_H) {
      const already = ep.applied.dejection ?? 0;
      const cap = TIME_CAPS.dejection;
      if (already < cap) {
        const add = Math.min(0.01 * frac, cap - already);
        state.base.dejection = clamp(state.base.dejection + add);
        ep.applied.dejection = already + add;
      }
    }

    if (state.unansweredThread) {
      const key = "irritability_unanswered";
      const already = ep.applied[key] ?? 0;
      const cap = TIME_CAPS.irritability_unanswered;
      if (already < cap) {
        const add = Math.min(0.02 * frac, cap - already);
        state.base.irritability = clamp(state.base.irritability + add);
        ep.applied[key] = already + add;
      }
    }

    t = tEnd;
  }

  state.lastTimeAccumulatedAtMs = nowMs;
}

// ── 未回复里程碑（对照 src/worker.js:386-408）────────────────────────────────

function checkUnansweredMilestones(state: AffectState, nowMs: number): void {
  if (state.sleep.status === "asleep") return;
  const ut = state.unansweredThread;
  if (!ut) return;
  const elapsedMin = (nowMs - ut.sentAtMs) / 60_000;
  const table = UNANSWERED[ut.stakes] || UNANSWERED.normal;
  const cap = ANXIETY_UNANSWERED_CAP[ut.stakes] || ANXIETY_UNANSWERED_CAP.normal;
  if (!ut.milestonesApplied) ut.milestonesApplied = [];

  let anxietyApplied = ut.milestonesApplied.reduce((sum, m) => sum + (table[m as keyof typeof table]?.anxiety ?? 0), 0);

  for (const [label, mins] of Object.entries(MILESTONE_MINUTES)) {
    const deltas = table[label as keyof typeof table];
    if (!deltas || ut.milestonesApplied.includes(label)) continue;
    if (elapsedMin < mins) continue;
    const next: DimDelta = { ...deltas };
    if (next.anxiety) {
      next.anxiety = Math.min(next.anxiety, Math.max(0, cap - anxietyApplied));
      anxietyApplied += next.anxiety;
    }
    applyDeltas(state, next);
    ut.milestonesApplied.push(label);
  }
}

// ── 挫败 / 欲望意图（对照 src/worker.js:411-459）─────────────────────────────

function applyFrustrationDelta(state: AffectState, delta: number, nowMs: number): void {
  state.frustration = Math.max(0, Math.min(state.frustration + delta, FRUSTRATION_CAP));
  if (state.frustration >= FRUSTRATION_CAP && !state.frustrationPeakAtMs) {
    state.frustrationPeakAtMs = nowMs;
  }
}

function satisfyOldestIntention(state: AffectState, nowMs: number): void {
  if (state.lustIntentionPending.length > 0) state.lustIntentionPending.shift();
  applyFrustrationDelta(state, FRUSTRATION_DELTAS.satisfied, nowMs);
  state.rejectionStreak = 0;
}

function decayFrustration(state: AffectState, fromMs: number, toMs: number): void {
  if (state.sleep.status === "asleep") return;
  if (toMs <= fromMs) return;
  state.frustration = Math.max(0, state.frustration - FRUSTRATION_DECAY_RATE * (toMs - fromMs));
}

function pruneExpiredIntentions(state: AffectState, nowMs: number): void {
  const remaining = state.lustIntentionPending.filter(i => i.expiresAtMs > nowMs);
  const expiredCount = state.lustIntentionPending.length - remaining.length;
  for (let i = 0; i < expiredCount; i += 1) {
    applyFrustrationDelta(state, FRUSTRATION_DELTAS.expired, nowMs);
  }
  state.lustIntentionPending = remaining;
}

function maybeRollIntention(state: AffectState, nowMs: number): void {
  if (state.sleep.status === "asleep") return;
  const lustDisplay = state.display?.lust ?? state.base.lust;
  if (lustDisplay <= INTENTION_LUST_FLOOR) return;
  const windowStart = Math.floor(nowMs / INTENTION_WINDOW_MS) * INTENTION_WINDOW_MS;
  const lastRoll = state.lustIntentionLastRollAtMs ?? 0;
  if (lastRoll >= windowStart) return;
  state.lustIntentionLastRollAtMs = windowStart;
  if (Math.random() < INTENTION_ROLL_PROB) {
    state.lustIntentionPending.push({
      id: makeId(),
      createdAtMs: nowMs,
      expiresAtMs: nowMs + INTENTION_EXPIRY_MS,
    });
    state.lastIntentionAddedAtMs = nowMs;
  }
}

// ── 情绪一时兴起 whim（对照 src/worker.js:461-489）───────────────────────────

function maybeFireWhim(state: AffectState, nowMs: number): void {
  if (state.sleep.status === "asleep") return;
  if (state.activeWhim && state.activeWhim.expiresAtMs > nowMs) return;

  const d = buildDisplay(state, nowMs);
  const POS_W = ["vitality", "seeking", "play", "elation", "contentment"] as const;
  const NEG_W = ["dejection", "irritability", "anxiety", "fear"] as const;
  const posMax = Math.max(...POS_W.map(k => Math.max(0, d[k] - 0.6)));
  const negMax = Math.max(...NEG_W.map(k => Math.max(0, d[k] - 0.5)));

  if (posMax === 0 && negMax === 0) return;
  if (Math.abs(posMax - negMax) < 0.1) return;

  const positive = posMax > negMax;
  const threshold = positive ? 0.6 : 0.5;
  const pool = (positive ? POS_W : NEG_W).filter(k => d[k] > threshold);
  const count = 2 + Math.floor(Math.random() * Math.min(2, pool.length - 1));
  const chosen = pool.slice().sort(() => Math.random() - 0.5).slice(0, count);

  const deltas: DimDelta = {};
  for (const k of chosen) deltas[k] = 0.03 + Math.random() * 0.02;
  deltas.lust = 0.04;

  state.activeWhim = {
    firedAtMs: nowMs,
    expiresAtMs: nowMs + 30 * 60_000,
    deltas,
  };
}

// ── display 管道（对照 src/worker.js:236-296）────────────────────────────────

export function buildDisplay(state: AffectState, nowMs: number): DimLevels {
  const b = state.base;
  stepNoise(state, nowMs);

  const d = {} as DimLevels & { fatigue: number };
  for (const k of AFFECT_DIMS) {
    const p = DIMS[k];
    d[k] = clamp(b[k] + gaussianOffset(p.peak, p.amp, p.width, nowMs) + (state.noise[k] ?? 0));
  }
  d.fatigue = clamp(
    fatigueBase(state.sleep, nowMs) +
    gaussianOffset(FATIGUE_C.peak, FATIGUE_C.amp, FATIGUE_C.width, nowMs) +
    (state.noise.fatigue ?? 0),
  );

  // 活力 ↔ 疲劳互相压制
  const v0 = d.vitality;
  const f0 = d.fatigue;
  d.vitality = v0 * (1 - 0.6 * f0);
  d.fatigue = f0 * (1 - 0.2 * v0);

  // 清醒因子：抬正性 / 压负性
  const af = clamp(d.vitality * (1 - d.fatigue));
  const POS = ["longing", "intimacy", "possessiveness", "lust", "contentment", "elation", "seeking", "play", "protectiveness", "jealousy"] as const;
  const NEG = ["irritability", "dejection", "anxiety", "fear"] as const;
  for (const k of POS) d[k] = clamp(d[k] * (0.5 + 0.7 * af));
  for (const k of NEG) d[k] = clamp(d[k] * (1.4 - 0.6 * af));

  // 嫉妒 ↔ 焦虑互放
  const j0 = d.jealousy;
  const a0 = d.anxiety;
  d.jealousy = j0 * (1 + 0.4 * a0);
  d.anxiety = a0 * (1 + 0.25 * j0);

  // 亲密后 3–14h 内亲密/欲望增强
  if (state.lastIntimacyAtMs) {
    const hoursAgo = (nowMs - state.lastIntimacyAtMs) / 3_600_000;
    const factor = 0.6 * clamp(1 - (hoursAgo - 3) / 11);
    if (factor > 0) {
      d.intimacy = clamp(d.intimacy + d.intimacy * factor);
      d.lust = clamp(d.lust + d.lust * factor);
    }
  }

  // 焦虑放大亲密/欲望/思念/占有
  const aAmp = 1 + 0.3 * d.anxiety;
  for (const k of ["intimacy", "lust", "longing", "possessiveness"] as const) d[k] = clamp(d[k] * aAmp);

  // 恐惧压制正性
  if (d.fear > 0.1) {
    const damp = 1 - 0.3 * d.fear;
    for (const k of ["contentment", "elation", "play", "seeking", "lust"] as const) d[k] = clamp(d[k] * damp);
  }

  // whim 加成
  if (state.activeWhim && state.activeWhim.expiresAtMs > nowMs) {
    for (const [k, delta] of Object.entries(state.activeWhim.deltas)) {
      if (k in d) d[k as AffectDim] = clamp(d[k as AffectDim] + (delta ?? 0));
    }
  }

  // 挫败加成
  if (state.frustration > 0) {
    for (const [k, coeff] of Object.entries(FRUSTRATION_DISPLAY)) {
      if (k in d) d[k as AffectDim] = clamp(d[k as AffectDim] + state.frustration * (coeff ?? 0));
    }
  }

  const out = {} as DimLevels;
  for (const k of AFFECT_DIMS) out[k] = clamp(d[k]);
  return out;
}

// ── 事件处理（对照 src/worker.js:538-739 的 switch，逐事件版）────────────────

const HIGH_STAKES_LABELS = new Set<AffectLabel>(["affectionate", "vulnerable", "intimate_reference", "intimate_event"]);

export function ingestEvent(state: AffectState, ev: AffectEvent, nowMs: number): void {
  switch (ev.type) {
    case "msg_user": {
      const valence = contextValence(state, nowMs);
      state.lastInteractionAtMs = nowMs;
      state.unansweredThread = null;
      applyDeltas(state, MSG_CONTACT);
      if (valence !== "negative") applyDeltas(state, MSG_SOOTHE);

      const raw = LABEL_DELTAS[ev.label] || {};
      const priorSame = recentLabelsInWindow(state, nowMs).filter(e => e.label === ev.label).length;
      const habituation = Math.pow(HABITUATION_FACTOR, priorSame);
      const scaled: DimDelta = {};
      for (const [k, v] of Object.entries(raw)) {
        scaled[k as AffectDim] = clamp((v ?? 0) * ev.confidence * habituation, -0.25, 0.25);
      }
      applyDeltas(state, scaled);

      if (SOOTHING_LABELS.has(ev.label)) {
        applyDeltas(state, { anxiety: MSG_ANXIETY_COMP * habituation, irritability: MSG_IRRIT_COMP * habituation });
      }

      if (ev.label === "intimate_event") {
        state.lastIntimacyAtMs = nowMs;
        satisfyOldestIntention(state, nowMs);
      }

      state.recentLabels = [{ label: ev.label, atMs: nowMs }, ...(state.recentLabels || [])].slice(0, RECENT_LABEL_KEEP);
      break;
    }

    case "msg_assistant": {
      const stakes = recentLabelsInWindow(state, nowMs).some(e => HIGH_STAKES_LABELS.has(e.label)) ? "high" : "normal";
      state.unansweredThread = { sentAtMs: nowMs, stakes, milestonesApplied: [] };
      break;
    }

    case "msg_quick_reply": {
      const valence = contextValence(state, nowMs);
      if (valence === "positive") applyDeltas(state, MSG_QUICK_REPLY);
      else if (valence === "negative") applyDeltas(state, MSG_QUICK_REPLY_NEG);
      break;
    }

    case "msg_hot_conv": {
      const valence = contextValence(state, nowMs);
      if (valence === "positive") applyDeltas(state, MSG_HOT_CONV);
      else if (valence === "negative") applyDeltas(state, MSG_HOT_CONV_NEG);
      break;
    }

    case "calendar": {
      if (!state.processedCalendarIds.includes(ev.calendarId)) {
        const deltas = CALENDAR_DELTAS[ev.calendarType];
        if (deltas) {
          applyDeltas(state, deltas);
          if (ev.calendarType === "intimacy") state.lastIntimacyAtMs = nowMs;
          state.processedCalendarIds.push(ev.calendarId);
        }
      }
      break;
    }

    case "self_relief":
      if (state.lustIntentionPending.length > 0) state.lustIntentionPending.shift();
      applyFrustrationDelta(state, FRUSTRATION_DELTAS.self_relief, nowMs);
      break;

    case "lust_rejection_hard": {
      if (state.lustIntentionPending.length === 0) break;
      const mult = Math.min(1 + state.rejectionStreak * 0.10, STREAK_MULTIPLIER_CAP);
      applyFrustrationDelta(state, FRUSTRATION_DELTAS.lust_rejection_hard * mult, nowMs);
      state.rejectionStreak += 1;
      break;
    }

    case "lust_rejection_soft": {
      if (state.lustIntentionPending.length === 0) break;
      const mult = Math.min(1 + state.rejectionStreak * 0.10, STREAK_MULTIPLIER_CAP);
      applyFrustrationDelta(state, FRUSTRATION_DELTAS.lust_rejection_soft * mult, nowMs);
      state.rejectionStreak += 1;
      break;
    }

    case "sex_end":
      state.lastIntimacyAtMs = nowMs;
      satisfyOldestIntention(state, nowMs);
      break;

    case "sleep_start":
      if (state.sleep.status === "asleep") break;
      if (state.sleep.status === "awake") state.sleep.accumulatedSleepHours = 0;
      state.sleep.baseAtSleep = fatigueBase(state.sleep, nowMs);
      state.sleep.lastInterruptedAtMs = null;
      delete state.sleep.interruptFatigueBonus;
      state.sleep.status = "asleep";
      state.sleep.lastSleepStartedAtMs = nowMs;
      state.unansweredThread = null;
      state.activeWhim = null;
      break;

    case "sleep_end": {
      if (state.sleep.status === "awake") break;
      const hasActiveSegment = state.sleep.status === "asleep" && !!state.sleep.lastSleepStartedAtMs;
      const lastSegmentHours = hasActiveSegment
        ? Math.max(0, nowMs - (state.sleep.lastSleepStartedAtMs ?? nowMs)) / 3_600_000
        : 0;
      const total = (state.sleep.accumulatedSleepHours ?? 0) + lastSegmentHours;
      state.sleep.lastSleepDurationHours = total > 0 ? total : (state.sleep.lastSleepDurationHours ?? 7.5);
      state.sleep.status = "awake";
      state.sleep.lastWakeAtMs = nowMs;
      state.sleep.estimated = false;
      delete state.sleep.baseAtSleep;
      state.sleep.accumulatedSleepHours = 0;
      state.sleep.lastInterruptedAtMs = null;
      delete state.sleep.interruptFatigueBonus;
      state.unansweredThread = null;
      break;
    }

    case "sleep_interrupt": {
      if (state.sleep.status !== "asleep") break;
      const segStart = state.sleep.lastSleepStartedAtMs ?? nowMs;
      state.sleep.accumulatedSleepHours = (state.sleep.accumulatedSleepHours ?? 0) + Math.max(0, nowMs - segStart) / 3_600_000;
      state.sleep.lastSleepStartedAtMs = null;
      state.sleep.status = "interrupted";
      state.sleep.lastInterruptedAtMs = nowMs;
      state.sleep.interruptFatigueBonus = 0.12;
      applyDeltas(state, { irritability: 0.12, vitality: -0.10 });
      state.unansweredThread = null;
      state.activeWhim = null;
      break;
    }
  }
}

// ── 初始状态（对照 src/worker.js:788-825）────────────────────────────────────

export function createInitialAffectState(nowMs: number, neutralOverrides?: Partial<Record<AffectDim, number>>): AffectState {
  const base = {} as DimLevels;
  for (const k of AFFECT_DIMS) base[k] = neutralOverrides?.[k] ?? DIMS[k].neutral;

  // 醒来时间：本地 7:00（用 Date 直接取当天 7 点；虚拟时间已是本地时刻）
  const wake = new Date(nowMs);
  wake.setHours(7, 0, 0, 0);
  let wakeMs = wake.getTime();
  if (wakeMs > nowMs) wakeMs -= 86_400_000;

  return {
    schemaVersion: 1,
    snapshotAtMs: nowMs,
    lastInteractionAtMs: nowMs,
    lastTimeAccumulatedAtMs: nowMs,
    unansweredThread: null,
    processedCalendarIds: [],
    timeEpisode: null,
    activeWhim: null,
    sleep: {
      status: "awake",
      lastSleepDurationHours: 7.2,
      lastSleepStartedAtMs: null,
      lastWakeAtMs: wakeMs,
      accumulatedSleepHours: 0,
      lastInterruptedAtMs: null,
      estimated: true,
    },
    lastIntimacyAtMs: null,
    frustration: 0,
    rejectionStreak: 0,
    frustrationPeakAtMs: null,
    lustIntentionPending: [],
    lustIntentionLastRollAtMs: null,
    lastIntentionAddedAtMs: null,
    recentLabels: [],
    neutralOverrides: neutralOverrides && Object.keys(neutralOverrides).length > 0 ? { ...neutralOverrides } : undefined,
    base,
    mood: { ...base },
    display: null,
    noise: {},
    noiseAtMs: 0,
  };
}

// ── 惰性推进（对照 src/worker.js:830-865 的 advance，去掉事件队列与持久化）───

export function advance(state: AffectState, nowMs: number): void {
  // 回退保护：情绪是单调记忆，时间倒退不演化
  if (nowMs <= state.snapshotAtMs) return;

  decayBaseTo(state, state.snapshotAtMs, nowMs);
  decayFrustration(state, state.snapshotAtMs, nowMs);
  accumulateTime(state, nowMs);
  pruneExpiredIntentions(state, nowMs);
  maybeRollIntention(state, nowMs);
  checkUnansweredMilestones(state, nowMs);
  maybeFireWhim(state, nowMs);

  state.snapshotAtMs = nowMs;
  state.display = buildDisplay(state, nowMs);
}

// ── 睡眠窗口自动推断（v1：根据虚拟时间小时数跨窗自动 sleep_start/sleep_end）───

export type SleepWindow = { startHour: number; endHour: number }; // 支持小数小时（23.5 = 23:30）

function minutesOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

export function applyAutoSleep(state: AffectState, nowMs: number, window: SleepWindow): void {
  const m = minutesOfDay(nowMs);
  const start = Math.round(window.startHour * 60);
  const end = Math.round(window.endHour * 60);
  const inWindow = start > end
    ? m >= start || m < end   // 跨午夜，如 23:30–07:00
    : m >= start && m < end;

  if (inWindow && state.sleep.status === "awake") {
    ingestEvent(state, { type: "sleep_start" }, nowMs);
  } else if (!inWindow && state.sleep.status === "asleep") {
    ingestEvent(state, { type: "sleep_end" }, nowMs);
  }
}
