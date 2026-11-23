# 小红书客户向草稿工作流

从行业与业务档案出发，检索小红书客户相关笔记，基于真实资料创作文案、生成本地图卡，并暂存到创作平台的浏览器本地草稿箱。附带可安装的 Codex Skill。

## 能力

- 多关键词检索、按笔记 ID 去重，综合客户信号、地域匹配、互动和同行线索评分。
- 对前列候选读取详情与评论，报告证据缺失。评分为启发式候选排序，实际获客表现需要咨询与到店数据验证。
- 先完成文案与事实校验，再生成本地 PNG 图卡。图片渲染免费，文字模型按供应商计费。
- 任务持久化、进程锁、模型调用预算、失败续作和未知结果对账。
- 存稿时使用可见的前台 Chrome 窗口，核对创作平台账号昵称，绑定稿件版本、图片哈希和浏览器配置标签。

草稿回读覆盖文字、图片数量和 AI 声明。现有通道使用浏览器 IndexedDB，图片内容与视觉顺序、账号唯一 ID 和跨设备同步仍需人工核对。浏览器配置标签用于记录，实际浏览器由 OpenCLI 扩展连接。公开发布应由用户在平台完成。

## 安装

使用 Node.js 24 或更高版本。Chrome 需已安装 OpenCLI 扩展，并登录小红书及创作服务平台。草稿适配器依赖 `@jackwener/opencli` 2.0.3 的内部模块，启动时检查版本。请先按 [OpenCLI 官方说明](https://github.com/jackwener/opencli) 安装并连接该版本。

```sh
npm ci
npm link
xhs-workflow doctor --live
```

OpenCLI 可通过 `XHS_OPENCLI_BIN` 指定。本项目支持通用用户安装和已有工作台安装的发现路径。运行环境需具备中文字体，macOS 使用系统字体，Linux 建议安装 Noto Sans CJK 后检查图卡文字。

凭据通过本机 shell 环境传入。`.env.example` 只提供变量名，项目不会自动加载 `.env`。`XHS_MODEL_BASE_URL` 指向 OpenAI-compatible API 的版本根地址，例如服务商提供的 `/v1` 入口。模型名与凭据分别使用 `XHS_MODEL_NAME` 和 `XHS_MODEL_API_KEY`。使用提供 `chat/completions` 和 JSON 输出模式的模型。

运行数据默认保存于当前目录 `.data/`，可通过 `XHS_DATA_DIR` 指定其他本地位置。目录包含业务资料和签名链接，应保留在本机。

## 单篇流程

先建立本地业务档案，替换合成示例中的地区和真实事实。

```sh
mkdir -p .data
cp examples/pilates.json .data/profile.json
xhs-workflow search --profile .data/profile.json --limit 10 --inspect 5
```

从结果选择客户相关候选，使用返回的完整 URL 读取详情。

```sh
xhs-workflow inspect --source '完整笔记URL' > .data/source.json
xhs-workflow create --profile .data/profile.json --source .data/source.json
xhs-workflow status --id '任务UUID'
```

查看返回正文和本地图片，核对内容。确认目标账号后存稿。

```sh
xhs-workflow save-draft --id '任务UUID' --account '创作平台账号昵称' --browser-profile '日常创作Chrome'
```

每个任务默认最多调用一次文字模型，业务档案可以设置 `maxModelCalls` 为 1–5。供应商返回的 tokens 和请求 ID 保存在任务记录中，实际金额未知时保留 `null`。没有自动重试模型。模型请求限制最大输出 tokens，供应商价格与实扣需要自行核对。

目前以逐篇任务支持批量使用。搜索限制、详情检查量和串行间隔用于控制请求规模，出现平台验证时先在 Chrome 处理。

## 恢复

```sh
xhs-workflow resume --id '任务UUID'
xhs-workflow reconcile --id '任务UUID' --account '创作平台账号昵称' --browser-profile '日常创作Chrome'
```

模型结果未知时，先核对供应商记录，再决定是否使用 `--retry-model`。存稿未知状态只允许先对账。详细流程见 [Skill 恢复说明](skills/xiaohongshu-draft-workflow/references/recovery.md)。

## Skill 安装

先完成项目安装和 `npm link`，再安装 Skill。

```sh
mkdir -p "$HOME/.codex/skills"
cp -R skills/xiaohongshu-draft-workflow "$HOME/.codex/skills/"
```

在 Codex 中使用 `$xiaohongshu-draft-workflow` 并提供目标行业、地区、客户画像及真实业务资料。Skill 调用同一 CLI，复用同一状态与恢复逻辑。

## 验证与敏感信息检查

```sh
npm test
npm audit
npm run scan
```

`scan` 检查 Git 跟踪文件中的常见凭据格式、非空敏感配置、签名链接、私人路径以及环境中提供的密钥原值。发布前再使用 Gitleaks 检查提交历史。扫描通过说明当前规则未发现敏感信息，需要结合实际文件清单审查。

依赖锁文件、合成样例和源码进入仓库，运行数据、用户素材、账号记录与凭据保留在本机。验证状态见 [验收记录](VALIDATION.md)。

## 模块

`discovery.mjs` 管理检索和评分，`workflow.mjs` 管理任务状态，`model.mjs` 只从环境读取凭据，`render.mjs` 生成图卡，`opencli.mjs` 提供平台适配，`draft-browser.mjs` 复用并独立整理现有工作台暂存逻辑。

本项目以独立新历史交付，原有工作台继续保留。第三方 OpenCLI 通过外部安装接入，使用须遵守其许可及平台要求。
