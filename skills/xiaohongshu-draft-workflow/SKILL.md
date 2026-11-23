---
name: xiaohongshu-draft-workflow
description: 检索小红书客户相关笔记，基于真实业务资料创作文案、生成本地图卡并暂存到小红书创作平台草稿箱。适用于从选题检索到草稿交接的单篇或逐篇批量任务。
---

使用已安装的 `xhs-workflow`，或在项目根目录调用 `node src/cli.mjs`。命令约定与安装见项目 README。

1. 先执行 `xhs-workflow doctor --live`。使用用户已有 Chrome 会话。连接、登录或验证受阻时报告具体环节，保留可独立完成的本地工作。
2. 读取用户业务资料，按 `examples/pilates.json` 的字段保存到项目 `.data/profile.json`。保留真实事实、表达样本和单次任务模型调用上限。缺少内容先问必要事实，仍可进行只读检索。
3. 执行 `search --profile .data/profile.json`。看分数的客户信号、同行信号和证据完整度，优先选择有客户疑问且适合本地业务的候选。评论数与实际读到的意图信号分别解释。
4. 对候选用 `inspect --source '完整搜索结果URL'`，把详情 JSON 存到 `.data/source.json`。签名链接仅用于本机，引用给用户时可展示去掉查询参数的笔记链接。读取失败时保持缺失状态。
5. 执行 `create --profile .data/profile.json --source .data/source.json`，取得任务 ID。接口使用本机环境变量中的凭据，每次调用受 `maxModelCalls` 约束。先文案后本地图卡，完成后核对稿件、事实证据和图片。
6. 用户已授权存草稿时，使用明确目标账号名与稳定浏览器配置标签执行 `save-draft --id ID --account '账号名' --browser-profile '配置标签'`。存稿会使用前台 Chrome 窗口。账号名读取并核对，但昵称可能重名，要求用户使用已确认的浏览器会话。
7. 交付稿件、来源、任务 ID、版本、回执级别、用量及待核验项。`browser-local-text-image-count-ai-declaration` 表示已回读本机浏览器草稿的文字、图片数量及 AI 声明。图片内容、排列视觉效果和跨设备可见性需要进一步核对。

`resume`、`reconcile` 与未知状态处理见 [references/recovery.md](references/recovery.md)。
