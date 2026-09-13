import { generateImageFromConfiguredApi } from "./image-generation-service";
import { updateStoryMessage, type StoryMessage } from "./story-storage";

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 为一条剧情消息生成配图。走「角色 > 剧情 APP > 全局」生图绑定解析（appId: "story"），
 * 支持角色参考图。状态机：pending → generated / failed，结果写回消息的 illustration 字段。
 */
export async function generateStoryIllustration(
  message: StoryMessage,
  characterId: string,
  description: string,
  useReferenceImage?: boolean,
): Promise<StoryMessage> {
  const prompt = description.trim();
  if (!prompt) throw new Error("缺少配图描述，无法生成");

  updateStoryMessage(message.id, {
    illustrationStatus: "pending",
    illustrationError: undefined,
    illustrationUseReference: useReferenceImage === true,
  });

  try {
    const generated = await generateImageFromConfiguredApi({
      description: prompt,
      characterId,
      appId: "story",
      useReferenceImage: useReferenceImage === true,
    });
    if (!generated) throw new Error("生图配置未启用或不完整");

    const updated = updateStoryMessage(message.id, {
      illustrationUrl: generated.dataUrl,
      illustrationMediaRef: generated.mediaRef,
      illustrationPrompt: generated.prompt,
      illustrationUseReference: generated.usedReferenceImage,
      illustrationStatus: "generated",
      illustrationError: undefined,
    });
    if (!updated) throw new Error("原消息不存在，无法写入配图");
    return updated;
  } catch (error) {
    updateStoryMessage(message.id, {
      illustrationStatus: "failed",
      illustrationError: errorToMessage(error),
    });
    throw error;
  }
}
