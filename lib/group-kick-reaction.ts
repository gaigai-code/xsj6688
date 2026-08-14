import { getNow } from "./virtual-time";
// lib/group-kick-reaction.ts
// 角色被踢出群聊后的反应引擎（对称于 friend-request-engine 的删除好友反应）。
// 永远先落「被踢」记忆，再（若被踢角色是用户联系人）用 LLM 基于人设/关系/记忆
// 决定：放弃 / 找对方表达 / 向用户倾诉 / 发朋友圈，并落地为可见动作。

import { loadCharacters } from "./character-storage";
import {
    loadChatSessions,
    loadChatMessages,
    loadChatContacts,
    pushChatMessage,
    type ChatMessage,
} from "./chat-storage";
import { generateChatCompletion, flattenCompletionResult } from "./chat-engine";
import { recordGroupKickMemory, recordGroupKickReaction } from "./group-kick-memory";
import { dispatchChatMessageNotice } from "./chat-notification-events";
import { GROUP_SELF_KEY } from "./group-admin";
import { stripStateAndInnerForPrompt } from "./prompt-sanitizer";
import { addMomentPost } from "./moments-storage";
import type { ContentAppId } from "./settings-types";

export type GroupKickReactionInput = {
    characterId: string;      // 被踢角色
    groupSessionId: string;
    groupName?: string;
    kickerKey: string;        // GROUP_SELF_KEY（用户）或角色 id
    kickerName?: string;
};

type GroupKickParsed =
    | { action: "ignore" }
    | { action: "find"; message: string }
    | { action: "vent"; message: string }
    | { action: "post"; message: string };

/**
 * 触发被踢反应。fire-and-forget —— 调用方自行 `.catch(() => {})`。
 */
export async function triggerGroupKickReaction(input: GroupKickReactionInput): Promise<void> {
    const characterId = input.characterId;
    const chars = loadCharacters();
    const char = chars.find(c => c.id === characterId);
    if (!char) return;

    const groupName = input.groupName?.trim() || "群聊";
    const kickerName = input.kickerName?.trim()
        || (input.kickerKey === GROUP_SELF_KEY ? "用户" : "群主");

    // 1. 先落被踢记忆（同步写库，早于 LLM 调用，使短期上下文能看到）
    recordGroupKickMemory({
        characterId,
        groupSessionId: input.groupSessionId,
        groupName,
        kickerKey: input.kickerKey,
        kickerName,
    });

    // 2. 仅当被踢角色是用户联系人（存在私聊会话）时才做主动反应
    const sessions = loadChatSessions();
    const session = sessions.find(s => !s.isGroup && s.contactId === characterId);
    if (!session) return;

    const messages = loadChatMessages(session.id);
    const augmented: ChatMessage[] = [
        ...messages,
        {
            id: "virtual_group_kick_hint",
            sessionId: session.id,
            role: "system",
            content: `你刚刚被「${kickerName}」移出了群聊「${groupName}」。`,
            status: "sent",
            createdAt: getNow().toISOString(),
        },
    ];

    let aiResponse: string;
    try {
        aiResponse = flattenCompletionResult(await generateChatCompletion(
            session,
            augmented,
            { appId: "group_kick" as ContentAppId },
        ));
    } catch (err) {
        console.warn(`[GroupKick] Failed to generate reaction for ${characterId}:`, err);
        return;
    }

    const parsed = parseGroupKickResponse(aiResponse);
    if (parsed.action === "ignore") return;

    // 发朋友圈：无论谁踢的，都可以公开发条情绪动态
    if (parsed.action === "post") {
        postMomentReaction(characterId, parsed.message);
        return;
    }

    if (input.kickerKey === GROUP_SELF_KEY) {
        // 踢人者 = 用户：找对方 → 主动私聊用户表达情绪
        if (parsed.action === "find") {
            pushProactiveMessage(session.id, char.name, parsed.message);
        }
        // 「向用户倾诉」在用户踢人的场景无意义，忽略
        return;
    }

    // 踢人者 = AI 角色
    if (parsed.action === "find") {
        // 对 AI 角色无私聊通道 → 记为「记恨/对质」记忆
        recordGroupKickReaction({
            characterId,
            groupSessionId: input.groupSessionId,
            groupName,
            kickerKey: input.kickerKey,
            kickerName,
            message: parsed.message,
        });
    } else if (parsed.action === "vent") {
        // 向用户倾诉/吐槽
        pushProactiveMessage(session.id, char.name, parsed.message);
    }
}

function pushProactiveMessage(sessionId: string, senderName: string, message: string): void {
    const clean = stripStateAndInnerForPrompt(message);
    if (!clean) return;
    pushChatMessage({
        sessionId,
        role: "assistant",
        content: clean,
    });
    dispatchChatMessageNotice({
        sessionId,
        senderName,
        body: clean.slice(0, 80),
    });
}

function postMomentReaction(characterId: string, message: string): void {
    const clean = stripStateAndInnerForPrompt(message);
    if (!clean) return;
    const visibility = loadChatContacts().map(c => c.characterId);
    const post = addMomentPost({
        authorType: "character",
        authorId: characterId,
        content: clean,
        visibility,
    });
    if (!post) return;
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("moments-updated"));
    }
}

function parseGroupKickResponse(text: string): GroupKickParsed {
    if (!text) return { action: "ignore" };

    const findMatch = text.match(/\[找对方\]([\s\S]*?)(?:\[向用户倾诉\]|\[发朋友圈\]|$)/);
    const ventMatch = text.match(/\[向用户倾诉\]([\s\S]*?)(?:\[找对方\]|\[发朋友圈\]|$)/);
    const postMatch = text.match(/\[发朋友圈\]([\s\S]*?)(?:\[找对方\]|\[向用户倾诉\]|$)/);

    if (findMatch && findMatch[1].trim()) {
        return { action: "find", message: findMatch[1].trim() };
    }
    if (ventMatch && ventMatch[1].trim()) {
        return { action: "vent", message: ventMatch[1].trim() };
    }
    if (postMatch && postMatch[1].trim()) {
        return { action: "post", message: postMatch[1].trim() };
    }

    // 放弃关键字，或无法解析 → 不做任何反应
    return { action: "ignore" };
}
