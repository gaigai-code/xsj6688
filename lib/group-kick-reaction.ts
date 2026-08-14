import { getNow } from "./virtual-time";
// lib/group-kick-reaction.ts
// 角色被踢出群聊后的反应引擎。
// 复用现有「主动消息」与「朋友圈」派发机制：LLM 输出动作标签（[消息]/[朋友圈]），
// 由 action-parser 的 dispatchActions 派发——主动私聊走 dispatchChatMessage
// （自动建联系人/会话 + parseAndSaveResponse，消息正确出现在用户消息界面 + 通知 + 状态值），
// 朋友圈走 dispatchMomentsPost。不再手动拼消息。

import { loadCharacters } from "./character-storage";
import {
    loadChatSessions,
    loadChatMessages,
    createOrGetSession,
    type ChatMessage,
} from "./chat-storage";
import { generateChatCompletion, flattenCompletionResult } from "./chat-engine";
import { recordGroupKickMemory } from "./group-kick-memory";
import { GROUP_SELF_KEY } from "./group-admin";
import { parseActionTags, dispatchActions } from "./action-parser";
import { parseAndSaveResponse } from "./follow-up-service";
import { stripStateAndInnerForPrompt } from "./prompt-sanitizer";

export type GroupKickReactionInput = {
    characterId: string;      // 被踢角色
    groupSessionId: string;
    groupName?: string;
    kickerKey: string;        // GROUP_SELF_KEY（用户）或角色 id
    kickerName?: string;
};

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
    console.log(`[GroupKick] 触发被踢反应: 角色=${char.name}, 踢人者=${kickerName}, 群=${groupName}`);

    // 1. 落被踢记忆（同步写库，早于 LLM 调用，使短期上下文能看到）
    recordGroupKickMemory({
        characterId,
        groupSessionId: input.groupSessionId,
        groupName,
        kickerKey: input.kickerKey,
        kickerName,
    });

    // 2. 确保被踢角色有私聊会话（即使原本不是联系人，也让它能「主动来找用户」）
    const sessions = loadChatSessions();
    let session = sessions.find(s => !s.isGroup && s.contactId === characterId);
    if (!session) {
        session = createOrGetSession(characterId);
        console.log(`[GroupKick] ${char.name} 原本不是联系人，已创建私聊会话 ${session.id}`);
    }

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
        // appId 用 "chat" 走单聊的 API 绑定；appTags 带 chat/text/group_kick，
        // 让模型处于「单聊」语境、以第一人称自然输出，同时注入被踢反应预设。
        aiResponse = flattenCompletionResult(await generateChatCompletion(
            session,
            augmented,
            { appId: "chat", appTags: ["chat", "text", "group_kick"] },
        ));
        console.log(`[GroupKick] ${char.name} 被踢反应 LLM 输出:`, aiResponse.slice(0, 300));
    } catch (err) {
        console.error(`[GroupKick] ${char.name} 被踢反应 LLM 失败:`, err);
        return;
    }

    // 3. 提取动作标签（[朋友圈]/[消息]），走现成的派发机制
    const { cleanText, actions } = parseActionTags(aiResponse);
    if (actions.length > 0) {
        console.log(`[GroupKick] ${char.name} 动作标签:`, actions.map(a => a.type).join("、"));
        dispatchActions(actions, {
            characterId,
            sessionId: session.id,
            sourceEngine: "chat",
        }).catch(err => console.warn(`[GroupKick] ${char.name} 动作派发失败:`, err));
    }

    // 4. 剩余的第一人称话 → 当作主动私聊消息保存（正确出现在用户消息界面）
    if (stripStateAndInnerForPrompt(cleanText).trim()) {
        await parseAndSaveResponse(cleanText, session.id, 0, undefined, messages);
    }
}
