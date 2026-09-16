"use client";

import { useEffect, useMemo, useState } from "react";
import { getActiveCall, subscribeActiveCall, setCallMinimized, endCall, type ActiveCall } from "@/lib/call-store";
import { loadChatSessions } from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { requestBackgroundChatReply } from "@/lib/follow-up-service";
import { VoiceCallScreen } from "./voice-call-screen";
import { VideoCallScreen } from "./video-call-screen";
import { GroupCallScreen } from "./group-call-screen";

// 全局通话 overlay：挂在桌面壳的 .phone-shell 内（聊天 App 之外），
// 使通话在退出聊天 App、切到桌面或其它 App 后仍常驻。
// 通话状态来自 lib/call-store.ts，ChatRoom 只负责 startCall 触发。
export function GlobalCallOverlay() {
    const [activeCall, setActiveCall] = useState<ActiveCall>(() => getActiveCall());

    useEffect(() => subscribeActiveCall(() => setActiveCall(getActiveCall())), []);

    // 按 sessionId 加载会话（loadChatSessions 返回缓存引用，find 廉价）
    const session = useMemo(() => {
        if (!activeCall) return null;
        return loadChatSessions().find(s => s.id === activeCall.sessionId) ?? null;
    }, [activeCall?.sessionId]);

    // 单聊角色
    const character = useMemo(() => {
        if (!session || session.isGroup) return null;
        return loadCharacters().find(c => c.id === session.contactId) ?? null;
    }, [session?.id, session?.isGroup, session?.contactId]);

    // 群聊参与者
    const characters = useMemo(() => {
        if (!session || !session.isGroup) return [];
        const chars = loadCharacters();
        return (session.participantIds || [])
            .map(id => chars.find(c => c.id === id))
            .filter((c): c is Character => Boolean(c));
    }, [session?.id, session?.participantIds]);

    // 会话/角色被删除等异常兜底：结束通话，避免悬空 overlay
    useEffect(() => {
        if (!activeCall) return;
        if (!session || (activeCall.isGroup && characters.length === 0)) {
            endCall();
        }
    }, [activeCall, session, characters]);

    if (!activeCall || !session) return null;
    if (activeCall.isGroup && characters.length === 0) return null;
    if (!activeCall.isGroup && !character) return null;

    const handleEnd = () => {
        const sessionId = session.id;
        endCall();
        // 通知 ChatRoom 刷新挂断消息（ChatRoom 监听 chat-messages-updated）
        window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId } }));
        // 挂断后角色补一句（后台生成，ChatRoom 未挂载也能工作）
        void requestBackgroundChatReply(sessionId);
    };

    const handleRestore = () => {
        setCallMinimized(false);
        // 跨 App 切回聊天并打开本会话
        window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "chat", sessionId: session.id } }));
    };

    if (activeCall.isGroup) {
        return (
            <GroupCallScreen
                type={activeCall.type}
                session={session}
                characters={characters}
                initiator={activeCall.initiator}
                initiatorName={activeCall.initiatorName}
                onEnd={handleEnd}
            />
        );
    }

    const shared = {
        session,
        character: character!,
        initiator: activeCall.initiator,
        minimized: activeCall.minimized,
        onMinimize: () => setCallMinimized(true),
        onRestore: handleRestore,
        onEnd: handleEnd,
    };

    return activeCall.type === "video"
        ? <VideoCallScreen {...shared} />
        : <VoiceCallScreen {...shared} />;
}
