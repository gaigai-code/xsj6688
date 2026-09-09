import type { ChatMessage } from "./chat-storage";

const AVATAR_INTENT_PATTERNS = [
    /(?:换|改|设置|设成|设为|用作|当作|作为|换上).{0,8}(?:头像|头图)/i,
    /(?:头像|头图).{0,8}(?:换|改|设置|设成|设为|用这张|用这个|用它)/i,
    /(?:给你|你|把这张|这张|这个|它).{0,10}(?:当|做|换成|设为|用作|作为|换上).{0,6}(?:头像|头图)/i,
    /(?:这张|这个|它).{0,8}(?:适合|很配).{0,6}(?:你).{0,6}(?:头像|头图)/i,
];

function isAvatarChangeIntent(text: string): boolean {
    const normalized = text.replace(/\s+/g, "").trim();
    if (!normalized) return false;
    // “我换头像了”是在告知自己的变化，不应误判成要求角色换头像。
    const describesOwnAvatar = /^(?:我|用户).{0,8}(?:刚|已经|又)?(?:换|改|设置).{0,5}(?:头像|头图)/i.test(normalized);
    const directsOtherToChange = /(?:给你|帮你|让你|你也|你要不要|你该|你应该|对方|TA|char).{0,10}(?:换|改|设置|用|当).{0,6}(?:头像|头图)/i.test(normalized)
        || /(?:把这张|这张|这个|它).{0,10}(?:换成|设为|用作|作为|当作).{0,6}(?:头像|头图)/i.test(normalized);
    if (describesOwnAvatar && !directsOtherToChange) return false;
    return AVATAR_INTENT_PATTERNS.some(pattern => pattern.test(normalized));
}

function isUserImage(message: ChatMessage): boolean {
    return message.role === "user"
        && Boolean(message.mediaUrl)
        && (message.mediaType === "image"
            || (message.mediaType === "media_file" && message.mediaData?.fileType === "image"));
}

/** 只扫描上一条角色消息之后的输入，避免把很久以前的图片误换成头像。 */
export function findUserAvatarChangeIntent(
    history: ChatMessage[],
    sessionId: string,
    characterId?: string,
): { image: ChatMessage; intentText: string } | null {
    const currentTurn: ChatMessage[] = [];
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const message = history[index];
        if (message.sessionId !== sessionId) continue;
        if (message.role === "assistant") break;
        if (message.role === "user") currentTurn.push(message);
    }
    if (currentTurn.length === 0) return null;

    const image = currentTurn.find(message =>
        isUserImage(message)
        && (!message.mediaData?.avatarRecommendationForCharacterId
            || message.mediaData.avatarRecommendationForCharacterId === characterId),
    );
    if (!image) return null;

    const recommendationStatus = image.mediaData?.avatarRecommendationStatus;
    if (recommendationStatus === "accepted" || recommendationStatus === "declined") return null;
    if (image.mediaData?.avatarRecommendationForCharacterId === characterId
        && recommendationStatus === "pending") {
        return { image, intentText: image.mediaData?.label || "推荐头像" };
    }

    const intentText = currentTurn
        .flatMap(message => [message.content, message.mediaData?.label])
        .filter((value): value is string => Boolean(value?.trim()))
        .join("\n");
    return isAvatarChangeIntent(intentText) ? { image, intentText } : null;
}
