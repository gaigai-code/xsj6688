"use client";

// 虚拟时间面板（内容组件）：从 virtual-time-float 抽取，供侧边栏 ControlSideRail 收纳。
// 不含悬浮球与拖动逻辑，不含绝对定位（由父容器决定摆放）。

import { useCallback, useState, type CSSProperties } from "react";
import { RotateCcw } from "lucide-react";
import {
    advanceVirtualTime,
    enterVirtualTime,
    formatVirtualClock,
    formatVirtualTimeShort,
    getNow,
    getVirtualWeekday,
    resumeRealtime,
    setVirtualRate,
    setVirtualTime,
} from "@/lib/virtual-time";
import { useVirtualNow, useVirtualTimeState } from "@/lib/virtual-time-hooks";

const RATE_PRESETS = [
    { label: "暂停", rate: 0 },
    { label: "0.5x", rate: 0.5 },
    { label: "1x", rate: 1 },
    { label: "2x", rate: 2 },
    { label: "5x", rate: 5 },
    { label: "10x", rate: 10 },
];

const QUICK_ADVANCES = [
    { label: "+5分", ms: 5 * 60_000 },
    { label: "+1时", ms: 60 * 60_000 },
    { label: "+3时", ms: 3 * 60 * 60_000 },
    { label: "+6时", ms: 6 * 60 * 60_000 },
    { label: "+1天", ms: 24 * 60 * 60_000 },
];

function padTwo(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
}

function toDateInputValue(date: Date): string {
    return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`;
}

function toTimeInputValue(date: Date): string {
    return `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(min, value), max);
}

export function VirtualTimePanel() {
    const now = useVirtualNow(1000);
    const state = useVirtualTimeState();
    const isVirtual = state.mode === "virtual";

    const [dateStr, setDateStr] = useState(() => toDateInputValue(getNow()));
    const [timeStr, setTimeStr] = useState(() => toTimeInputValue(getNow()));

    const syncInputsToNow = useCallback(() => {
        const d = getNow();
        setDateStr(toDateInputValue(d));
        setTimeStr(toTimeInputValue(d));
    }, []);

    function handleSet() {
        const dateMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateStr.trim());
        const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
        if (!dateMatch || !timeMatch) return;
        const date = new Date(
            Number(dateMatch[1]),
            Number(dateMatch[2]) - 1,
            Number(dateMatch[3]),
            Number(timeMatch[1]),
            Number(timeMatch[2]),
            0,
            0,
        );
        if (Number.isNaN(date.getTime())) return;
        setVirtualTime(date);
    }

    function handleJumpNextMorning() {
        const d = getNow();
        const target = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 8, 0, 0, 0);
        advanceVirtualTime(target.getTime() - d.getTime());
    }

    function handleJumpEvening() {
        const d = getNow();
        let target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 20, 0, 0, 0);
        if (target.getTime() <= d.getTime()) {
            target = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 20, 0, 0, 0);
        }
        advanceVirtualTime(target.getTime() - d.getTime());
    }

    const rateLabel = !isVirtual ? "真实时间" : (state.rate === 0 ? "已暂停" : `${state.rate}x`);

    return (
        <div>
            {/* 模式切换 */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button type="button" onClick={() => resumeRealtime()} style={modeButtonStyle(!isVirtual)}>
                    真实时间
                </button>
                <button type="button" onClick={() => enterVirtualTime()} style={modeButtonStyle(isVirtual)}>
                    虚拟时间
                </button>
            </div>

            {/* 大时钟 */}
            <div style={{ textAlign: "center", margin: "8px 0 14px" }}>
                <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, letterSpacing: 1 }}>
                    {formatVirtualClock(now)}
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: "#9ca3af" }}>
                    {formatVirtualTimeShort(now)} {getVirtualWeekday(now)} · {rateLabel}
                </div>
            </div>

            {/* 设定时间 */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
                <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} style={inputStyle} />
                <input type="time" value={timeStr} onChange={e => setTimeStr(e.target.value)} style={inputStyle} />
                <button type="button" onClick={handleSet} style={primaryButtonStyle}>
                    设定
                </button>
            </div>

            {/* 流速 */}
            <div style={{ marginBottom: 14 }}>
                <div style={sectionLabelStyle}>流速</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {RATE_PRESETS.map(preset => (
                        <button
                            key={preset.rate}
                            type="button"
                            onClick={() => setVirtualRate(preset.rate)}
                            style={chipStyle(isVirtual && state.rate === preset.rate)}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 快捷推进 */}
            <div style={{ marginBottom: 14 }}>
                <div style={sectionLabelStyle}>快捷推进</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {QUICK_ADVANCES.map(item => (
                        <button
                            key={item.ms}
                            type="button"
                            onClick={() => advanceVirtualTime(item.ms)}
                            style={chipStyle(false)}
                        >
                            {item.label}
                        </button>
                    ))}
                    <button type="button" onClick={handleJumpEvening} style={chipStyle(false)}>
                        跳到当晚
                    </button>
                    <button type="button" onClick={handleJumpNextMorning} style={chipStyle(false)}>
                        跳到明早
                    </button>
                </div>
            </div>

            {/* 恢复真实时间 */}
            <button type="button" onClick={() => { resumeRealtime(); syncInputsToNow(); }} style={fullWidthButtonStyle}>
                <RotateCcw size={15} style={{ marginRight: 6 }} />
                恢复真实时间
            </button>
        </div>
    );
}

const modeButtonStyle = (active: boolean): CSSProperties => ({
    flex: 1,
    padding: "8px 0",
    borderRadius: 12,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    background: active ? "#7c3aed" : "rgba(255,255,255,0.08)",
    color: active ? "#fff" : "#cbd5e1",
});

const inputStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#f1f5f9",
    fontSize: 13,
};

const primaryButtonStyle: CSSProperties = {
    padding: "8px 14px",
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    background: "#7c3aed",
    color: "#fff",
};

const sectionLabelStyle: CSSProperties = {
    fontSize: 12,
    color: "#9ca3af",
    marginBottom: 6,
};

const chipStyle = (active: boolean): CSSProperties => ({
    padding: "6px 10px",
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    background: active ? "#7c3aed" : "rgba(255,255,255,0.08)",
    color: active ? "#fff" : "#cbd5e1",
});

const fullWidthButtonStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    padding: "10px 0",
    borderRadius: 12,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    background: "rgba(255,255,255,0.08)",
    color: "#e5e7eb",
};
