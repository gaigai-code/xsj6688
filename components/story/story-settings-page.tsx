"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, PhotoIcon, PlusIcon, TrashIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { Maximize2 } from "lucide-react";
import { Avatar } from "@/components/ui/primitives";
import { TextExpandModal } from "@/components/ui/modal";
import type { Character } from "@/lib/character-types";
import type { PresetConfig } from "@/lib/settings-types";
import type { StoryCharacterSettings, StoryProseStyleScheme, StoryTailScheme, StoryUiPrefs } from "@/lib/story-storage";

type StorySettingsPageProps = {
  characters: Character[];
  activeCharacterId: string;
  userName: string;
  uiPrefs: StoryUiPrefs;
  settings: StoryCharacterSettings;
  boundPreset: PresetConfig | null;
  foldTags: string;
  contextExcludedTags: string;
  onClose: () => void;
  onCharacterChange: (characterId: string) => void;
  onUiPrefsChange: (prefs: StoryUiPrefs) => void;
  onSettingsChange: (settings: StoryCharacterSettings) => void;
  onTagsChange: (foldTags: string, contextExcludedTags: string) => void;
  onOpenCss: () => void;
  onRebuildCache: () => void;
};

const DEFAULT_STATUS: StoryTailScheme = {
  id: "status-default",
  name: "关系温度卡",
  prompt: "在正文末尾输出 <story_status>，简洁记录当前时间、地点、关系温度和双方状态；内容会进入下一轮上下文。",
  preview: "时间｜夜晚  地点｜窗边\n关系温度｜72%  状态｜靠近",
};

const DEFAULT_THEATER: StoryTailScheme = {
  id: "theater-default",
  name: "片尾彩蛋",
  prompt: "在正文末尾输出 <story_theater>，写一段不影响主线的短小片尾彩蛋；默认仅展示，不进入下一轮上下文。",
  preview: "片尾彩蛋｜如果那一刻被拍成照片，大概会被珍藏很久。",
};

const DEFAULT_STATUS_HTML: StoryTailScheme = {
  id: "status-html",
  name: "自定义 HTML 状态栏",
  prompt: `在正文末尾输出 <story_status_html> 标签，内部使用 HTML 排版，例如：<div style="background: rgba(255,255,255,0.8); padding: 10px; border-radius: 8px;">时间：夜晚</div>；内容会进入下一轮上下文。`,
  preview: "<div style='color:blue'>自定义排版</div>",
};

const DEFAULT_FURRY_THEATER: StoryTailScheme = {
  id: "theater-furry",
  name: "毛茸茸派对小剧场",
  prompt: "在正文末尾输出 <story_theater>，写一段“毛茸茸派对”小剧场：假设角色和用户都是某一种毛茸茸的动物，基于刚刚发生的剧情，描写一段他们以动物形态互动的小故事；默认仅展示，不进入下一轮上下文。",
  preview: "毛茸茸派对｜大尾巴扫了扫你的鼻尖，你们依偎在阳光下打着呼噜。",
};

const DEFAULT_STYLES: StoryProseStyleScheme[] = [
  { id: "style-natural", name: "自然文风", prompt: "自然、连贯地推进场景，动作与对白比例均衡，不替用户决定心理和行动。" },
  { id: "style-delicate", name: "细腻慢热", prompt: "节奏舒缓，重视细小动作、感官变化和情绪递进，避免突然跳转关系。" },
  { id: "style-cinema", name: "电影感叙事", prompt: "使用清晰镜头感与场面调度推进剧情，语言克制，画面明确。" },
];

function normalizeSettings(value: StoryCharacterSettings): StoryCharacterSettings {
  const proseStyleSchemes = value.proseStyleSchemes?.length
    ? value.proseStyleSchemes.map((item) => ({ id: item.id, name: item.name, prompt: item.prompt }))
    : DEFAULT_STYLES;
  return {
    ...value,
    presetName: value.presetName || "默认剧情",
    minChars: value.minChars ?? 800,
    maxChars: value.maxChars ?? 1500,
    userPerspective: value.userPerspective || "second",
    proseStyle: value.proseStyle || "自然文风",
    proseStylePrompt: value.proseStylePrompt || "自然、连贯地推进场景，动作与对白比例均衡，不替用户决定心理和行动。",
    proseStyleSchemes,
    activeProseStyleSchemeId: proseStyleSchemes.some((item) => item.id === value.activeProseStyleSchemeId)
      ? value.activeProseStyleSchemeId
      : proseStyleSchemes.find((item) => item.name === value.proseStyle)?.id || proseStyleSchemes[0].id,
    statusSchemes: value.statusSchemes?.length ? value.statusSchemes : [DEFAULT_STATUS, DEFAULT_STATUS_HTML],
    activeStatusSchemeId: value.activeStatusSchemeId || DEFAULT_STATUS.id,
    theaterSchemes: value.theaterSchemes?.length ? value.theaterSchemes : [DEFAULT_THEATER, DEFAULT_FURRY_THEATER],
    activeTheaterSchemeId: value.activeTheaterSchemeId || DEFAULT_THEATER.id,
  };
}

function ProseStyleEditor({
  schemes,
  activeId,
  onChange,
}: {
  schemes: StoryProseStyleScheme[];
  activeId: string;
  onChange: (schemes: StoryProseStyleScheme[], activeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const active = schemes.find((item) => item.id === activeId) || schemes[0];
  const updateActive = (updates: Partial<StoryProseStyleScheme>) => {
    onChange(schemes.map((item) => item.id === active.id ? { ...item, ...updates } : item), active.id);
  };

  return (
    <div className="story-scheme-editor story-prose-style-editor">
      <div className="story-settings-label-row"><label>文风方案</label><span>写给 AI 的正文文风要求</span></div>
      <div className="story-settings-inline story-settings-inline-with-save">
        <select value={active.id} onChange={(event) => onChange(schemes, event.target.value)}>
          {schemes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button type="button" aria-label="新增文风方案" onClick={() => {
          const id = `story-style-${Date.now()}`;
          const next = [...schemes, { id, name: `文风方案 ${schemes.length + 1}`, prompt: "" }];
          onChange(next, id);
        }}><PlusIcon width={15} /></button>
        <button type="button" aria-label="删除文风方案" disabled={schemes.length <= 1} onClick={() => {
          if (schemes.length <= 1) return;
          const next = schemes.filter((item) => item.id !== active.id);
          onChange(next, next[0].id);
        }}><TrashIcon width={14} /></button>
        <button type="button" className="story-scheme-save" onClick={() => onChange(schemes, active.id)}>保存</button>
      </div>
      <input value={active.name} onChange={(event) => updateActive({ name: event.target.value })} placeholder="文风方案名称" />
      <div className="story-prompt-textarea-wrap">
        <textarea
          value={active.prompt}
          onChange={(event) => updateActive({ prompt: event.target.value })}
          placeholder="填写写给 AI 的文风要求，例如叙述节奏、用词和描写重点"
        />
        <button type="button" className="story-prompt-expand" onClick={() => setExpanded(true)} aria-label="放大编辑文风提示词" title="放大编辑">
          <Maximize2 size={14} />
        </button>
      </div>
      {expanded ? (
        <TextExpandModal
          title={`${active.name || "文风方案"} · 文风要求`}
          value={active.prompt}
          onChange={(prompt) => updateActive({ prompt })}
          placeholder="填写写给 AI 的正文文风要求。这里不需要填写状态栏、小剧场或其他尾部输出格式。"
          onClose={() => setExpanded(false)}
        />
      ) : null}
    </div>
  );
}

function SettingCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="story-settings-card">
      <div className="story-settings-card-head">
        <div>
          <h2>{title}</h2>
          {hint ? <p>{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function ToggleRow({ title, detail, checked, onChange }: { title: string; detail?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="story-settings-toggle-row">
      <span><strong>{title}</strong>{detail ? <small>{detail}</small> : null}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function SchemeEditor({
  label,
  schemes,
  activeId,
  tag,
  contextNote,
  onChange,
}: {
  label: string;
  schemes: StoryTailScheme[];
  activeId: string;
  tag: string;
  contextNote: string;
  onChange: (schemes: StoryTailScheme[], activeId: string) => void;
}) {
  const active = schemes.find((item) => item.id === activeId) || schemes[0];
  const updateActive = (updates: Partial<StoryTailScheme>) => {
    onChange(schemes.map((item) => item.id === active.id ? { ...item, ...updates } : item), active.id);
  };
  return (
    <div className="story-scheme-editor">
      <div className="story-settings-label-row"><label>{label}</label><span>{contextNote}</span></div>
      <div className="story-settings-inline story-settings-inline-with-save">
        <select value={active.id} onChange={(event) => onChange(schemes, event.target.value)}>
          {schemes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button type="button" aria-label={`新增${label}`} onClick={() => {
          const id = `${tag}-${Date.now()}`;
          const next = [...schemes, { id, name: `${label} ${schemes.length + 1}`, prompt: "", preview: "" }];
          onChange(next, id);
        }}><PlusIcon width={15} /></button>
        <button type="button" aria-label={`删除${label}`} disabled={schemes.length <= 1} onClick={() => {
          if (schemes.length <= 1) return;
          const next = schemes.filter((item) => item.id !== active.id);
          onChange(next, next[0].id);
        }}><TrashIcon width={14} /></button>
        <button type="button" className="story-scheme-save" onClick={() => onChange(schemes, active.id)}>保存</button>
      </div>
      <input value={active.name} onChange={(event) => updateActive({ name: event.target.value })} placeholder="方案名称" />
      <textarea value={active.prompt} onChange={(event) => updateActive({ prompt: event.target.value })} placeholder="写给 AI 的方案要求，支持 HTML 格式说明" />
      <div className="story-settings-preview">
        <small>尾部预览 · &lt;{tag}&gt;</small>
        <textarea value={active.preview} onChange={(event) => updateActive({ preview: event.target.value })} placeholder="在这里编辑预览内容" />
      </div>
    </div>
  );
}

export function StorySettingsPage(props: StorySettingsPageProps) {
  const normalized = useMemo(() => normalizeSettings(props.settings), [props.settings]);
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const availablePrompts = useMemo(
    () => (props.boundPreset?.prompts || []).filter((item) => !item.marker && item.content?.trim()),
    [props.boundPreset],
  );
  const selectedPromptIds = normalized.enabledPresetPromptIds ?? availablePrompts.filter((item) => item.enabled).map((item) => item.identifier);

  const patchSettings = (updates: Partial<StoryCharacterSettings>) => {
    props.onSettingsChange({ ...normalized, ...updates });
  };

  const readWallpaper = (file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => props.onUiPrefsChange({ ...props.uiPrefs, wallpaper: typeof reader.result === "string" ? reader.result : undefined });
    reader.readAsDataURL(file);
  };

  if (wallpaperOpen) {
    return (
      <div className="story-settings-page story-wallpaper-page">
        <header className="story-settings-header">
          <button type="button" onClick={() => setWallpaperOpen(false)} aria-label="返回剧情设置"><ChevronLeftIcon width={19} /></button>
          <strong>背景壁纸</strong><span />
        </header>
        <main className="story-wallpaper-main">
          <div className="story-wallpaper-preview" style={props.uiPrefs.wallpaper ? { backgroundImage: `url(${props.uiPrefs.wallpaper})` } : undefined}>
            {!props.uiPrefs.wallpaper ? <><PhotoIcon width={30} /><span>当前未设置剧情壁纸</span></> : null}
          </div>
          <input ref={fileRef} hidden type="file" accept="image/*" onChange={(event) => readWallpaper(event.target.files?.[0])} />
          <button className="story-settings-primary" type="button" onClick={() => fileRef.current?.click()}>从手机相册选择</button>
          {props.uiPrefs.wallpaper ? <button className="story-settings-danger" type="button" onClick={() => props.onUiPrefsChange({ ...props.uiPrefs, wallpaper: undefined })}>清除当前壁纸</button> : null}
          <p>壁纸只应用于当前见面对象的剧情页面，不影响聊天、主页和其他角色。</p>
        </main>
      </div>
    );
  }

  return (
    <div className="story-settings-page">
      <header className="story-settings-header">
        <button type="button" onClick={props.onClose} aria-label="返回剧情"><ChevronLeftIcon width={19} /></button>
        <strong>剧情设置</strong>
        <button type="button" onClick={props.onClose} aria-label="关闭设置"><XMarkIcon width={17} /></button>
      </header>
      <main className="story-settings-scroll">
        <SettingCard title="选择见面对象" hint="每个角色的设置都会单独保存">
          <div className="story-meeting-characters">
            {props.characters.map((character) => (
              <button key={character.id} type="button" data-active={character.id === props.activeCharacterId ? "true" : undefined} onClick={() => props.onCharacterChange(character.id)}>
                <Avatar src={character.avatar || undefined} name={character.name} size="lg" />
                <span>{character.name}</span>
              </button>
            ))}
          </div>
        </SettingCard>

        <SettingCard title="剧情预设设置" hint="建议给剧情 APP 单独制作专属预设，避免影响其他应用">
          <label className="story-settings-field"><span>当前角色专属预设名称</span><input value={normalized.presetName} onChange={(event) => patchSettings({ presetName: event.target.value })} /></label>
          <label className="story-settings-field"><span>剧情额外要求</span><textarea value={normalized.extraPrompt || ""} onChange={(event) => patchSettings({ extraPrompt: event.target.value })} placeholder="仅在当前角色的剧情生成中使用" /></label>
          <div className="story-settings-subhead"><strong>专属预设条目</strong><button className="story-settings-mini-add" type="button" onClick={() => patchSettings({ customPromptEntries: [...(normalized.customPromptEntries || []), { id: `story-entry-${Date.now()}`, name: `新条目 ${(normalized.customPromptEntries?.length || 0) + 1}`, content: "", enabled: true }] })}><PlusIcon width={13} />增加</button></div>
          <div className="story-custom-entry-list">
            {(normalized.customPromptEntries || []).map((entry) => (
              <div key={entry.id}>
                <label className="story-custom-entry-title"><input type="checkbox" checked={entry.enabled} onChange={(event) => patchSettings({ customPromptEntries: normalized.customPromptEntries!.map((item) => item.id === entry.id ? { ...item, enabled: event.target.checked } : item) })} /><input value={entry.name} onChange={(event) => patchSettings({ customPromptEntries: normalized.customPromptEntries!.map((item) => item.id === entry.id ? { ...item, name: event.target.value } : item) })} /><button type="button" onClick={() => patchSettings({ customPromptEntries: normalized.customPromptEntries!.filter((item) => item.id !== entry.id) })}><TrashIcon width={13} /></button></label>
                <textarea value={entry.content} onChange={(event) => patchSettings({ customPromptEntries: normalized.customPromptEntries!.map((item) => item.id === entry.id ? { ...item, content: event.target.value } : item) })} placeholder="填写这一条剧情专属提示词" />
              </div>
            ))}
            {!normalized.customPromptEntries?.length ? <p className="story-settings-empty">暂无专属条目，可按需要增加；它们只影响当前角色的剧情。</p> : null}
          </div>
          <div className="story-settings-subhead"><strong>操作已绑定大预设条目</strong><small>{props.boundPreset?.name || "未绑定大预设"}</small></div>
          {availablePrompts.length ? (
            <div className="story-preset-prompt-list">
              {availablePrompts.map((prompt) => (
                <label key={prompt.identifier}>
                  <input type="checkbox" checked={selectedPromptIds.includes(prompt.identifier)} onChange={(event) => {
                    const next = event.target.checked ? [...selectedPromptIds, prompt.identifier] : selectedPromptIds.filter((id) => id !== prompt.identifier);
                    patchSettings({ enabledPresetPromptIds: Array.from(new Set(next)) });
                  }} />
                  <span><strong>{prompt.name || prompt.identifier}</strong><small>{prompt.content.slice(0, 70)}</small></span>
                </label>
              ))}
            </div>
          ) : <p className="story-settings-empty">请先在“配置绑定”中给剧情 APP 绑定大预设。</p>}
        </SettingCard>

        <SettingCard title="生成设置" hint="检查预设条目与生成设置是否重复">
          <div className="story-number-grid">
            <label><span>最少字数</span><input type="number" min={50} max={4000} value={normalized.minChars} onChange={(event) => patchSettings({ minChars: Math.max(50, Math.min(4000, Number(event.target.value) || 50)) })} /></label>
            <label><span>最多字数</span><input type="number" min={50} max={4000} value={normalized.maxChars} onChange={(event) => patchSettings({ maxChars: Math.max(50, Math.min(4000, Number(event.target.value) || 50)) })} /></label>
          </div>
          <label className="story-settings-field"><span>用户人称</span><select value={normalized.userPerspective} onChange={(event) => patchSettings({ userPerspective: event.target.value as StoryCharacterSettings["userPerspective"] })}><option value="second">第二人称“你”</option><option value="third">第三人称“TA”</option><option value="username">使用用户名“{props.userName}”</option></select></label>
          <ProseStyleEditor schemes={normalized.proseStyleSchemes!} activeId={normalized.activeProseStyleSchemeId!} onChange={(proseStyleSchemes, activeProseStyleSchemeId) => patchSettings({ proseStyleSchemes, activeProseStyleSchemeId })} />
        </SettingCard>

        <SettingCard title="语音与播放">
          <ToggleRow title="开启语音" detail="启动当前角色绑定到剧情 APP 的语音；不会自动阅读" checked={Boolean(props.uiPrefs.voiceEnabled)} onChange={(value) => props.onUiPrefsChange({ ...props.uiPrefs, voiceEnabled: value })} />
          <p className="story-settings-note">总播放键按次播放下一句；每句对白末尾的小按钮仍可单独播放。</p>
        </SettingCard>

        <SettingCard title="自动阅读" hint="开启后可在“续写”旁启动自动滚动，解放双手阅读">
          <ToggleRow title="开启自动阅读" detail="可从最新角色消息或当前页面位置开始" checked={Boolean(props.uiPrefs.autoReadingEnabled)} onChange={(value) => props.onUiPrefsChange({ ...props.uiPrefs, autoReadingEnabled: value })} />
          {props.uiPrefs.autoReadingEnabled ? (
            <label className="story-auto-reading-speed">
              <span><strong>阅读速度</strong><small>{props.uiPrefs.autoReadingSpeed ?? 36} 像素/秒</small></span>
              <input
                type="range"
                min={12}
                max={120}
                step={4}
                value={props.uiPrefs.autoReadingSpeed ?? 36}
                onChange={(event) => props.onUiPrefsChange({ ...props.uiPrefs, autoReadingSpeed: Number(event.target.value) })}
              />
              <div><small>慢</small><small>快</small></div>
            </label>
          ) : null}
        </SettingCard>

        <SettingCard title="剧情尾部" hint="状态栏与小剧场分别保存多个方案，并可随时切换">
          <SchemeEditor label="状态栏方案" schemes={normalized.statusSchemes!} activeId={normalized.activeStatusSchemeId!} tag="story_status" contextNote="进入上下文" onChange={(schemes, activeStatusSchemeId) => patchSettings({ statusSchemes: schemes, activeStatusSchemeId })} />
          <SchemeEditor label="小剧场方案" schemes={normalized.theaterSchemes!} activeId={normalized.activeTheaterSchemeId!} tag="story_theater" contextNote="默认不进上下文" onChange={(schemes, activeTheaterSchemeId) => patchSettings({ theaterSchemes: schemes, activeTheaterSchemeId })} />
        </SettingCard>

        <SettingCard title="悬浮小手机" hint="开启后剧情正文右侧出现手机悬浮球">
          <ToggleRow title="启用悬浮小手机" detail="居中打开窄版小手机，显示与当前角色的线上聊天记录" checked={Boolean(normalized.floatingPhoneEnabled)} onChange={(value) => patchSettings({ floatingPhoneEnabled: value })} />
          <ToggleRow title="聊天记录衔接剧情上下文" detail="生成剧情时带入小手机最近的线上消息" checked={Boolean(normalized.floatingPhoneInContext)} onChange={(value) => patchSettings({ floatingPhoneInContext: value })} />
        </SettingCard>

        <SettingCard title="标签与高级设置">
          <label className="story-settings-field"><span>折叠标签</span><input value={props.foldTags} onChange={(event) => props.onTagsChange(event.target.value, props.contextExcludedTags)} placeholder="think,thinking,story_status,story_theater" /></label>
          <label className="story-settings-field"><span>不进上下文标签</span><input value={props.contextExcludedTags} onChange={(event) => props.onTagsChange(props.foldTags, event.target.value)} placeholder="think,thinking,story_theater" /></label>
          <button className="story-settings-row-button" type="button" onClick={() => setWallpaperOpen(true)}><span><strong>背景壁纸</strong><small>{props.uiPrefs.wallpaper ? "已设置 · 仅当前角色" : "未设置"}</small></span><ChevronLeftIcon width={17} style={{ transform: "rotate(180deg)" }} /></button>
          <button className="story-settings-row-button" type="button" onClick={props.onOpenCss}><span><strong>页面 CSS 样式</strong><small>进入完整样式编辑页面</small></span><ChevronLeftIcon width={17} style={{ transform: "rotate(180deg)" }} /></button>
          <button className="story-settings-row-button" type="button" onClick={props.onRebuildCache}><span><strong>重建剧情渲染缓存</strong><small>方案或标签变化后使用</small></span><ChevronLeftIcon width={17} style={{ transform: "rotate(180deg)" }} /></button>
        </SettingCard>
      </main>
    </div>
  );
}
