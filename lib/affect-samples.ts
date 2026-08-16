// lib/affect-samples.ts
// 情绪定时采样：每 10 分钟（虚拟时间）自动抓一次情绪快照，与事件日志互补。
//   - 事件日志 = 记录"发生了什么"（不聊天就没数据）
//   - 定时采样 = 始终有数据（无论是否聊天，到点就记），供 sparkline 画趋势
// 惰性采样：不跑定时器，读情绪时检查"距上次采样是否 ≥10 分钟"，到点就补记。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import {
  advance,
  applyAutoSleep,
  buildDisplay,
  type AffectState,
  type DimLevels,
  type SleepWindow,
} from "./affect-model";

export const AFFECT_SAMPLES_KEY = "ai_phone_affect_samples_v1";
export const SAMPLE_INTERVAL_MS = 10 * 60_000; // 10 分钟
const MAX_SAMPLES_PER_OWNER = 400;             // ≈ 66 小时

registerKvMigration(AFFECT_SAMPLES_KEY);

export type AffectSample = {
  atMs: number;        // 虚拟时间戳
  display: DimLevels;  // 采样时的情绪快照
};

let cachedRaw: string | null | undefined;
let cachedSamples: Record<string, AffectSample[]> = {};

function loadAll(): Record<string, AffectSample[]> {
  if (typeof window === "undefined") return cachedSamples;
  const raw = kvGet(AFFECT_SAMPLES_KEY);
  if (raw === cachedRaw) return cachedSamples;
  cachedRaw = raw;
  if (!raw) {
    cachedSamples = {};
    return cachedSamples;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const samples: Record<string, AffectSample[]> = {};
    if (parsed && typeof parsed === "object") {
      for (const [id, list] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(list)) {
          samples[id] = list.filter(e => e && typeof e === "object" && typeof (e as AffectSample).atMs === "number");
        }
      }
    }
    cachedSamples = samples;
  } catch {
    cachedSamples = {};
  }
  return cachedSamples;
}

function persist(): void {
  cachedRaw = JSON.stringify(cachedSamples);
  if (typeof window !== "undefined") kvSet(AFFECT_SAMPLES_KEY, cachedRaw);
}

/** 距上次采样 ≥ 10 分钟（虚拟时间）则补记一条采样快照。幂等，可频繁调用。 */
export function recordSampleIfDue(ownerId: string, display: DimLevels, nowMs: number): void {
  const all = loadAll();
  const list = all[ownerId] || [];
  const last = list[list.length - 1];
  if (last && nowMs - last.atMs < SAMPLE_INTERVAL_MS) return;
  list.push({ atMs: nowMs, display: { ...display } });
  if (list.length > MAX_SAMPLES_PER_OWNER) list.splice(0, list.length - MAX_SAMPLES_PER_OWNER);
  all[ownerId] = list;
  cachedSamples = all;
  persist();
}

/**
 * 惰性补记（回填）：把 state 从 snapshotAtMs 沿时间步推进到 nowMs，
 * 每跨过一个采样间隔就补记一条。读情绪前调用（必须在 advance(state, nowMs) 之前），
 * 这样闲置 / 离线 / 拨快虚拟时间期间的曲线也会被补全，而不是只有读的那一刻一个点。
 */
export function recordSamplesDuringCatchUp(
  ownerId: string,
  state: AffectState,
  nowMs: number,
  sleepWindow: SleepWindow,
): void {
  if (nowMs <= state.snapshotAtMs) return;

  const all = loadAll();
  const list = all[ownerId] || [];
  const last = list[list.length - 1];

  // 补记窗口起点：上次采样点 / 上次快照点，最近 MAX_SAMPLES 个间隔封顶（防超长间隔一步算爆）
  let startFrom = Math.max(last?.atMs ?? state.snapshotAtMs, state.snapshotAtMs);
  const horizonStart = nowMs - MAX_SAMPLES_PER_OWNER * SAMPLE_INTERVAL_MS;
  if (startFrom < horizonStart) startFrom = horizonStart;
  if (nowMs - startFrom < SAMPLE_INTERVAL_MS) return;

  // 先把状态单跳到窗口起点，再逐格推进补记（advance 内部会更新 display / snapshotAtMs）
  advance(state, startFrom);
  applyAutoSleep(state, startFrom, sleepWindow);

  let t = startFrom + SAMPLE_INTERVAL_MS;
  while (t <= nowMs) {
    advance(state, t);
    applyAutoSleep(state, t, sleepWindow);
    list.push({ atMs: t, display: { ...(state.display ?? buildDisplay(state, t)) } });
    t += SAMPLE_INTERVAL_MS;
  }
  while (list.length > MAX_SAMPLES_PER_OWNER) list.splice(0, list.length - MAX_SAMPLES_PER_OWNER);

  all[ownerId] = list;
  cachedSamples = all;
  persist();
}

/** 清除某角色的采样（角色被删除时调用）。 */
export function resetAffectSamples(ownerId: string): void {
  const all = loadAll();
  if (all[ownerId]) {
    delete all[ownerId];
    cachedSamples = all;
    persist();
  }
}

/** 某角色的采样序列（旧 → 新）。 */
export function getAffectSamples(ownerId: string): AffectSample[] {
  return loadAll()[ownerId] || [];
}
