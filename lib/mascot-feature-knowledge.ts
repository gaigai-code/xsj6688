// 小卷的本机功能知识库。
// 与聊天记录分库保存，避免清空小卷会话时把功能认知一并删掉；代码升级后按 revision
// 自动刷新内置条目。即使 IndexedDB 不可用，也会回退到同一份内置知识。

const MASCOT_KNOWLEDGE_DB_NAME = "AiPhoneMascotKnowledgeDB";
const MASCOT_KNOWLEDGE_DB_VERSION = 1;
const MASCOT_KNOWLEDGE_STORE = "knowledge";
const OWNER_FEATURES_KEY = "owner-custom-features";

export type MascotFeatureKnowledgeEntry = {
    id: string;
    title: string;
    location: string;
    facts: string[];
};

type MascotFeatureKnowledgeRecord = {
    key: string;
    revision: string;
    updatedAt: string;
    entries: MascotFeatureKnowledgeEntry[];
};

const OWNER_FEATURES: MascotFeatureKnowledgeRecord = {
    key: OWNER_FEATURES_KEY,
    revision: "2026-09-09.3",
    updatedAt: "2026-09-09T00:00:00.000Z",
    entries: [
        {
            id: "theme-presets",
            title: "主题预设",
            location: "主题 App → 主题预设",
            facts: [
                "可以保存当前主题为预设、切换预设和删除预设。",
                "主题预设保存当前外观配置；壁纸素材库仍由用户本机统一管理。",
            ],
        },
        {
            id: "api-bindings",
            title: "全局与 APP 配置绑定",
            location: "设置 → 配置绑定 → 全局APP绑定，或角色绑定 → APP",
            facts: [
                "调用优先级固定为：角色绑定 ＞ APP绑定 ＞ 全局绑定。",
                "APP 详情只设置文本与生图绑定，不显示语音绑定；语音仍走角色或全局配置。",
            ],
        },
        {
            id: "image-generation-character-identity",
            title: "生图 API 预设与角色形象锁定",
            location: "设置 → 图像生成 API",
            facts: [
                "OpenAI 兼容配置可保存、切换和删除预设。",
                "每个角色可单独填写人物特征提示词、上传参考图，并移动方框选取脸部区域。",
                "参考图可关闭但保留；默认开启“非自拍照不使用参考图”。NovelAI 会读取人物特征提示词，但不使用参考图。",
            ],
        },
        {
            id: "checkphone-batch",
            title: "查手机批量生成与新内容提醒",
            location: "查手机 → 右上角批量生成",
            facts: [
                "一次可选择 1 到 4 个 APP，只调用一次文本 API，并把结果分别保存到对应 APP。",
                "本轮生成出新内容的 APP 图标右上角会显示红点，进入该 APP 后清除。",
            ],
        },
        {
            id: "chat-transfer",
            title: "单个会话聊天记录导入导出",
            location: "私聊 → 右上角聊天信息 → 导出聊天记录 / 导入聊天记录",
            facts: [
                "可以把当前私聊记录导出成文件，也可以把兼容文件导回当前会话。",
                "这是会话级迁移，不等同于设置里的整机备份。",
            ],
        },
        {
            id: "chat-avatars",
            title: "私聊双方头像与角色自主换头像",
            location: "私聊 → 右上角聊天信息 → 设置头像",
            facts: [
                "用户可以分别直接更换“我的头像”和对方角色头像；“我的头像”只属于当前私聊，不会修改主页资料、会话列表上方头像或其他私聊。",
                "“我更换头像后希望对方做出反应”默认开启；开启时只向角色写入“用户名字更新了头像”这一句系统事件，关闭后不通知对方。",
                "用户也可以在私聊发送一张真实相册图片，并直接或暗示对方换头像；角色按人设自主接受或拒绝，接受后系统自动把该图片设为角色头像。",
                "自动换头像必须有实际图片文件；只有文字描述的“照片”卡片没有图片像素，不能作为头像。",
            ],
        },
        {
            id: "global-chat-info",
            title: "全局聊天信息",
            location: "聊天 → 我的 → 离线推送与定时消息下方 → 全局聊天信息",
            facts: [
                "可以设置所有私聊默认使用的用户头像、状态栏、聊天背景、聊天室 CSS 与传入最近图片数量，且不会修改主页用户资料。",
                "优先级为：单独私聊设置 ＞ 全局聊天信息；CSS 额外遵循：单独私聊 CSS ＞ 全局聊天室 CSS ＞ 主页外观 CSS。",
                "全局状态栏和全局聊天室 CSS 可以从与单独私聊相同的资源方案中导入。",
            ],
        },
        {
            id: "chat-unread",
            title: "私聊未读红点",
            location: "聊天会话列表与桌面聊天图标",
            facts: [
                "角色产生新消息且对应会话不在前台时，会累加未读数量并显示红点；进入会话后标记已读。",
            ],
        },
        {
            id: "backup-image-range",
            title: "备份动态图片时间范围",
            location: "设置 → 数据管理 → 动态图片备份范围",
            facts: [
                "本地导出可选择全部、最近 7 天或最近 3 天的聊天与朋友圈动态图片。",
                "用户/角色头像、主题图片、图标和壁纸不受时间范围限制，会完整保留。",
            ],
        },
    ],
};

function openKnowledgeDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(MASCOT_KNOWLEDGE_DB_NAME, MASCOT_KNOWLEDGE_DB_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(MASCOT_KNOWLEDGE_STORE)) {
                request.result.createObjectStore(MASCOT_KNOWLEDGE_STORE, { keyPath: "key" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("小卷功能知识库打开失败"));
    });
}

async function readKnowledgeRecord(db: IDBDatabase): Promise<MascotFeatureKnowledgeRecord | null> {
    return new Promise(resolve => {
        const tx = db.transaction(MASCOT_KNOWLEDGE_STORE, "readonly");
        const request = tx.objectStore(MASCOT_KNOWLEDGE_STORE).get(OWNER_FEATURES_KEY);
        request.onsuccess = () => resolve((request.result as MascotFeatureKnowledgeRecord | undefined) || null);
        request.onerror = () => resolve(null);
    });
}

async function writeKnowledgeRecord(db: IDBDatabase, record: MascotFeatureKnowledgeRecord): Promise<void> {
    return new Promise(resolve => {
        const tx = db.transaction(MASCOT_KNOWLEDGE_STORE, "readwrite");
        tx.objectStore(MASCOT_KNOWLEDGE_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
    });
}

function formatFeatureKnowledge(record: MascotFeatureKnowledgeRecord): string {
    const lines = record.entries.flatMap(entry => [
        `【${entry.title}】位置：${entry.location}`,
        ...entry.facts.map(fact => `- ${fact}`),
    ]);
    return [
        "===== 当前机型功能知识（本机数据库） =====",
        "以下是本分支已经实现的功能。用户询问位置、用法或是否支持时，以这里为准。",
        "知道功能存在不等于你能直接操作：只有当前工具列表提供对应动作时才可以替用户执行，否则应说明路径，让用户手动操作。",
        ...lines,
    ].join("\n");
}

export async function loadMascotFeatureKnowledgePrompt(): Promise<string> {
    if (typeof indexedDB === "undefined") return formatFeatureKnowledge(OWNER_FEATURES);
    try {
        const db = await openKnowledgeDb();
        let record = await readKnowledgeRecord(db);
        if (!record || record.revision !== OWNER_FEATURES.revision) {
            record = OWNER_FEATURES;
            await writeKnowledgeRecord(db, record);
        }
        db.close();
        return formatFeatureKnowledge(record);
    } catch {
        return formatFeatureKnowledge(OWNER_FEATURES);
    }
}
