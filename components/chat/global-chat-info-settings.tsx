"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { AudioLines, ChevronRight, Code, Image as ImageIcon, LayoutPanelTop, MessageSquare, PhoneIncoming, PhoneOff, PhoneOutgoing, Play, Send, User, X } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import CSSSchemeBar from "@/components/ui/css-scheme-picker";
import { Toggle } from "@/components/ui/form";
import {
    MAX_VISION_IMAGE_PROMPT_LIMIT,
    loadChatAppSettings,
    normalizeVisionImagePromptLimit,
    saveChatAppSettings,
    type ChatSoundConfig,
    type ChatSoundKind,
    type ChatSoundsConfig,
} from "@/lib/chat-storage";
import { getChatImageFromIndexedDB, saveChatAudioToIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { previewChatSound } from "@/lib/chat-sound";
import {
    GLOBAL_CHAT_STATUS_REGION_ID,
    getStatusRegionConfig,
    isCustomStatusRegionActive,
    saveStatusRegionConfig,
    STATUS_REGION_SCHEME_TARGET,
    type StatusRegionConfig,
} from "@/lib/chat-status-region";
import { CHAT_SESSION_CSS_EXAMPLE } from "@/lib/css-examples";
import { fileToUserAvatarDataUrl } from "@/lib/user-avatar-image";

function saveSettings(patch: Record<string, unknown>) {
    saveChatAppSettings({ ...loadChatAppSettings(), ...patch });
}

// ── 提示音设置分区 ──────────────────────────────────────────────

const SOUND_ITEMS: {
    kind: ChatSoundKind;
    icon: ComponentType<{ size?: number; className?: string }>;
    label: string;
    desc: string;
}[] = [
    { kind: "newMessage", icon: MessageSquare, label: "新消息音效", desc: "角色发来新消息时播放" },
    { kind: "sendMessage", icon: Send, label: "发送消息音效", desc: "发出消息时播放" },
    { kind: "incomingCall", icon: PhoneIncoming, label: "来电音效", desc: "来电等待接听时循环播放" },
    { kind: "outgoingCall", icon: PhoneOutgoing, label: "致电音效", desc: "呼叫等待接通时循环播放" },
    { kind: "hangup", icon: PhoneOff, label: "挂断音效", desc: "通话结束或挂断时播放" },
];

function ChatSoundsSection() {
    const [sounds, setSounds] = useState<ChatSoundsConfig>(() => loadChatAppSettings().globalChatSounds || {});
    const [urlDrafts, setUrlDrafts] = useState<Partial<Record<ChatSoundKind, string>>>({});
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadKindRef = useRef<ChatSoundKind | null>(null);

    const changeSound = (kind: ChatSoundKind, patch: Partial<ChatSoundConfig>) => {
        setSounds(current => {
            const next: ChatSoundsConfig = { ...current, [kind]: { ...current[kind], ...patch } };
            saveChatAppSettings({ ...loadChatAppSettings(), globalChatSounds: next });
            return next;
        });
    };

    const pickFile = (kind: ChatSoundKind) => {
        uploadKindRef.current = kind;
        fileInputRef.current?.click();
    };

    const changeFile = async (file?: File) => {
        const kind = uploadKindRef.current;
        if (!kind || !file) return;
        if (file.size > 8 * 1024 * 1024) { alert("音频文件过大，请控制在 8MB 以内"); return; }
        try {
            const id = await saveChatAudioToIndexedDB(file);
            changeSound(kind, { sourceType: "file", value: id });
        } catch { alert("音频文件保存失败，请换一个文件重试"); }
    };

    const applyUrl = (kind: ChatSoundKind) => {
        const url = (urlDrafts[kind] || "").trim();
        if (!url) return;
        if (!/^(https?:\/\/|data:audio)/i.test(url)) { alert("请输入 http(s) 开头的音频链接"); return; }
        changeSound(kind, { sourceType: "url", value: url });
    };

    return (
        <div className="menu-group">
            <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
                className="hidden"
                onChange={event => { void changeFile(event.target.files?.[0]); event.target.value = ""; }}
            />
            {SOUND_ITEMS.map(({ kind, icon: Icon, label, desc }) => {
                const config: ChatSoundConfig = sounds[kind] || {};
                const enabled = config.enabled === true;
                const hasSource = Boolean(config.value);
                return (
                    <div key={kind} className="chat-sound-block">
                        <div className="menu-item">
                            <Icon size={20} className="text-[var(--c-icon)]" />
                            <div className="menu-label-group"><span className="menu-label">{label}</span><span className="menu-desc">{desc}</span></div>
                            <div className="menu-right">
                                <Toggle checked={enabled} onChange={checked => changeSound(kind, { enabled: checked })} />
                            </div>
                        </div>
                        {enabled ? (
                            <div className="chat-sound-editor">
                                <div className="chat-sound-editor-row">
                                    <button className="ui-btn ui-btn-outline chat-sound-file-btn" onClick={() => pickFile(kind)}>
                                        <AudioLines size={14} /> 选择音频文件
                                    </button>
                                    <span className="chat-sound-source">
                                        {config.sourceType === "file" ? "已用音频文件" : config.sourceType === "url" ? "已用音频 URL" : "未设置音频"}
                                    </span>
                                    <div className="chat-sound-editor-actions">
                                        <button className="ui-btn ui-btn-ghost h-8 w-8 p-0" disabled={!hasSource} onClick={() => void previewChatSound(kind)} aria-label="试听" title="试听"><Play size={14} /></button>
                                        {hasSource ? (
                                            <button className="ui-btn ui-btn-ghost h-8 w-8 p-0" onClick={() => changeSound(kind, { sourceType: undefined, value: undefined })} aria-label="清除音频" title="清除音频"><X size={14} /></button>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="chat-sound-editor-row">
                                    <span className="chat-sound-or">或</span>
                                    <input
                                        className="ui-input flex-1 h-8 ts-12"
                                        placeholder="输入音频 URL（mp3 / wav 等）"
                                        value={urlDrafts[kind] ?? (config.sourceType === "url" ? config.value || "" : "")}
                                        onChange={event => setUrlDrafts(current => ({ ...current, [kind]: event.target.value }))}
                                        inputMode="url"
                                        autoCapitalize="off"
                                        autoCorrect="off"
                                        spellCheck={false}
                                    />
                                    <button className="ui-btn ui-btn-soft-action" onClick={() => applyUrl(kind)}>使用</button>
                                </div>
                                {kind === "newMessage" ? (
                                    <div className="chat-sound-subtoggles">
                                        <div className="chat-sound-subtoggle">
                                            <div className="menu-label-group"><span className="menu-label">实时聊天不通知</span><span className="menu-desc">正打开该聊天时，角色新消息不播放音效</span></div>
                                            <Toggle checked={config.muteActiveChat === true} onChange={checked => changeSound(kind, { muteActiveChat: checked })} />
                                        </div>
                                        <div className="chat-sound-subtoggle">
                                            <div className="menu-label-group"><span className="menu-label">多条消息只通知1次</span><span className="menu-desc">同一角色连续多条消息只在第一条时播放</span></div>
                                            <Toggle checked={config.notifyOncePerBurst === true} onChange={checked => changeSound(kind, { notifyOncePerBurst: checked })} />
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

export function GlobalChatInfoSettings({ onBack }: { onBack: () => void }) {
    const initial = loadChatAppSettings();
    const [avatar, setAvatar] = useState(initial.globalChatUserAvatar || "");
    const [background, setBackground] = useState(initial.globalChatBackgroundImage || "");
    const [backgroundPreview, setBackgroundPreview] = useState("");
    const [customCSS, setCustomCSS] = useState(initial.globalChatCustomCSS || "");
    const [visionLimit, setVisionLimit] = useState(() => normalizeVisionImagePromptLimit(initial.globalVisionImagePromptLimit));
    const [status, setStatus] = useState<StatusRegionConfig>(() => getStatusRegionConfig(GLOBAL_CHAT_STATUS_REGION_ID, false));
    const [editingCSS, setEditingCSS] = useState(false);
    const [editingStatus, setEditingStatus] = useState(false);
    const [draftCSS, setDraftCSS] = useState(customCSS);
    const [draftStatus, setDraftStatus] = useState(status);
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const backgroundInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let cancelled = false;
        if (!background) { setBackgroundPreview(""); return; }
        if (background.startsWith("data:") || background.startsWith("http")) {
            setBackgroundPreview(background);
            return;
        }
        void getChatImageFromIndexedDB(background).then(url => {
            if (!cancelled) setBackgroundPreview(url || "");
        });
        return () => { cancelled = true; };
    }, [background]);

    const changeAvatar = async (file?: File) => {
        if (!file) return;
        try {
            const value = await fileToUserAvatarDataUrl(file);
            setAvatar(value);
            saveSettings({ globalChatUserAvatar: value });
        } catch { alert("头像图片处理失败，请换一张图片重试"); }
    };

    const changeBackground = async (file?: File) => {
        if (!file) return;
        try {
            const id = await saveChatImageToIndexedDB(file);
            setBackground(id);
            saveSettings({ globalChatBackgroundImage: id });
        } catch { alert("背景图片保存失败，请换一张图片重试"); }
    };

    const changeVisionLimit = (value: unknown) => {
        const next = normalizeVisionImagePromptLimit(value);
        setVisionLimit(next);
        saveSettings({ globalVisionImagePromptLimit: next });
    };

    const statusPayload = JSON.stringify({
        type: "ai-phone-status-region",
        version: 1,
        contract: draftStatus.contract,
        renderHtml: draftStatus.renderHtml,
        previewRaw: draftStatus.previewRaw || "",
    }, null, 2);

    const loadStatusPayload = (payload: string) => {
        try {
            const parsed = JSON.parse(payload) as Record<string, unknown>;
            setDraftStatus(current => ({
                ...current,
                mode: "custom",
                contract: typeof parsed.contract === "string" ? parsed.contract : "",
                renderHtml: typeof parsed.renderHtml === "string" ? parsed.renderHtml : "",
                previewRaw: typeof parsed.previewRaw === "string" ? parsed.previewRaw : "",
            }));
        } catch { alert("导入失败：不是有效的状态栏方案"); }
    };

    if (editingCSS) {
        return (
            <PageShell title="全局聊天室 CSS" onBack={() => setEditingCSS(false)} className="absolute inset-0 z-[110]">
                <div className="theme-section-page">
                    <p className="ts-13 text-[var(--c-text)] mb-3 leading-relaxed">作用于所有私聊和群聊；单独会话 CSS 会覆盖这里，主页“外观 CSS”优先级最低。</p>
                    <textarea className="ui-textarea font-mono ts-13 leading-relaxed flex-1" style={{ minHeight: 320, resize: "none" }} value={draftCSS} onChange={event => setDraftCSS(event.target.value)} spellCheck={false} placeholder={CHAT_SESSION_CSS_EXAMPLE} />
                    <div className="flex gap-2 mt-3 items-center">
                        <CSSSchemeBar target="chat_session" currentCSS={draftCSS} onLoad={setDraftCSS} />
                        <button className="ui-btn ui-btn-outline flex-1" onClick={() => setDraftCSS(CHAT_SESSION_CSS_EXAMPLE)}>示例</button>
                        <button className="ui-btn ui-btn-outline flex-1" onClick={() => setDraftCSS("")}>清除</button>
                        <button className="ui-btn ui-btn-soft-action flex-1" onClick={() => { setCustomCSS(draftCSS); saveSettings({ globalChatCustomCSS: draftCSS }); setEditingCSS(false); }}>应用</button>
                    </div>
                </div>
            </PageShell>
        );
    }

    if (editingStatus) {
        return (
            <PageShell title="全局私聊状态栏" onBack={() => setEditingStatus(false)} className="absolute inset-0 z-[110]">
                <div className="theme-section-page flex flex-col gap-3">
                    <div className="menu-group">
                        <div className="menu-item">
                            <div className="menu-label-group"><span className="menu-label">启用自定义状态栏</span><span className="menu-desc">关闭时使用 Float 原生状态栏</span></div>
                            <Toggle checked={draftStatus.mode === "custom"} onChange={checked => setDraftStatus(current => ({ ...current, mode: checked ? "custom" : "native" }))} />
                        </div>
                    </div>
                    {draftStatus.mode === "custom" && <>
                        <label className="ts-13 font-medium text-[var(--c-text-title)]">输出契约</label>
                        <textarea className="ui-textarea font-mono ts-12" style={{ minHeight: 150, resize: "vertical" }} value={draftStatus.contract} onChange={event => setDraftStatus(current => ({ ...current, contract: event.target.value }))} placeholder="告诉 AI 状态栏需要输出哪些字段与格式" />
                        <label className="ts-13 font-medium text-[var(--c-text-title)]">渲染 HTML</label>
                        <textarea className="ui-textarea font-mono ts-12" style={{ minHeight: 220, resize: "vertical" }} value={draftStatus.renderHtml} onChange={event => setDraftStatus(current => ({ ...current, renderHtml: event.target.value }))} placeholder="完整 HTML / CSS / JS" />
                    </>}
                    <div className="flex gap-2 items-center">
                        <CSSSchemeBar target={STATUS_REGION_SCHEME_TARGET} currentCSS={statusPayload} onLoad={loadStatusPayload} />
                        <button className="ui-btn ui-btn-outline flex-1" onClick={() => setDraftStatus({ mode: "native", contract: "", renderHtml: "", previewRaw: "" })}>恢复原生</button>
                        <button className="ui-btn ui-btn-soft-action flex-1" onClick={() => { setStatus(draftStatus); saveStatusRegionConfig(GLOBAL_CHAT_STATUS_REGION_ID, draftStatus); setEditingStatus(false); }}>应用</button>
                    </div>
                </div>
            </PageShell>
        );
    }

    return (
        <PageShell title="全局聊天信息" onBack={onBack} className="absolute inset-0 z-[100]">
            <div className="page-menu chat-info-menu">
                <div className="px-4 pb-2 ts-12 text-[var(--c-text)] opacity-65">单独会话设置优先于这里；这里只改变聊天室，不会修改主页用户资料。状态栏仍仅用于私聊。</div>
                <div className="menu-group">
                    <div className="menu-item cursor-pointer" role="button" tabIndex={0} onClick={() => avatarInputRef.current?.click()} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") avatarInputRef.current?.click(); }}>
                        <User size={20} className="text-[var(--c-icon)]" />
                        <div className="menu-label-group"><span className="menu-label">用户头像</span><span className="menu-desc">所有私聊和群聊默认使用</span></div>
                        <div className="menu-right gap-2">
                            {avatar ? <img src={avatar} className="h-9 w-9 rounded-full object-cover" alt="全局聊天头像" /> : <span className="menu-desc">跟随用户资料</span>}
                            {avatar && <button aria-label="清除全局聊天头像" onClick={event => { event.stopPropagation(); setAvatar(""); saveSettings({ globalChatUserAvatar: "" }); }}><X size={15} /></button>}
                            <ChevronRight size={16} />
                        </div>
                    </div>
                    <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={event => { void changeAvatar(event.target.files?.[0]); event.target.value = ""; }} />
                    <button className="menu-item" onClick={() => { setDraftStatus(status); setEditingStatus(true); }}>
                        <LayoutPanelTop size={20} className="text-[var(--c-icon)]" />
                        <div className="menu-label-group"><span className="menu-label">私聊状态栏</span><span className="menu-desc">可从状态栏资源方案导入</span></div>
                        <div className="menu-right"><span className="menu-desc mr-1">{isCustomStatusRegionActive(status) ? "自定义" : "原生"}</span><ChevronRight size={16} /></div>
                    </button>
                    <div className="menu-item cursor-pointer" role="button" tabIndex={0} onClick={() => backgroundInputRef.current?.click()} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") backgroundInputRef.current?.click(); }}>
                        <ImageIcon size={20} className="text-[var(--c-icon)]" />
                        <div className="menu-label-group"><span className="menu-label">聊天背景</span><span className="menu-desc">所有私聊和群聊默认使用</span></div>
                        <div className="menu-right gap-2">
                            {backgroundPreview ? <img src={backgroundPreview} className="h-9 w-9 rounded-lg object-cover" alt="全局聊天背景" /> : <span className="menu-desc">未设置</span>}
                            {background && <button aria-label="清除全局聊天背景" onClick={event => { event.stopPropagation(); setBackground(""); saveSettings({ globalChatBackgroundImage: "" }); }}><X size={15} /></button>}
                            <ChevronRight size={16} />
                        </div>
                    </div>
                    <input ref={backgroundInputRef} type="file" accept="image/*" className="hidden" onChange={event => { void changeBackground(event.target.files?.[0]); event.target.value = ""; }} />
                    <button className="menu-item" onClick={() => { setDraftCSS(customCSS); setEditingCSS(true); }}>
                        <Code size={20} className="text-[var(--c-icon)]" />
                        <div className="menu-label-group"><span className="menu-label">聊天室自定义 CSS 样式</span><span className="menu-desc">与单独私聊共用资源方案</span></div>
                        <div className="menu-right"><span className="menu-desc mr-1">{customCSS ? "已设置" : "未设置"}</span><ChevronRight size={16} /></div>
                    </button>
                    <div className="menu-item">
                        <ImageIcon size={20} className="text-[var(--c-icon)]" />
                        <div className="menu-label-group"><span className="menu-label">传入最近图片</span><span className="menu-desc">所有私聊和群聊的默认视觉上下文数量</span></div>
                        <div className="menu-right gap-2">
                            <button className="ui-btn ui-btn-ghost h-8 w-8 p-0" onClick={() => changeVisionLimit(visionLimit - 1)} disabled={visionLimit <= 0}>-</button>
                            <input type="number" min={0} max={MAX_VISION_IMAGE_PROMPT_LIMIT} value={visionLimit} onChange={event => changeVisionLimit(event.target.value)} className="ui-input h-8 w-14 text-center" />
                            <button className="ui-btn ui-btn-ghost h-8 w-8 p-0" onClick={() => changeVisionLimit(visionLimit + 1)} disabled={visionLimit >= MAX_VISION_IMAGE_PROMPT_LIMIT}>+</button>
                        </div>
                    </div>
                </div>
                <div className="px-4 pt-3 pb-2 ts-12 font-medium text-[var(--c-text-title)] opacity-80">提示音</div>
                <ChatSoundsSection />
            </div>
        </PageShell>
    );
}
