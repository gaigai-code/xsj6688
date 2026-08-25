// lib/virtual-time.ts
// 虚拟时间系统：全局唯一时间真相源。
//
// 两种模式：
//   - realtime：跟随真实时间（默认，用户未进入角色扮演时）。
//   - virtual ：使用「锚点 + 流速」模型自主走时：
//       getNow() = anchorVirtualMs + (Date.now() - anchorRealMs) * rate
//     一个公式覆盖：手动设定（重设锚点）、推进/回退（锚点加偏移）、
//     暂停（rate=0）、倍速（rate=N）、以及刷新页面后继续走时（锚点持久化）。
//
// AI 认知时间（character-time / macro-engine）与 UI 显示时间都应调用 getNow()，
// 而不是直接 new Date()。数据落库时间戳（createdAt 等）请保持真实时间。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export const VIRTUAL_TIME_KEY = "ai_phone_virtual_time_v1";

export type VirtualTimeMode = "realtime" | "virtual";

export type VirtualTimeState = {
  mode: VirtualTimeMode;
  /** virtual 模式下：上次锚定时的真实时间戳（ms epoch）。 */
  anchorRealMs: number;
  /** virtual 模式下：锚定时刻对应的虚拟时间戳（ms epoch）。 */
  anchorVirtualMs: number;
  /** 虚拟时间流速：虚拟毫秒 / 真实毫秒。0 = 暂停。 */
  rate: number;
};

export const DEFAULT_VIRTUAL_TIME_STATE: VirtualTimeState = {
  mode: "realtime",
  anchorRealMs: 0,
  anchorVirtualMs: 0,
  rate: 0,
};

export const VIRTUAL_TIME_UPDATED_EVENT = "virtual-time-updated";

registerKvMigration(VIRTUAL_TIME_KEY);

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedState: VirtualTimeState = { ...DEFAULT_VIRTUAL_TIME_STATE };

function normalizeState(raw: unknown): VirtualTimeState {
  const src = (raw && typeof raw === "object" ? raw : {}) as Partial<VirtualTimeState>;
  const rate = typeof src.rate === "number" && Number.isFinite(src.rate) ? Math.max(0, src.rate) : 0;
  const anchorRealMs = typeof src.anchorRealMs === "number" && Number.isFinite(src.anchorRealMs) ? src.anchorRealMs : 0;
  const anchorVirtualMs = typeof src.anchorVirtualMs === "number" && Number.isFinite(src.anchorVirtualMs) ? src.anchorVirtualMs : 0;
  return {
    mode: src.mode === "virtual" ? "virtual" : "realtime",
    anchorRealMs,
    anchorVirtualMs,
    rate,
  };
}

function loadState(): VirtualTimeState {
  if (typeof window === "undefined") return { ...DEFAULT_VIRTUAL_TIME_STATE };
  const raw = kvGet(VIRTUAL_TIME_KEY);
  if (raw === cachedRaw) return cachedState;
  cachedRaw = raw;
  if (!raw) {
    cachedState = { ...DEFAULT_VIRTUAL_TIME_STATE };
    return cachedState;
  }
  try {
    cachedState = normalizeState(JSON.parse(raw));
  } catch {
    cachedState = { ...DEFAULT_VIRTUAL_TIME_STATE };
  }
  return cachedState;
}

export function getVirtualTimeState(): VirtualTimeState {
  return loadState();
}

function persist(state: VirtualTimeState): void {
  cachedState = state;
  cachedRaw = JSON.stringify(state);
  if (typeof window !== "undefined") {
    kvSet(VIRTUAL_TIME_KEY, cachedRaw);
    window.dispatchEvent(new CustomEvent(VIRTUAL_TIME_UPDATED_EVENT, { detail: state }));
  }
  for (const listener of listeners) listener();
}

export function subscribeVirtualTime(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 当前时间（realtime 模式 = 真实时间；virtual 模式 = 虚拟时间）。 */
export function getNow(): Date {
  const state = loadState();
  if (state.mode === "realtime") return new Date();
  return new Date(state.anchorVirtualMs + (Date.now() - state.anchorRealMs) * state.rate);
}

export function getNowMs(): number {
  return getNow().getTime();
}

/** 把真实时间戳映射到当前虚拟时间轴（realtime 模式下原样返回）。
 *  用于把云端按真实时钟生成的时间戳（如屏幕速聊回复）换算回小手机的虚拟时间轴，
 *  否则回端合并的消息会与本地虚拟时间戳错位，排到时间线的错误位置。 */
export function realToVirtualMs(realMs: number): number {
  if (!Number.isFinite(realMs)) return realMs;
  const state = loadState();
  if (state.mode === "realtime") return realMs;
  return state.anchorVirtualMs + (realMs - state.anchorRealMs) * state.rate;
}

export function isVirtualTimeMode(): boolean {
  return loadState().mode === "virtual";
}

// ── 变更操作 ────────────────────────────────────────────

/** 进入虚拟时间模式（若已在虚拟模式则保留当前虚拟时间，只切换模式）。 */
export function enterVirtualTime(rate?: number): void {
  const realNow = Date.now();
  const state = loadState();
  const virtualNow = state.mode === "virtual" ? getNowMs() : realNow;
  const nextRate = typeof rate === "number" && Number.isFinite(rate) ? Math.max(0, rate) : state.rate;
  persist({
    mode: "virtual",
    anchorRealMs: realNow,
    anchorVirtualMs: virtualNow,
    rate: nextRate,
  });
}

/** 恢复真实时间并跟随真实流速。 */
export function resumeRealtime(): void {
  persist({ ...DEFAULT_VIRTUAL_TIME_STATE });
}

/** 手动把虚拟时间设定到某个具体时刻（同时进入虚拟模式）。rate 缺省保留原流速。 */
export function setVirtualTime(date: Date, rate?: number): void {
  const state = loadState();
  const nextRate = typeof rate === "number" && Number.isFinite(rate) ? Math.max(0, rate) : state.rate;
  persist({
    mode: "virtual",
    anchorRealMs: Date.now(),
    anchorVirtualMs: date.getTime(),
    rate: nextRate,
  });
}

/** 推进 / 回退虚拟时间 deltaMs（相对当前虚拟时间，自动进入虚拟模式）。 */
export function advanceVirtualTime(deltaMs: number): void {
  const state = loadState();
  const currentMs = getNowMs();
  persist({
    mode: "virtual",
    anchorRealMs: Date.now(),
    anchorVirtualMs: currentMs + deltaMs,
    rate: state.rate,
  });
}

/** 调整流速（0=暂停；自动进入虚拟模式并保留当前虚拟时间）。 */
export function setVirtualRate(rate: number): void {
  const state = loadState();
  const currentMs = getNowMs();
  persist({
    mode: "virtual",
    anchorRealMs: Date.now(),
    anchorVirtualMs: currentMs,
    rate: Math.max(0, rate),
  });
}

/** 暂停虚拟时间（rate=0，冻结当前虚拟时刻）。 */
export function pauseVirtualTime(): void {
  setVirtualRate(0);
}

// ── 便捷工具 ────────────────────────────────────────────

const WEEKDAY_NAMES = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function padTwo(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 格式化为「2026年8月13日 18:20」样式的短时间（用于悬浮球/提示）。 */
export function formatVirtualTimeShort(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
}

/** 格式化为「18:20」样式。 */
export function formatVirtualClock(date: Date): string {
  return `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
}

export function getVirtualWeekday(date: Date): string {
  return WEEKDAY_NAMES[date.getDay()];
}
