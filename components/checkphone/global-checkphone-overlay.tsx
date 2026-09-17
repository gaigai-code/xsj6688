"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  getCheckPhoneOverlay,
  subscribeCheckPhoneOverlay,
  setCheckPhoneOverlayMinimized,
  endCheckPhoneOverlay,
  type CheckPhoneOverlay,
} from "@/lib/checkphone-overlay-store";
import { loadCharacters } from "@/lib/character-storage";
import { CheckPhoneApp } from "./checkphone-app";

// 全局「查手机」悬浮窗 overlay：挂在桌面壳的 .phone-shell 内（聊天 App 之外），
// 使查手机在聊天、退出聊天 App、切到桌面或其它 App 后仍常驻。
// 状态来自 lib/checkphone-overlay-store.ts，ChatRoom 只负责 startCheckPhoneOverlay 触发。
export function GlobalCheckPhoneOverlay() {
    const [overlay, setOverlay] = useState<CheckPhoneOverlay>(() => getCheckPhoneOverlay());

    useEffect(() => subscribeCheckPhoneOverlay(() => setOverlay(getCheckPhoneOverlay())), []);

    const character = useMemo(() => {
        if (!overlay) return null;
        return loadCharacters().find((c) => c.id === overlay.characterId) ?? null;
    }, [overlay?.characterId]);

    // 角色被删等异常兜底：关闭 overlay，避免悬空
    useEffect(() => {
        if (overlay && !character) {
            endCheckPhoneOverlay();
        }
    }, [overlay, character]);

    if (!overlay || !character) return null;

    const handleClose = () => endCheckPhoneOverlay();
    const handleMinimize = () => setCheckPhoneOverlayMinimized(true);
    const handleRestore = () => setCheckPhoneOverlayMinimized(false);

    // 缩小为悬浮球：挂到手机屏幕容器（而非某个 App 内部），退出聊天框后仍常驻。
    if (overlay.minimized) {
        const mini = (
            <button
                type="button"
                className="cp-mini-window"
                style={{ backgroundImage: `url(${character.avatar || ""})` }}
                onClick={handleRestore}
                aria-label={`恢复查看${character.name}的手机`}
                title="点击展开查手机"
            >
                <span className="cp-mini-window-overlay" />
                <span className="cp-mini-window-name">{character.name}</span>
            </button>
        );
        const host = typeof document !== "undefined"
            ? document.querySelector<HTMLElement>("[data-ui='phone-screen']")
            : null;
        return host ? createPortal(mini, host) : mini;
    }

    return (
        <div className="absolute inset-0 z-[90]">
            <CheckPhoneApp
                floating
                initialCharacterId={character.id}
                onMinimize={handleMinimize}
                onClose={handleClose}
            />
        </div>
    );
}
