import { getNow } from "./virtual-time";
import { kvGet, kvSet, registerDynamicPrefix } from "./kv-db";
import { formatChatTimestamp } from "./llm-prompt-assembler";

// lib/group-kick-memory.ts
// 群聊被踢事件的记忆投影条目（projection entry）。
// 被踢角色从 participantIds 移除后，原群聊时间线不再覆盖 ta；这里把「被踢」与
// 后续「记恨/对质」单独落为持久化条目，供 loadNativeTimeline 注入短期上下文与记忆总结。

const GROUP_KICK_MEMORY_PREFIX = "ai_phone_group_kick_memory:";
const MAX_GROUP_KICK_EVENTS = 120;

registerDynamicPrefix(GROUP_KICK_MEMORY_PREFIX);

export type GroupKickMemoryEntry = {
    id: string;
    characterId: string;      // 被踢角色
    groupSessionId: string;
    groupName: string;
    kickerKey: string;        // "self"（用户）或角色 id
    kickerName: string;
    kind: "kick" | "reaction";
    timestamp: string;
    content: string;
};

function storageKey(characterId: string): string {
    return `${GROUP_KICK_MEMORY_PREFIX}${characterId}`;
}

function cleanText(value: unknown, maxLength: number): string {
    const text = String(value ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/\s+/g, " ")
        .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function loadEventsByKey(key: string): GroupKickMemoryEntry[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = kvGet(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((entry): entry is GroupKickMemoryEntry =>
                Boolean(entry)
                && typeof (entry as Partial<GroupKickMemoryEntry>).id === "string"
                && typeof (entry as Partial<GroupKickMemoryEntry>).characterId === "string"
                && typeof (entry as Partial<GroupKickMemoryEntry>).timestamp === "string"
                && typeof (entry as Partial<GroupKickMemoryEntry>).content === "string"
            )
            .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    } catch {
        return [];
    }
}

function saveEventsByKey(key: string, events: GroupKickMemoryEntry[]): void {
    if (typeof window === "undefined") return;
    const compacted = [...events]
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(-MAX_GROUP_KICK_EVENTS);
    kvSet(key, JSON.stringify(compacted));
}

function upsert(characterId: string, entry: GroupKickMemoryEntry): void {
    const key = storageKey(characterId);
    const current = loadEventsByKey(key);
    saveEventsByKey(key, [entry, ...current.filter((item) => item.id !== entry.id)]);
}

/**
 * 记录「被踢出群聊」事实（幂等：同一角色在同一群内只保留最近一次被踢记录，
 * 被重新邀请后再次被踢会用新时间戳覆盖旧记录）。
 */
export function recordGroupKickMemory(input: {
    characterId: string;
    groupSessionId: string;
    groupName?: string;
    kickerKey: string;
    kickerName?: string;
}): GroupKickMemoryEntry | null {
    const characterId = cleanText(input.characterId, 160);
    const groupSessionId = cleanText(input.groupSessionId, 160);
    if (!characterId || !groupSessionId) return null;

    const groupName = cleanText(input.groupName, 80) || "群聊";
    const kickerName = cleanText(input.kickerName, 80) || "群主";
    const timestamp = getNow().toISOString();
    const content = `[事件 ${formatChatTimestamp(timestamp)}] 你被${kickerName}移出了群聊「${groupName}」`;

    const entry: GroupKickMemoryEntry = {
        id: `group_kick_${groupSessionId}`,
        characterId,
        groupSessionId,
        groupName,
        kickerKey: cleanText(input.kickerKey, 160) || "self",
        kickerName,
        kind: "kick",
        timestamp,
        content,
    };
    upsert(characterId, entry);
    return entry;
}

/**
 * 记录被踢后的「记恨/对质」情绪反应（用于 AI 角色踢 AI 角色时，无角色间私聊通道，
 * 落地为记忆条目，之后在私聊/群聊/朋友圈中自然浮现）。
 */
export function recordGroupKickReaction(input: {
    characterId: string;
    groupSessionId: string;
    groupName?: string;
    kickerKey: string;
    kickerName?: string;
    message: string;
}): GroupKickMemoryEntry | null {
    const characterId = cleanText(input.characterId, 160);
    if (!characterId) return null;

    const groupName = cleanText(input.groupName, 80) || "群聊";
    const kickerName = cleanText(input.kickerName, 80) || "群主";
    const message = cleanText(input.message, 500);
    const timestamp = getNow().toISOString();
    const content = message
        ? `[事件 ${formatChatTimestamp(timestamp)}] 你因为被${kickerName}移出群聊「${groupName}」而私下找${kickerName}对质：${message}`
        : `[事件 ${formatChatTimestamp(timestamp)}] 你因为被${kickerName}移出群聊「${groupName}」而对${kickerName}记恨在心`;

    const entry: GroupKickMemoryEntry = {
        id: `group_kick_reaction_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        characterId,
        groupSessionId: cleanText(input.groupSessionId, 160),
        groupName,
        kickerKey: cleanText(input.kickerKey, 160) || "self",
        kickerName,
        kind: "reaction",
        timestamp,
        content,
    };
    upsert(characterId, entry);
    return entry;
}

export function loadGroupKickMemoryEntries(
    characterId: string,
    options?: { afterTimestamp?: string },
): GroupKickMemoryEntry[] {
    const entries = loadEventsByKey(storageKey(characterId));
    if (!options?.afterTimestamp) return entries;
    return entries.filter((entry) => entry.timestamp > options.afterTimestamp!);
}
