# 参考图生图

一个可导入应用市场的生图工具 APP，把「人物参考图」从角色卡里取出来、再交给 AI 生图。

## 功能

- **多角色参考图生图**：从已配置参考图的角色里**多选**（最多 4 位），APP 会把多位角色的参考图横向拼成一张，作为唯一参考图交给生图接口，生成多人同框、形象一致的新图。
- **上传图片做参考**：也可以不上传角色参考图，直接选一张本地图片（或上传一张 + 角色参考图混搭），让 AI 助手按这张图作为参考图生图。
- **纯文字生图**：什么都不选时，退化为按描述纯文字生图。

## 使用前提

- 宿主已在小手机「设置 → 生图」里配置并启用生图 API（OpenAI 兼容接口）。
- 想用「角色参考图」时，需要先在「设置 → 生图」里为对应角色上传过参考图。

> 注：NovelAI 模式暂不支持图生图参考图，此时 APP 会提示「未使用参考图」。

## 权限

| 权限 | 用途 |
| --- | --- |
| `ai.generateImage` | 调用宿主已配置的生图 API |
| `characters.read` | 读取已配置参考图的角色列表 |
| `ui.toast` | 操作提示 |
| `app.data.write` | 保存生成结果到媒体库 |

## 实现要点（供开发者参考）

- 用 `AiPhone.characters.referenceImages()` 拿到「角色 → 参考图 dataURL」列表。
- 多张参考图在 APP 内用 `<canvas>` 横向拼接成一张，再通过 `AiPhone.ai.generateImage({ prompt, referenceImageDataUrl })` 传入。
- 返回 `{ ok, dataUrl, usedReferenceImage, ... }`，`usedReferenceImage` 表示本次是否真的用上了参考图。
