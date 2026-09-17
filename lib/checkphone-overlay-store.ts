// lib/checkphone-overlay-store.ts
// 全局「查手机」悬浮窗 store：把查手机从桌面 App 提升到应用顶层，
// 使它在聊天、退出聊天 App、切到桌面或其它 App 后仍常驻（悬浮窗不消失）。
// 轻量模块级状态 + 监听器，模式同 lib/call-store.ts。

export type CheckPhoneOverlay = {
    characterId: string;
    /** 是否缩小为悬浮球（点击恢复全屏） */
    minimized: boolean;
} | null;

let _overlay: CheckPhoneOverlay = null;

const _listeners = new Set<() => void>();

function notifyListeners(): void {
    _listeners.forEach((fn) => fn());
}

export function getCheckPhoneOverlay(): CheckPhoneOverlay {
    return _overlay;
}

export function subscribeCheckPhoneOverlay(fn: () => void): () => void {
    _listeners.add(fn);
    return () => {
        _listeners.delete(fn);
    };
}

/** 打开某角色的查手机悬浮窗。重复打开同一角色会覆盖（保持单一实例）。 */
export function startCheckPhoneOverlay(characterId: string): void {
    if (!characterId) return;
    _overlay = { characterId, minimized: false };
    notifyListeners();
}

/** 缩小为悬浮球 / 恢复全屏。 */
export function setCheckPhoneOverlayMinimized(minimized: boolean): void {
    if (!_overlay || _overlay.minimized === minimized) return;
    _overlay = { ..._overlay, minimized };
    notifyListeners();
}

/** 关闭查手机悬浮窗。 */
export function endCheckPhoneOverlay(): void {
    if (!_overlay) return;
    _overlay = null;
    notifyListeners();
}
