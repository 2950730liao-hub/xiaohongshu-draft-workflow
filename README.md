# 小红书客户向草稿工作流

从行业与业务档案出发，检索小红书客户相关笔记，基于真实资料创作文案、生成本地图卡，并暂存到创作平台的浏览器本地草稿箱。附带可安装的 Codex Skill。

## 能力

- 多关键词检索、按笔记 ID 去重，综合客户信号、地域匹配、互动和同行线索评分。
- 对前列候选读取详情与评论，报告证据缺失。评分为启发式候选排序，实际获客表现需要咨询与到店数据验证。
- 先完成文案与事实校验，再生成本地 PNG 图卡。图片渲染免费，文字模型按供应商计费。
- 任务持久化、进程锁、模型调用预算、失败续作和未知结果对账。
- 存稿时使用可见的前台 Chrome 窗口，核对创作平台账号昵称，绑定稿件版本、图片哈希和浏览器配置标签。

草稿回读覆盖文字、图片数量和 AI 声明。现有通道使用浏览器 IndexedDB，图片内容与视觉顺序、账号唯一 ID 和跨设备同步仍需人工核对。浏览器配置标签用于记录，实际浏览器由 OpenCLI 扩展连接。公开发布应由用户在平台完成。

## 环境与插件

| 组件                        | 要求与用途                                                    | 安装方式                                                            |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| 操作系统                    | macOS / Linux，支持 Apple Silicon、ARM64 和 x64               | macOS 已实测，Linux 安装分支待目标机器验收                          |
| Node.js 与 npm              | Node 24 或更高，运行项目与图片渲染                            | 一键脚本复用合适版本，缺少时安装官方 Node 24 到项目 `.runtime/node` |
| 项目依赖                    | sharp 图卡渲染、测试依赖                                      | 按 `package-lock.json` 自动安装                                     |
| OpenCLI                     | 固定 `@jackwener/opencli` 2.0.3，提供检索和浏览器桥接         | 自动安装到项目 `.runtime/opencli`                                   |
| Google Chrome               | 运行小红书登录会话及创作平台                                  | 先安装并打开 [Google Chrome](https://www.google.com/chrome/)        |
| OpenCLI Browser Bridge 扩展 | 将 Chrome 连接到 OpenCLI，匹配版本为 1.0.27                   | 脚本自动下载并解压，随后本人在 Chrome 启用                          |
| 中文字体                    | 图卡中文渲染                                                  | macOS 使用系统字体，Linux 安装 Noto Sans CJK 后检查出图             |
| Codex                       | 使用随项目提供的 Skill                                        | 自动复制 Skill 到用户级 Codex 目录，CLI 可独立使用                  |
| 文字模型 API                | 支持 `chat/completions` 与 JSON 输出的 OpenAI-compatible 接口 | 本人在本机环境变量中配置                                            |

安装脚本使用系统自带 Bash、curl、tar、awk、SHA256 工具及 unzip。macOS 通常已经具备。Linux 缺少基础工具时，按发行版安装这些工具及中文字体。Windows 原生一键安装尚未提供。

## 一键安装

下载或克隆此仓库，进入项目目录，执行一条命令。

```sh
bash install.sh
```

macOS 也可双击仓库内的 `安装环境.command`。首次执行被系统拦截时，使用上述终端命令。

安装器会检查 Node，安装项目依赖与锁定版本的 OpenCLI，下载并验证浏览器扩展 SHA256，创建 `~/.local/bin/xhs-workflow` 入口，安装 Codex Skill，最后运行离线 doctor。Node 下载使用官方发布的 SHA256 清单校验。可重复执行安装，已有凭据和小红书登录由用户原来的环境管理。

安装器使用用户目录与项目内 `.runtime/`，无需 sudo。首次需要联网下载依赖。安装结果会打印 CLI 和扩展目录。

### Chrome 中完成连接

1. 安装并打开 Chrome。在地址栏打开 `chrome://extensions`，开启右上角“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择安装器打印的 `.runtime/browser-extension` 目录。该目录需要保留。也可选择安装 [Chrome 商店中的 OpenCLI](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk)，商店版本可能随上游更新。
3. 在该 Chrome 配置中登录小红书和 [创作服务平台](https://creator.xiaohongshu.com/)。
4. 在终端执行连接检查。

```sh
export PATH="$HOME/.local/bin:$PATH"
xhs-workflow doctor --live
```

浏览器扩展启用、登录、验证码与 API 凭据配置需要本人完成。安装器完成后会显示这些待办。`doctor` 验证软件模块，`doctor --live` 额外验证创作平台登录连接。`modelConfigured: false` 表示文字模型配置尚未齐全。

### 文字模型配置

项目通过当前进程的环境变量读取凭据。参考仓库 `.env.example` 中的变量名，在本机 shell 中填写。`.env` 文件不会自动加载。不要把实际凭据填写到 Git 跟踪文件。

- `XHS_MODEL_BASE_URL` 填服务商提供的版本根地址，通常以 `/v1` 结尾。
- `XHS_MODEL_NAME` 填可调用的模型名。
- `XHS_MODEL_API_KEY` 填本人的密钥。
- `XHS_DATA_DIR` 可指定本地运行目录，默认是当前工作目录的 `.data/`。
- `XHS_OPENCLI_BIN` 可覆盖安装器提供的 OpenCLI 路径，覆盖版本需通过 doctor 检查。

配置完成后运行 `xhs-workflow doctor`，检查 `modelConfigured`。运行数据包含业务资料和签名链接，应保留在本机。

### 安装位置和故障处理

安装器默认创建用户级入口和 Skill。可通过 `XHS_INSTALL_BIN_DIR`、`XHS_INSTALL_SKILL_DIR` 改变目标目录。目标路径属于其他工具时会停止并报告。目录移动后重新执行 `bash install.sh`，更新入口的绝对路径。

网络失败时修复网络后重新运行。安装进程异常退出留下 `.runtime/install.lock` 时，先确认旧安装进程已退出再移除该锁目录。Node 校验失败时保留报错并重新下载，避免跳过校验。

### 手动安装

已具备 Node 24、OpenCLI 2.0.3 和扩展时，可使用以下步骤。`npm link` 的全局 bin 路径取决于本机 npm 配置，也可直接运行 `node src/cli.mjs`。

```sh
npm ci
node src/cli.mjs doctor --live
```

OpenCLI 安装与扩展说明参见 [官方 README](https://github.com/jackwener/opencli/blob/main/README.md)。

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

## Skill 使用

一键安装已复制 Skill。重启 Codex 或开启新聊天后，使用 `$xiaohongshu-draft-workflow` 并提供目标行业、地区、客户画像及真实业务资料。Skill 调用同一 CLI，复用同一状态与恢复逻辑。单独手动安装时，可将 `skills/xiaohongshu-draft-workflow` 目录复制到 `~/.codex/skills/`。

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
