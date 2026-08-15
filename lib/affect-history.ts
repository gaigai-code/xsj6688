// lib/affect-history.ts
// 情绪历史记录：每次情绪被事件推动时，存一条「发生了什么 + 事件后的情绪快照」。
// 用于调试面板查看情绪轨迹，也为将来「长期情绪记忆」提供原料。
//
//   - 存储：单 kv key ai_phone_affect_history_v1，存 Record<ownerId, AffectHistoryEntry[]>
//   - 每角色保留最近 MAX_HISTORY_PER_OWNER 条（旧的自然淘汰）
//   - 时间戳用 getNowMs()（虚拟时间），与情绪状态一致

import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import type { AffectLabel, DimLevels } from "./affect-model";

export const AFFECT_HISTORY_KEY = "ai_phone_affect_history_v1";
const MAX_HISTORY_PER_OWNER = 200;

registerKvMigration(AFFECT_HISTORY_KEY);

export type AffectHistoryEntry = {
  atMs: number;        // 虚拟时间戳
  kind: string;        // 事件类型（msg_user / calendar / sleep_start ...）
  text: string;        // 人类可读摘要
  display: DimLevels;  // 事件后的情绪快照
  frustration: number;
};

const LABEL_ZH: Record<AffectLabel, string> = {
  affectionate: "示爱", playful: "调情", vulnerable: "脆弱", reassuring: "安抚",
  cold: "冷淡", conflict: "争吵", distant: "疏远", struggling: "诉苦",
  intimate_reference: "暧昧", intimate_event: "亲密", neutral: "平常", hostile: "敌意",
  fear_separation: "怕分离", fear_death: "怕死亡", fear_concern: "担心", fear_general: "恐惧",
};

const EVENT_ZH: Record<string, string> = {
  msg_assistant: "发出消息", msg_quick_reply: "秒回", msg_hot_conv: "热聊",
  sleep_start: "入睡", sleep_end: "醒来", sleep_interrupt: "睡眠中断",
  sex_end: "亲密满足", self_relief: "自行解决",
  lust_rejection_hard: "被硬拒", lust_rejection_soft: "被冷淡",
};

const CALENDAR_ZH: Record<string, string> = {
  period_start: "经期开始", period_end: "经期结束", intimacy: "亲密安排",
  exam: "考试", holiday: "假期", birthday: "生日",
  trip_start: "出发旅行", trip_end: "旅行归来", meetup: "见面",
};

/** 生成事件的人类可读摘要。 */
export function describeAffectEvent(kind: string, label?: AffectLabel, calendarType?: string): string {
  if (kind === "msg_user" && label) return `收到「${LABEL_ZH[label]}」`;
  if (kind === "calendar" && calendarType) return `日历·${CALENDAR_ZH[calendarType] || calendarType}`;
  return EVENT_ZH[kind] || kind;
}

// ── 存储 ──────────────────────────────────────────────────────────────────────

let cachedRaw: string | null | undefined;
let cachedHistories: Record<string, AffectHistoryEntry[]> = {};

function loadAll(): Record<string, AffectHistoryEntry[]> {
  if (typeof window === "undefined") return cachedHistories;
  const raw = kvGet(AFFECT_HISTORY_KEY);
  if (raw === cachedRaw) return cachedHistories;
  cachedRaw = raw;
  if (!raw) {
    cachedHistories = {};
    return cachedHistories;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const histories: Record<string, AffectHistoryEntry[]> = {};
    if (parsed && typeof parsed === "object") {
      for (const [id, list] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(list)) {
          histories[id] = list.filter(e => e && typeof e === "object" && typeof (e as AffectHistoryEntry).atMs === "number");
        }
      }
    }
    cachedHistories = histories;
  } catch {
    cachedHistories = {};
  }
  return cachedHistories;
}

function persist(): void {
  cachedRaw = JSON.stringify(cachedHistories);
  if (typeof window !== "undefined") kvSet(AFFECT_HISTORY_KEY, cachedRaw);
}

export function recordAffectHistory(ownerId: string, entry: AffectHistoryEntry): void {
  const all = loadAll();
  const list = all[ownerId] || [];
  list.push(entry);
  if (list.length > MAX_HISTORY_PER_OWNER) {
    list.splice(0, list.length - MAX_HISTORY_PER_OWNER);
  }
  all[ownerId] = list;
  cachedHistories = all;
  persist();
}

/** 返回某角色的情绪历史（最新在前）。 */
export function getAffectHistory(ownerId: string): AffectHistoryEntry[] {
  const list = loadAll()[ownerId] || [];
  return [...list].reverse();
}
