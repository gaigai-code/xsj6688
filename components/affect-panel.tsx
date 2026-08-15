"use client";

// 情绪调试面板（内容组件）：供侧边栏 ControlSideRail 收纳。
// 两层折叠结构：第一层只列角色名（含睡眠/挫败摘要），点开角色名才展开该角色的情绪维度。

import { useEffect, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import { getAffectDisplay, getAffectMeta, subscribeAffect, MASCOT_OWNER_ID } from "@/lib/affect-store";
import { getAffectHistory } from "@/lib/affect-history";
import { AFFECT_DIMS, DIMS, type AffectDim } from "@/lib/affect-model";

function formatClock(atMs: number): string {
  const d = new Date(atMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const DIM_NAMES: Record<AffectDim, string> = {
  vitality: "活力", longing: "思念", intimacy: "亲密", possessiveness: "占有", lust: "欲望",
  jealousy: "嫉妒", anxiety: "焦虑", protectiveness: "保护", contentment: "安心", elation: "喜悦",
  seeking: "求索", play: "玩心", dejection: "低落", irritability: "烦躁", fear: "恐惧",
};

function Bar({ label, value, neutral }: { label: string; value: number; neutral: number }) {
  return (
    <div style={{ marginBottom: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#cbd5e1", lineHeight: 1.4 }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{value.toFixed(2)}</span>
      </div>
      <div style={{ position: "relative", height: 5, borderRadius: 3, background: "rgba(255,255,255,0.08)" }}>
        <div
          style={{
            position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 3,
            width: `${Math.min(100, Math.max(0, value * 100))}%`,
            background: value >= neutral ? "#34d399" : "#f472b6",
          }}
        />
        <div style={{ position: "absolute", left: `${neutral * 100}%`, top: -2, bottom: -2, width: 1, background: "rgba(255,255,255,0.45)" }} />
      </div>
    </div>
  );
}

function ownerRows() {
  const rows = [{ id: MASCOT_OWNER_ID, name: "小卷" }];
  try {
    for (const c of loadCharacters()) rows.push({ id: c.id, name: c.name || "(未命名)" });
  } catch {
    // 忽略角色读取失败
  }
  return rows;
}

export function AffectPanel() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [, force] = useState(0);

  useEffect(() => {
    const unsub = subscribeAffect(() => force((n) => n + 1));
    const timer = setInterval(() => force((n) => n + 1), 1000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      {ownerRows().map((owner) => {
        const meta = getAffectMeta(owner.id);
        const isOpen = expanded.has(owner.id);
        const sleepLabel =
          meta.sleepStatus === "asleep" ? "😴 睡着"
            : meta.sleepStatus === "interrupted" ? "😵 惊醒"
            : `挫败 ${meta.frustration.toFixed(1)}`;
        return (
          <div key={owner.id} style={{ marginBottom: 8, borderRadius: 12, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => toggle(owner.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "10px 12px", background: "transparent", border: "none", cursor: "pointer",
                color: "#e5e7eb", textAlign: "left",
              }}
            >
              {isOpen ? <ChevronDown size={16} style={{ color: "#9ca3af" }} /> : <ChevronRight size={16} style={{ color: "#9ca3af" }} />}
              <strong style={{ fontSize: 14, flex: 1 }}>{owner.name}</strong>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>{sleepLabel}</span>
            </button>

            {isOpen ? (
              <div style={{ padding: "0 12px 10px" }}>
                {(() => {
                  const display = getAffectDisplay(owner.id);
                  return AFFECT_DIMS.map((k) => (
                    <Bar key={k} label={DIM_NAMES[k]} value={display[k]} neutral={DIMS[k].neutral} />
                  ));
                })()}
                {(() => {
                  const history = getAffectHistory(owner.id).slice(0, 8);
                  if (history.length === 0) return null;
                  return (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>最近记录</div>
                      {history.map((h, i) => (
                        <div
                          key={`${h.atMs}-${i}`}
                          style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#cbd5e1", lineHeight: 1.6 }}
                        >
                          <span style={{ color: "#9ca3af", marginRight: 6, fontVariantNumeric: "tabular-nums" }}>{formatClock(h.atMs)}</span>
                          <span style={{ flex: 1 }}>{h.text}</span>
                          <span style={{ color: "#9ca3af", fontVariantNumeric: "tabular-nums" }}>焦 {h.display.anxiety.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
