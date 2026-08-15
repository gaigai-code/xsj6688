"use client";

// 控制浮球：把虚拟时间 / 情绪调试两个面板收进一个低调的玻璃浮球。
// 浮球可拖动，无文字；点开在浮球上方弹出一个小浮层（参考小卷悬浮球），不占满半屏。

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Clock, Heart, SlidersHorizontal, X } from "lucide-react";
import { VirtualTimePanel } from "./virtual-time-panel";
import { AffectPanel } from "./affect-panel";

type Tab = "time" | "affect";

const BALL_SIZE = 40;
const DEFAULT_RIGHT = 12;
const DEFAULT_BOTTOM = 164;

export function ControlSideRail() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("time");
  const [floatPos, setFloatPos] = useState<{ left: number; top: number } | null>(null);
  const dragState = useRef<{ startX: number; startY: number; startLeft: number; startTop: number; moved: boolean } | null>(null);
  const floatRef = useRef<HTMLButtonElement | null>(null);

  function handlePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    const el = floatRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const shell = el.closest("[data-ui='phone-screen']") as HTMLElement | null;
    const shellRect = shell?.getBoundingClientRect();
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left - (shellRect?.left ?? 0),
      startTop: rect.top - (shellRect?.top ?? 0),
      moved: false,
    };
    el.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragState.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      if (!drag.moved) {
        drag.moved = true;
        setOpen(false);
      }
    }
    if (drag.moved) {
      setFloatPos({ left: drag.startLeft + dx, top: drag.startTop + dy });
    }
  }

  function handlePointerUp() {
    const wasDrag = dragState.current?.moved ?? false;
    dragState.current = null;
    if (!wasDrag) setOpen((o) => !o);
  }

  function panelGeometry() {
    const el = floatRef.current;
    const shell = el?.closest("[data-ui='phone-screen']") as HTMLElement | null;
    const shellRect = shell?.getBoundingClientRect();
    const ballRect = el?.getBoundingClientRect();
    const shellW = shellRect?.width ?? 390;
    const shellH = shellRect?.height ?? 844;
    const ballLeft = (ballRect?.left ?? 0) - (shellRect?.left ?? 0);
    const ballTop = (ballRect?.top ?? 0) - (shellRect?.top ?? 0);
    const panelW = Math.min(300, shellW * 0.8);
    const onRight = ballLeft > shellW / 2;
    const pLeft = onRight ? Math.max(8, ballLeft + BALL_SIZE - panelW) : Math.min(ballLeft, shellW - panelW - 8);
    const pBottom = shellH - ballTop + 8;
    return { left: pLeft, bottom: pBottom, width: panelW };
  }

  const ballStyle: CSSProperties = floatPos
    ? { left: floatPos.left, top: floatPos.top, right: "auto", bottom: "auto" }
    : { right: DEFAULT_RIGHT, bottom: DEFAULT_BOTTOM };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 100001, pointerEvents: "none" }}>
      {/* 面板打开时的点击遮罩（点击空白关闭） */}
      {open ? (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "auto" }} onClick={() => setOpen(false)} />
      ) : null}

      {/* 玻璃浮球 */}
      <button
        ref={floatRef}
        type="button"
        aria-label="控制面板"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          ...ballStyle,
          position: "absolute", pointerEvents: "auto",
          width: BALL_SIZE, height: BALL_SIZE, borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.18)", cursor: "grab",
          touchAction: "none", userSelect: "none", WebkitUserSelect: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.85)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
        }}
      >
        <SlidersHorizontal size={18} />
      </button>

      {/* 玻璃小浮层 */}
      {open ? (() => {
        const geo = panelGeometry();
        return (
          <div
            role="dialog"
            aria-label="控制面板"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute", pointerEvents: "auto",
              left: geo.left, bottom: geo.bottom, width: geo.width,
              maxHeight: "min(480px, 66vh)", overflowY: "auto",
              background: "rgba(22,24,32,0.78)", color: "#e5e7eb",
              border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16,
              padding: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
              animation: "control-rail-in 0.22s ease",
              transformOrigin: "right bottom",
            }}
          >
            <style>{`
              @keyframes control-rail-in {
                from { opacity: 0; transform: translateY(10px) scale(0.96); }
                to { opacity: 1; transform: translateY(0) scale(1); }
              }
            `}</style>

            {/* tab + 关闭 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => setTab("time")} style={tabStyle(tab === "time")}>
                  <Clock size={15} style={{ marginRight: 4 }} />
                  时间
                </button>
                <button type="button" onClick={() => setTab("affect")} style={tabStyle(tab === "affect")}>
                  <Heart size={15} style={{ marginRight: 4 }} />
                  情绪
                </button>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#cbd5e1", cursor: "pointer", padding: 5, borderRadius: 8, display: "flex" }}
              >
                <X size={15} />
              </button>
            </div>

            {tab === "time" ? <VirtualTimePanel /> : <AffectPanel />}
          </div>
        );
      })() : null}
    </div>
  );
}

const tabStyle = (active: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  padding: "7px 11px",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  background: active ? "rgba(124,58,237,0.55)" : "rgba(255,255,255,0.08)",
  color: active ? "#fff" : "#cbd5e1",
});
