// lib/affect-context.ts
// 把情绪状态翻译成「内心状态」文本，注入角色 system prompt（[drives] 块）。
// 只列出显著偏离性情锚点的维度，避免噪音；无显著情绪时返回空串（不注入）。

import { DIMS, type AffectDim } from "./affect-model";
import { getAffectDisplay, getAffectMeta } from "./affect-store";

const DIM_LABELS: Record<AffectDim, string> = {
  vitality: "精力",
  longing: "想念",
  intimacy: "亲近感",
  possessiveness: "占有欲",
  lust: "欲望",
  jealousy: "吃醋",
  anxiety: "焦虑",
  protectiveness: "保护欲",
  contentment: "安心",
  elation: "兴奋",
  seeking: "想找人/找事",
  play: "玩心",
  dejection: "低落",
  irritability: "烦躁",
  fear: "恐惧",
};

// 注入顺序：情绪色彩强的在前，保证描述读起来自然
const DIM_ORDER: AffectDim[] = [
  "anxiety", "irritability", "dejection", "fear",
  "contentment", "elation", "longing", "intimacy", "possessiveness", "jealousy",
  "play", "seeking", "protectiveness", "vitality", "lust",
];

const NOTABLE_THRESHOLD = 0.15;
const NEGATIVE_DIMS = new Set<AffectDim>(["anxiety", "irritability", "dejection", "fear", "jealousy"]);

function describeLevel(diff: number): string {
  const strength = Math.abs(diff);
  if (strength >= 0.25) return diff > 0 ? "明显偏高" : "明显偏低";
  return diff > 0 ? "偏高" : "偏低";
}

/** 返回纯情绪描述（无标题、无前缀），空串表示无显著情绪。供单人注入与群聊列表复用。 */
export function buildAffectSummary(ownerId: string): string {
  let display;
  let meta;
  try {
    display = getAffectDisplay(ownerId);
    meta = getAffectMeta(ownerId);
  } catch {
    return "";
  }

  const parts: string[] = [];
  const feelings: string[] = [];

  for (const k of DIM_ORDER) {
    const neutral = DIMS[k].neutral;
    const diff = display[k] - neutral;
    if (Math.abs(diff) < NOTABLE_THRESHOLD) continue;
    // 负性维度只在「偏高」时提示（偏低=放松，无需注入）
    if (NEGATIVE_DIMS.has(k) && diff <= 0) continue;
    feelings.push(`${DIM_LABELS[k]}${describeLevel(diff)}`);
  }
  if (feelings.length > 0) parts.push(feelings.join("、"));

  // 睡眠不足 → 疲惫/略烦躁
  if (meta.sleepDurationHours < 6.5) {
    parts.push(`昨晚只睡了约 ${meta.sleepDurationHours.toFixed(1)} 小时，更易累、更没耐心`);
  }

  // 挫败（亲密意图被拒的累积）
  if (meta.frustration >= 0.5) {
    parts.push("对亲密关系有些挫败，容易患得患失");
  }

  return parts.join("；");
}

/** 单人版：带 [内心状态] 标题的完整注入块。 */
export function buildAffectContext(ownerId: string): string {
  const summary = buildAffectSummary(ownerId);
  if (!summary) return "";
  return `\n[内心状态]\n此刻内心：${summary}。\n（以上是你当前的情绪底色，自然地融进回复，不要逐条照念。）`;
}
