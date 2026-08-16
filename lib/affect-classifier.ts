// lib/affect-classifier.ts
// 情绪分类器：把一条用户消息归到 16 类标签之一，驱动情绪维度变化。
//
//   - 主路径：LLM 分类（simpleLLMCall，temperature 0，极便宜），提示词照搬 Drivesoid。
//   - 降级：规则关键词启发式（LLM 失败 / 无 config 时兜底）。
//   - 永不 throw：调用方（聊天链路）应 fire-and-forget，本模块保证不打断主回复。

import { simpleLLMCall } from "./api-helpers";
import type { ApiConfig } from "./settings-types";
import type { AffectLabel } from "./affect-model";

export const AFFECT_LABELS: AffectLabel[] = [
  "affectionate", "playful", "vulnerable", "reassuring",
  "cold", "conflict", "distant", "struggling",
  "intimate_reference", "intimate_event", "neutral", "hostile",
  "fear_separation", "fear_death", "fear_concern", "fear_general",
];

const VALID_LABELS = new Set<string>(AFFECT_LABELS);

const SYSTEM_PROMPT = `You are an emotion classifier. Analyze the conversation context and choose the single best label for the [CLASSIFY] message. Output JSON: {"label":"<label>","confidence":<0 to 1>}

Labels:
- affectionate: warm, loving, expressing care or affection
- playful: teasing, joking, playful banter (including mock threats)
- vulnerable: expressing vulnerability, insecurity, or emotional fragility
- reassuring: comforting, affirming, offering support
- cold: emotionally withdrawn, detached, terse without warmth (distinct from neutral's lack of tone)
- conflict: genuine mutual argument, emotional escalation, hurtful words exchanged both ways
- distant: distracted, disengaged, doesn't want to talk
- struggling: expressing stress, exhaustion, feeling unable to cope
- intimate_reference: referencing physical intimacy or the body
- intimate_event: actively engaged in an intimate interaction right now
- neutral: ordinary everyday response, no notable emotional tone, normal online presence
- hostile: one-sided attack, mockery, or harsh words directed at the other person (distinct from conflict's mutual nature)
- fear_separation: expressing fear of separation, fear of the other person leaving or being absent
- fear_death: referencing fear of death — one's own, another's, suicide, serious accident, or life-threatening situations
- fear_concern: worrying about something bad happening to the other person, wanting to protect them from danger or hardship
- fear_general: other fears or fright that don't fit the above categories

Rules:
- Output JSON only, no other content
- Classify only the [CLASSIFY] message; context is for reference only
- confidence reflects certainty; can be as low as 0.4 when unsure
- When the message is plain and unremarkable, use neutral
- fear_* labels take priority over struggling when the core emotion is fear rather than stress
- Mentions of death, suicide, major accidents, or life threats prefer fear_death
- vulnerable is for fragility, hurt, or insecurity; when the core meaning is death, danger, or fear, choose the matching fear_* label

Chinese emotion hints (the message may be written in Chinese):
- 焦虑/担心/紧张/着急/心慌/不安 = anxious → vulnerable or fear_concern (NOT neutral)
- 生气/愤怒/火大/气死 = angry → hostile or conflict (NOT neutral)
- 烦躁/心烦/闹心 = irritated → struggling
- 难过/委屈/失望/失落 = hurt/disappointed → vulnerable
- 孤独/寂寞/孤单 = lonely → distant
- 吃醋/嫉妒 = jealous → conflict
- 口语化的负面情绪不要轻易归为 neutral；只有真正平淡无奇的日常回复才用 neutral

The [SCENE] block (when present) describes the character's personality and recent plot. Use it to judge how the [CLASSIFY] message affects THIS character emotionally — the same words can mean different emotions for different characters.`;

export type AffectClassification = {
  label: AffectLabel;
  confidence: number;
  fallback: boolean;
};

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0.6;
}

function buildUserMessage(text: string, context?: string[], sceneText?: string): string {
  const ctx = (context || []).filter(Boolean);
  const blocks: string[] = [];
  if (sceneText && sceneText.trim()) {
    blocks.push(`[SCENE]\n${sceneText.trim()}`);
  }
  if (ctx.length) {
    blocks.push("[CONTEXT]", ...ctx);
  }
  blocks.push(`[CLASSIFY]\n${text}`);
  return blocks.join("\n");
}

function parseLabel(content: string): { label: AffectLabel; confidence: number } | null {
  const cleaned = content
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  try {
    const obj = JSON.parse(cleaned) as { label?: unknown; confidence?: unknown };
    if (typeof obj.label === "string" && VALID_LABELS.has(obj.label) && typeof obj.confidence === "number") {
      return { label: obj.label as AffectLabel, confidence: clamp01(obj.confidence) };
    }
  } catch {
    // fallthrough to substring match
  }
  // 兜底：从正文里找 label 词
  const match = cleaned.match(/"(label)"\s*:\s*"([a-z_]+)"/);
  if (match && VALID_LABELS.has(match[2])) {
    return { label: match[2] as AffectLabel, confidence: 0.6 };
  }
  return null;
}

// ── 规则降级分类器 ────────────────────────────────────────────────────────────

type Rule = { label: AffectLabel; patterns: RegExp[] };

const RULES: Rule[] = [
  { label: "fear_death", patterns: [/死/, /自杀/, /不想活/, /活不下去/, /跳楼/, /割腕/, /杀了我/, /轻生/] },
  { label: "fear_separation", patterns: [/别离开/, /不要走/, /离开我/, /别丢下/, /分手/, /不要抛弃/] },
  { label: "fear_concern", patterns: [/你没事吧/, /担心你/, /别出事/, /注意安全/, /怕你受伤/] },
  { label: "hostile", patterns: [/滚/, /讨厌你/, /恶心/, /去死/, /闭嘴/, /废物/, /傻逼/, /生气/, /气死/, /火大/, /愤怒/, /发火/, /暴怒/] },
  { label: "struggling", patterns: [/好累/, /撑不住/, /压力好大/, /崩溃/, /快不行了/, /烦躁/, /心烦/, /闹心/, /心累/] },
  { label: "vulnerable", patterns: [/害怕/, /难过/, /委屈/, /不安/, /没安全感/, /好怕/, /焦虑/, /紧张/, /着急/, /担心/, /心慌/, /焦躁/, /失望/, /失落/, /心寒/] },
  { label: "reassuring", patterns: [/没事的/, /别怕/, /有我在/, /抱抱/, /我在呢/, /会好的/] },
  { label: "affectionate", patterns: [/爱你/, /想你/, /宝贝/, /亲亲/, /喜欢你/, /么么哒/, /抱抱你/] },
  { label: "playful", patterns: [/哈哈/, /开玩笑/, /逗你/, /略略略/, /皮一下/] },
  { label: "conflict", patterns: [/吃醋/, /嫉妒/, /酸了/] },
  { label: "cold", patterns: [/哦/, /随便/, /无所谓/, /嗯/] },
  { label: "distant", patterns: [/在忙/, /没空/, /别烦我/, /不想聊/, /孤独/, /寂寞/, /孤单/] },
];

export function ruleClassify(text: string): { label: AffectLabel; confidence: number } {
  const t = text.trim();
  for (const rule of RULES) {
    if (rule.patterns.some(p => p.test(t))) {
      return { label: rule.label, confidence: 0.7 };
    }
  }
  return { label: "neutral", confidence: 0.5 };
}

export async function classifyAffectLabel(
  config: ApiConfig | null,
  text: string,
  context?: string[],
  sceneText?: string,
): Promise<AffectClassification> {
  if (config && config.apiKey && text.trim()) {
    try {
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(text, context, sceneText) },
      ];
      const res = await simpleLLMCall(config, messages, { temperature: 0, max_tokens: 500 });
      if (res.content) {
        const parsed = parseLabel(res.content);
        if (parsed) return { ...parsed, fallback: false };
      }
    } catch {
      // fall through to rules
    }
  }
  return { ...ruleClassify(text), fallback: true };
}
