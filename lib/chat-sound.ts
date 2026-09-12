"use client";

// 聊天提示音：新消息 / 发送消息 / 来电 / 致电 / 挂断。
// 配置存在 ChatAppSettings.globalChatSounds（“全局聊天信息”里设置），
// 音频来源支持上传文件（IndexedDB 资产）或音频 URL。

import { useEffect, useRef } from "react";
import {
    CHAT_MESSAGE_PUSHED_EVENT,
    getActiveChatSessionId,
    getChatSoundConfig,
    type ChatMessage,
    type ChatSoundKind,
} from "./chat-storage";
import { getChatAudioFromIndexedDB } from "./chat-asset-storage";

// ── 音频来源解析 ────────────────────────────────────────────────
// IndexedDB 资产每次读取都要开库，data URL 也可能较大：按资产 id 缓存。

const dataUrlCache = new Map<string, string>();

async function resolveChatSoundSrc(kind: ChatSoundKind): Promise<string | null> {
    const config = getChatSoundConfig(kind);
    if (!config.value) return null;
    if (config.sourceType === "url") return config.value;
    // 兼容历史数据 / 手写配置：直接是 data: 或 http(s) 地址时原样使用
    if (config.value.startsWith("data:") || /^https?:/i.test(config.value)) return config.value;
    const cached = dataUrlCache.get(config.value);
    if (cached) return cached;
    const dataUrl = await getChatAudioFromIndexedDB(config.value);
    if (!dataUrl) return null;
    dataUrlCache.set(config.value, dataUrl);
    return dataUrl;
}

/** 设置页“试听”：不检查开关，只要配置了音频来源就播放。 */
export async function previewChatSound(kind: ChatSoundKind): Promise<void> {
    const src = await resolveChatSoundSrc(kind);
    if (!src) return;
    const audio = new Audio(src);
    audio.play().catch(() => { /* 自动播放被拦截时静默 */ });
}

/** 播放一次提示音（开启且配置了来源才会响）。 */
export async function playChatSoundOnce(kind: ChatSoundKind): Promise<void> {
    const config = getChatSoundConfig(kind);
    if (!config.enabled || !config.value) return;
    const src = await resolveChatSoundSrc(kind);
    if (!src) return;
    const audio = new Audio(src);
    audio.play().catch(() => { /* 自动播放被拦截时静默 */ });
}

// ── 循环铃声（来电等待 / 致电等待）───────────────────────────────
// 同一时间只保留一个循环：来电横幅与通话屏切换时后启动的会顶掉先前的；
// 停止函数带令牌，只停自己启动的那个循环，不会误停后来者。

type ActiveSoundLoop = { audio: HTMLAudioElement; token: object };
let activeSoundLoop: ActiveSoundLoop | null = null;
let soundLoopSeq = 0;

function stopActiveSoundLoop(): void {
    if (!activeSoundLoop) return;
    activeSoundLoop.audio.pause();
    activeSoundLoop = null;
}

/** 循环播放某提示音（如铃声），返回停止函数。 */
export function startChatSoundLoop(kind: ChatSoundKind): () => void {
    const config = getChatSoundConfig(kind);
    if (!config.enabled || !config.value) return () => {};
    let cancelled = false;
    const token = {};
    const mySeq = ++soundLoopSeq;
    void resolveChatSoundSrc(kind).then(src => {
        if (cancelled || !src) return;
        // 异步解析乱序完成时，只认最新启动的那个循环
        if (mySeq !== soundLoopSeq) return;
        stopActiveSoundLoop();
        const audio = new Audio(src);
        audio.loop = true;
        activeSoundLoop = { audio, token };
        audio.play().catch(() => { /* 自动播放被拦截时静默 */ });
    });
    return () => {
        cancelled = true;
        if (activeSoundLoop?.token === token) stopActiveSoundLoop();
    };
}

// ── 通话屏声音 Hook（来电铃声 / 致电等待音 / 挂断音）──────────────

/**
 * 通话屏（语音/视频/群聊）统一接入：
 * - CONNECTING 且对方发起 → 循环来电铃声；自己发起 → 循环致电等待音；
 * - callState 变为 ENDED 时立即播挂断音；未经 ENDED 直接退出（拒绝、返回、切会话）在卸载时补播。
 */
export function useCallScreenSounds(opts: { initiator: "user" | "character"; callState: string }): void {
    const hangupPlayedRef = useRef(false);
    // React 严格模式（dev）会在挂载瞬间做一次假卸载：300ms 内的卸载不当作真实退出
    const realMountRef = useRef(false);

    useEffect(() => {
        if (opts.callState !== "CONNECTING") return;
        return startChatSoundLoop(opts.initiator === "character" ? "incomingCall" : "outgoingCall");
    }, [opts.callState, opts.initiator]);

    useEffect(() => {
        if (opts.callState === "ENDED" && !hangupPlayedRef.current) {
            hangupPlayedRef.current = true;
            void playChatSoundOnce("hangup");
        }
    }, [opts.callState]);

    useEffect(() => {
        const timer = setTimeout(() => { realMountRef.current = true; }, 300);
        return () => {
            clearTimeout(timer);
            if (realMountRef.current && !hangupPlayedRef.current) {
                hangupPlayedRef.current = true;
                void playChatSoundOnce("hangup");
            }
        };
    }, []);
}

// ── 新消息 / 发送消息音效监听 ────────────────────────────────────

// 通话系统消息（“[我向XX发起了语音通话]”“[我挂断了语音通话]”等）：
// 来电由铃声负责，不当作普通新消息再响一声。
const CALL_SYS_MSG_RE = /\[我(?:向.+?)?(?:发起了|挂断了|拒绝了|取消了)群?(?:语音|视频)通话/;

// 不应触发新消息音效的 assistant 消息：工具内部流转、来电邀请卡片、
// 系统指令、群管理通知等（与未读计数的过滤口径保持一致）。
const SILENT_ASSISTANT_MEDIA_TYPES = new Set([
    "tool_call",
    "tool_result",
    "tool_notice",
    "memory_write_request",
    "voice_call",
    "video_call",
    "system_instruction",
    "group_admin_notice",
]);

// 有独立上下文的消息来源不在聊天 App 里，不播聊天提示音
const SILENT_ORIGINS = new Set(["reading_discuss", "story_floating_phone"]);

// 桌面小窗聊天正打开的会话：开启“实时聊天不通知”时同样视为正在实时聊天
let miniChatSoundSessionId: string | null = null;

/** 由桌面壳维护：小窗聊天当前打开的会话（关闭小窗时传 null）。 */
export function setMiniChatSoundSessionId(sessionId: string | null): void {
    miniChatSoundSessionId = sessionId;
}

function isSessionBeingWatched(sessionId: string): boolean {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
    return getActiveChatSessionId() === sessionId || miniChatSoundSessionId === sessionId;
}

// “多条消息只通知1次”：同一角色在这个时间窗口内连续多条消息只响一次。
const BURST_NOTIFY_WINDOW_MS = 10_000;
const burstLastSoundAt = new Map<string, number>();

function getBurstKey(msg: ChatMessage): string {
    // 群聊按角色去重；单聊角色消息没有 senderCharacterId 时按会话去重
    return msg.senderCharacterId || msg.sessionId;
}

function shouldPlayNewMessageSound(msg: ChatMessage, muteActiveChat: boolean, notifyOnce: boolean): boolean {
    if (SILENT_ASSISTANT_MEDIA_TYPES.has(msg.mediaType || "")) return false;
    if (msg.origin && SILENT_ORIGINS.has(msg.origin)) return false;
    if (CALL_SYS_MSG_RE.test(msg.content)) return false;
    // 纯面板驮载气泡（无文字无媒体）不算一条“新消息”
    if (!msg.content.trim() && !msg.mediaType) return false;
    // 实时聊天不通知：正打开该聊天（主聊天室或桌面小窗）且页面可见时静音
    if (muteActiveChat && isSessionBeingWatched(msg.sessionId)) return false;
    if (notifyOnce) {
        const key = getBurstKey(msg);
        const last = burstLastSoundAt.get(key) ?? 0;
        if (Date.now() - last < BURST_NOTIFY_WINDOW_MS) return false;
    }
    return true;
}

function markBurstPlayed(msg: ChatMessage): void {
    burstLastSoundAt.set(getBurstKey(msg), Date.now());
}

/**
 * 安装全局消息提示音监听（新消息音效 + 发送消息音效）。
 * 挂在常驻的壳组件上一次即可，返回卸载函数。
 */
export function installChatSoundListener(): () => void {
    if (typeof window === "undefined") return () => {};

    const onPushed = (e: Event) => {
        const detail = (e as CustomEvent<{ message?: ChatMessage }>).detail;
        const msg = detail?.message;
        if (!msg) return; // 导入等不带消息体的事件不响

        if (msg.role === "user") {
            // 发送消息音效：用户消息落库时播放；通话屏写入的系统消息除外
            if (msg.origin && SILENT_ORIGINS.has(msg.origin)) return;
            if (CALL_SYS_MSG_RE.test(msg.content)) return;
            void playChatSoundOnce("sendMessage");
            return;
        }

        if (msg.role === "assistant") {
            const config = getChatSoundConfig("newMessage");
            if (!config.enabled || !config.value) return;
            if (!shouldPlayNewMessageSound(msg, config.muteActiveChat === true, config.notifyOncePerBurst === true)) return;
            markBurstPlayed(msg);
            void playChatSoundOnce("newMessage");
        }
    };

    window.addEventListener(CHAT_MESSAGE_PUSHED_EVENT, onPushed);
    return () => window.removeEventListener(CHAT_MESSAGE_PUSHED_EVENT, onPushed);
}
