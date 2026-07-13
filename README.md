## 它能做什么

### 灵动岛状态

- 常驻屏幕顶部，支持展开、收起、隐藏和鼠标拖动位置。
- 使用像素机器人直观展示状态：
  - 睡觉机器人：Codex 空闲中。
  - 电脑机器人：Codex 正在执行任务。
  - ✅ 机器人：任务已经完成。
  - ❗机器人：任务执行失败。
- 支持状态动效和完成、失败、提醒声效。
- 收起后仍能看到当前任务、专注倒计时或 Codex 状态，不必一直打开 Codex 窗口。

### 今日与明日待办

- 新增、编辑、完成和删除待办。
- 直接显示待办内容，例如“遛狗”，而不只显示剩余数量。
- 多条待办时显示“还剩 x 个待办”。
- 支持拖动调整任务顺序。
- 完成的任务自动移动到下方并显示删除线。
- 单独维护明日待办，并在日期变化后衔接到新一天。

### 专注倒计时

- 为某条待办启动专注倒计时。
- 支持选择时长、暂停、继续、增加 5 分钟和提前完成。
- 倒计时使用稳定的 SVG 沙漏图标，不依赖系统 Emoji 字体。
- 计时完成后播放提示音并更新灵动岛状态。

### Codex 状态联动

Focus 判断的是“Codex 是否正在处理任务”，而不是 Codex 窗口有没有打开。

状态流程如下：

```text
向 Codex 提交新任务
        ↓
检测 task_started / user_message
        ↓
Focus 显示工作中的电脑机器人
        ↓
检测 task_complete / cancel / failed
        ↓
显示完成、空闲或失败状态
```

0.2.3 的状态刷新规则：

- 新任务通常在约 0.2～0.5 秒内显示为“工作中”。
- 完成状态显示约 4 秒，然后恢复空闲。
- 失败状态显示约 8 秒，然后恢复空闲。
- 取消任务后直接恢复空闲。
- 如果 Codex 没有写入结束事件，最长约 2 分钟后自动恢复空闲，避免永久卡在“工作中”。

Focus 会读取本机 Codex 会话事件；设置页也提供状态联动脚本的安装或修复入口，用作兼容和兜底。

### 定时提醒

- 喝水提醒。
- 久坐提醒。
- 可设置是否启用、提醒间隔和生效时间段。
- 提醒出现时可完成或稍后再提醒。

### 每日笔记与 Obsidian

- 在 Focus 中记录每日笔记。
- 选择保存文件夹后，按日期保存为 `YYYY-MM-DD.md`。
- 如果把保存目录设置为 Obsidian Vault 内的文件夹，笔记就会直接出现在 Obsidian 中。

这里采用的是本地 Markdown 文件联动，不依赖 Obsidian 插件或网络 API。因此 Obsidian 不需要一直运行，文件也不会被上传到云端。

### 剪贴板、音乐与外观

- 保存文本和图片剪贴板历史。
- 支持复制、收藏、删除和“全部清空”。
- “全部清空”也会清除收藏内容，请谨慎操作。
- 支持系统媒体的播放/暂停、上一首和下一首。
- 可调整透明度、尺寸、位置、颜色和声音音量。
- 支持保存自定义外观，并设置开机默认外观方案。
- 支持系统托盘和开机启动。

## 下载安装

前往仓库的 **Releases** 页面，下载最新的 Windows 安装包：

```text
Focus_0.2.3_x64-setup.exe
```

双击安装后即可使用。普通安装和使用 **不需要安装 Rust、Node.js 或其他开发环境**。

如果 Windows SmartScreen 提示未知发布者，请先确认安装包来自本仓库，再选择“更多信息”继续运行。当前安装包尚未使用商业代码签名证书。

## 首次使用建议

1. 启动 Focus，点击灵动岛展开完整界面。
2. 在“今日任务”中添加一条测试待办，例如“遛狗”。
3. 给任务启动一个短时间专注倒计时，确认暂停和完成提示正常。
4. 打开设置，配置声音、外观和开机启动。
5. 需要每日笔记时，选择一个普通文件夹或 Obsidian Vault 内的文件夹。
6. 需要 Codex 联动时，在设置中安装或修复 Codex 状态联动。

## 从源码运行

### 开发环境

只有修改源码或自行构建安装包时才需要以下环境：

- Windows 10 / Windows 11
- Node.js 20 或更高版本
- npm
- Rust 与 Cargo
- Microsoft Visual Studio Build Tools（Desktop development with C++）
- Microsoft Edge WebView2 Runtime

### 安装依赖

```powershell
git clone https://github.com/你的用户名/Focus.git
cd Focus
npm install
```

### 启动桌面开发版

```powershell
npm run tauri -- dev
```

只预览前端界面：

```powershell
npm run dev
```

### 编译检查

```powershell
npm run build
cd src-tauri
cargo check
```

### 生成 Windows 安装包

```powershell
npm run tauri -- build --bundles nsis
```

生成结果位于：

```text
src-tauri/target/release/bundle/nsis/
```

## 技术栈

- [Tauri 2](https://tauri.app/)：桌面窗口、托盘和 Windows 原生能力。
- [React 19](https://react.dev/)：界面与交互状态。
- [TypeScript](https://www.typescriptlang.org/)：前端类型检查。
- [Vite](https://vite.dev/)：开发服务器和前端构建。
- [Rust](https://www.rust-lang.org/)：窗口定位、文件读写、剪贴板、Codex 状态检测和系统能力。
- [Lucide](https://lucide.dev/)：清晰、统一的 SVG 图标。

## 项目结构

```text
Focus/
├─ src/
│  ├─ App.tsx                  # 主界面、待办、倒计时和状态逻辑
│  ├─ App.css                  # 界面样式与动效
│  └─ main.tsx                 # React 入口
├─ src-tauri/
│  ├─ src/lib.rs               # Tauri 命令、窗口与 Codex 状态检测
│  ├─ src/clipboard_history.rs # 剪贴板历史
│  ├─ capabilities/            # Tauri 权限配置
│  └─ tauri.conf.json          # 应用与安装包配置
├─ scripts/                    # Codex / Agent 状态联动脚本
├─ docs/                       # 补充说明
├─ package.json
└─ README.md
```

## 数据与隐私

- 待办、外观、提醒设置等主要保存在本机应用数据中。
- 每日笔记仅在用户选择保存目录后写入本地 Markdown 文件。
- 剪贴板历史可能包含敏感文本或图片，请不要在公共电脑上开启该功能。
- “全部清空”会同时删除普通和收藏的剪贴板记录。
- Focus 不需要把待办、笔记或剪贴板上传到远程服务器。
- 上传源码到 GitHub 前，请勿提交 `.env`、个人待办、状态文件或其他私密资料。

## 已知限制

- 当前仅正式支持 Windows。
- 暂无应用内自动更新，需要从 Releases 手动下载安装新版。
- Codex Desktop 的本地事件格式未来可能变化；如果联动失效，可先在设置中重新安装状态联动并提交 Issue。
- 安装包目前没有商业代码签名，Windows 可能显示安全提示。

## 参与开发

欢迎提交 Issue 和 Pull Request。报告问题时请尽量附上：

- Windows 版本和 Focus 版本。
- 问题截图或录屏。
- 可以稳定复现问题的操作步骤。
- 预期结果和实际结果。

修改代码后建议至少运行：

```powershell
npm run build
cd src-tauri
cargo check
```

## 来源与许可

本项目是在 [zzliu93-debug/FocuSD](https://github.com/zzliu93-debug/FocuSD) 基础上进行的定制与持续迭代。

公开发布或接受他人贡献前，请确认原项目的开源许可要求，并在仓库中补充适用的 `LICENSE` 文件。没有明确许可证时，代码默认不代表任何人都可以自由复制、修改或再分发。
