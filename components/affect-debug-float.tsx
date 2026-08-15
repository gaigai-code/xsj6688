"use client";

// 情绪调试悬浮面板：可视化小卷 + 所有角色卡的当前情绪（15 维 + 疲劳 + 挫败）。
// 与 VirtualTimeFloat / MascotFloat / QuickActionFloat 同级挂载在 desktop-shell。
// 每秒刷新（情绪惰性 catch-up，读时推进），可在开发期观察情绪曲线。

import { useEffect, useState, type CSSProperties } from "react";
import { Heart, X } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import { getAffectDisplay, getAffectMeta, subscribeAffect, MASCOT_OWNER_ID } from "@/lib/affect-store";
import { AFFECT_DIMS, DIMS, type AffectDim } from "@/lib/affect-model";

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
        {/* 性情锚点刻度 */}
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

export function AffectDebugFloat() {
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    const unsub = subscribeAffect(() => force((n) => n + 1));
    const timer = setInterval(() => force((n) => n + 1), 1000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 100002, pointerEvents: "none" }}>
      <button
        type="button"
        aria-label="情绪调试"
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "absolute", left: 14, bottom: 256, pointerEvents: "auto",
          width: 44, height: 44, borderRadius: 999, border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "linear-gradient(135deg, #f43f5e, #db2777)", color: "#fff",
          boxShadow: "0 6px 20px rgba(0,0,0,0.28)",
        }}
      >
        <Heart size={19} strokeWidth={2} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="情绪调试面板"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute", pointerEvents: "auto", left: 12, right: 12, bottom: 308,
            maxHeight: "calc(100% - 360px)", overflowY: "auto",
            background: "rgba(24,26,34,0.96)", color: "#e5e7eb", borderRadius: 20,
            padding: 16, boxShadow: "0 12px 40px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Heart size={18} />
              <strong style={{ fontSize: 15 }}>情绪调试</strong>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭"
              style={{ background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer", padding: 4 }}
            >
              <X size={18} />
            </button>
          </div>

          {ownerRows().map((owner) => {
            const meta = getAffectMeta(owner.id);
            const display = getAffectDisplay(owner.id);
            const sleepLabel =
              meta.sleepStatus === "asleep" ? "😴 睡着"
                : meta.sleepStatus === "interrupted" ? "😵 惊醒"
                : `挫败 ${meta.frustration.toFixed(1)}`;
            return (
              <div key={owner.id} style={{ marginBottom: 14, padding: 12, borderRadius: 14, background: "rgba(255,255,255,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong style={{ fontSize: 14 }}>{owner.name}</strong>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>{sleepLabel}</span>
                </div>
                {AFFECT_DIMS.map((k) => (
                  <Bar key={k} label={DIM_NAMES[k]} value={display[k]} neutral={DIMS[k].neutral} />
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
