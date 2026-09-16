// lib/call-store.ts
// 全局通话 store：把语音/视频通话（单聊 + 群聊）从 ChatRoom 提升到应用顶层，
// 使通话在退出聊天 App、切到桌面或其它 App 后仍常驻（悬浮窗不消失）。
// 轻量模块级状态 + 监听器，模式同 lib/floating-dock-store.ts。

export type CallType = "voice" | "video";

export type ActiveCall = {
    type: CallType;
    sessionId: string;
    isGroup: boolean;
    initiator: "user" | "character";
    /** 群聊通话发起人的角色名（initiator="character" 时使用） */
    initiatorName?: string;
    /** 通话是否缩小为悬浮窗（单聊）；群聊无悬浮窗，恒为 false */
    minimized: boolean;
} | null;

let _activeCall: ActiveCall = null;

const _listeners = new Set<() => void>();

function notifyListeners(): void {
    _listeners.forEach((fn) => fn());
}

export function getActiveCall(): ActiveCall {
    return _activeCall;
}

export function subscribeActiveCall(fn: () => void): () => void {
    _listeners.add(fn);
    return () => {
        _listeners.delete(fn);
    };
}

/** 发起/接听一通新通话。同一时刻最多一通；已有通话进行中时忽略（不打断）。 */
export function startCall(call: Omit<NonNullable<ActiveCall>, "minimized">): void {
    if (_activeCall) return;
    _activeCall = { ...call, minimized: false };
    notifyListeners();
}

/** 缩小为悬浮窗 / 恢复全屏（仅单聊通话有悬浮窗）。 */
export function setCallMinimized(minimized: boolean): void {
    if (!_activeCall || _activeCall.minimized === minimized) return;
    _activeCall = { ..._activeCall, minimized };
    notifyListeners();
}

/** 结束通话（挂断/拒绝/取消/会话被删等兜底）。 */
export function endCall(): void {
    if (!_activeCall) return;
    _activeCall = null;
    notifyListeners();
}
