// lib/affect-state-values.ts
// 情绪引擎 ↔ 原有状态值 融合桥。
//
// 原来 xsj 的角色状态值（[好感度:X][焦虑值:X][占有欲:X]）由 LLM 自主边演边报；
// 本模块让 affect 引擎成为「情绪类状态值」的真相源：把实时情绪映射成状态值字段，
// 覆盖喂给 LLM 的初始状态（LLM 输出时以此为准），从而两套数值合流、不再打架。
//
// 融合口径：
//   - 焦虑值     ← affect.anxiety（当前焦虑，瞬时情绪）
//   - 占有欲     ← affect.possessiveness（当前占有欲，瞬时情绪）
//   - 好感度等其它字段：保留 LLM 自主演（好感度是「关系累计值」，非瞬时情绪，不覆盖）

import { getAffectDisplay } from "./affect-store";
import { mergeStateValues } from "./state-value-parser";
import type { StateValue } from "./chat-storage";

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0;
}

/** 把某角色的当前情绪映射成状态值字段（0-100）。 */
export function affectToStateValues(ownerId: string): StateValue[] {
  let display;
  try {
    display = getAffectDisplay(ownerId);
  } catch {
    return [];
  }
  return [
    { name: "焦虑值", value: Math.round(clamp01(display.anxiety) * 100) },
    { name: "占有欲", value: Math.round(clamp01(display.possessiveness) * 100) },
  ];
}

/** 用情绪值覆盖已有状态值里的「焦虑值/占有欲」，其它字段（好感度等）保留。 */
export function mergeAffectIntoStateValues(ownerId: string, existing: StateValue[]): StateValue[] {
  return mergeStateValues(existing, affectToStateValues(ownerId));
}
