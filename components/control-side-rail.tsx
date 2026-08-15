"use client";

// 控制侧边栏：把散落的悬浮控制面板统一收纳。
// 隐藏把手贴在屏幕右侧边缘，点击从右侧滑出面板，内含「虚拟时间 / 情绪调试」两个入口。
// 取代原先独立的 VirtualTimeFloat 与 AffectDebugFloat 悬浮球。

import { useState, type CSSProperties } from "react";
import { Clock, Heart, SlidersHorizontal, X } from "lucide-react";
import { VirtualTimePanel } from "./virtual-time-panel";
import { AffectPanel } from "./affect-panel";

type Tab = "time" | "affect";

export function ControlSideRail() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("time");

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 100001, pointerEvents: "none" }}>
      {/* 隐藏把手（贴右边缘） */}
      <button
        type="button"
        aria-label="控制面板"
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "absolute", right: 0, top: "40%", pointerEvents: "auto",
          width: 28, height: 104, border: "none", cursor: "pointer",
          borderRadius: "14px 0 0 14px",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
          background: "linear-gradient(180deg, #7c3aed, #db2777)", color: "#fff",
          boxShadow: "0 6px 20px rgba(0,0,0,0.28)",
        }}
      >
        <SlidersHorizontal size={17} />
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, writingMode: "vertical-rl" }}>控制</span>
      </button>

      {/* 展开面板 */}
      {open ? (
        <div
          role="dialog"
          aria-label="控制面板"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute", right: 0, top: 0, bottom: 0, width: 320, maxWidth: "94%",
            pointerEvents: "auto",
            background: "rgba(24,26,34,0.97)", color: "#e5e7eb",
            boxShadow: "0 0 44px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)",
            display: "flex", flexDirection: "column",
            padding: 14,
            overflowY: "auto",
          }}
        >
          {/* 顶部：关闭 + tab */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setTab("time")} style={tabStyle(tab === "time")}>
                <Clock size={15} style={{ marginRight: 5 }} />
                虚拟时间
              </button>
              <button type="button" onClick={() => setTab("affect")} style={tabStyle(tab === "affect")}>
                <Heart size={15} style={{ marginRight: 5 }} />
                情绪调试
              </button>
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

          {/* 内容 */}
          <div style={{ flex: 1, minHeight: 0 }}>
            {tab === "time" ? <VirtualTimePanel /> : <AffectPanel />}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const tabStyle = (active: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  padding: "8px 12px",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  background: active ? "#7c3aed" : "rgba(255,255,255,0.08)",
  color: active ? "#fff" : "#cbd5e1",
});
