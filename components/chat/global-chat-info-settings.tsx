"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Code, Image as ImageIcon, LayoutPanelTop, User, X } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import CSSSchemeBar from "@/components/ui/css-scheme-picker";
import { Toggle } from "@/components/ui/form";
import {
    MAX_VISION_IMAGE_PROMPT_LIMIT,
    loadChatAppSettings,
    normalizeVisionImagePromptLimit,
    saveChatAppSettings,
} from "@/lib/chat-storage";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
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
            </div>
        </PageShell>
    );
}
