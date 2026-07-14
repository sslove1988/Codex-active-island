# Focus （Codex灵动岛）

一个为 Windows 设计的桌面灵动岛，把待办、专注倒计时、Codex 工作状态、每日笔记和常用提醒放在屏幕顶部。

当前版本：`0.2.3`

## 主要功能

### 灵动岛与 Codex 状态

- 常驻屏幕顶部，支持展开、收起、隐藏和鼠标拖动。
- 像素机器人展示 Codex 状态：睡觉代表空闲、电脑代表工作中、✅ 代表完成、❗代表失败。
- Codex 状态按任务是否正在执行判断，与窗口是否打开无关。
- 支持状态动效以及完成、失败和提醒声效。

### 待办与专注

- 管理今日和明日待办，支持新增、编辑、完成、删除及拖动排序。
- 已完成任务自动移到底部并显示删除线。
- 可为待办启动专注倒计时，支持暂停、继续、增加时间和提前完成。
- 收起灵动岛后仍可查看当前任务、剩余待办和倒计时。

### 提醒与每日笔记

- 支持喝水、久坐提醒，可设置间隔和生效时间。
- 每日笔记按 `YYYY-MM-DD.md` 保存到本地。
- 将保存目录选择为 Obsidian Vault 内的文件夹，即可在 Obsidian 中查看，无需额外插件。

### 其他工具

- 文本和图片剪贴板历史，支持复制、收藏、删除和全部清空。
- 系统媒体播放、暂停、上一首和下一首控制。
- 可调整透明度、尺寸、位置、颜色和音量，并保存自定义外观。
- 支持系统托盘和开机启动。

## 下载安装

前往仓库的 **Releases** 页面，下载：

```text
Focus_0.2.3_x64-setup.exe
```

双击安装即可。普通安装和使用 **不需要 Rust、Node.js 或其他开发环境**。

安装包目前没有商业代码签名；如果 Windows SmartScreen 提示未知发布者，请先确认文件来自本仓库，再选择“更多信息”继续运行。

## 从源码运行

二次开发或自行构建需要：

- Windows 10 / Windows 11
- Node.js 20+ 与 npm
- Rust 与 Cargo
- Visual Studio Build Tools（Desktop development with C++）
- Microsoft Edge WebView2 Runtime

```powershell
git clone https://github.com/你的用户名/Focus.git
cd Focus
npm install
npm run tauri -- dev
```

编译检查：

```powershell
npm run build
cd src-tauri
cargo check
```

生成 Windows 安装包：

```powershell
npm run tauri -- build --bundles nsis
```

安装包生成在 `src-tauri/target/release/bundle/nsis/`。

## 技术栈

- [Tauri 2](https://tauri.app/)
- [React 19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vite.dev/)
- [Rust](https://www.rust-lang.org/)
- [Lucide](https://lucide.dev/)

## 数据与隐私

- 待办、笔记、外观和提醒数据默认保存在本机。
- Focus 不会主动把待办、笔记或剪贴板上传到远程服务器。
- 剪贴板可能包含敏感内容；“全部清空”也会删除收藏记录。
- 上传源码前，请勿提交 `.env`、个人待办或本地状态文件。

## 已知限制

- 当前仅正式支持 Windows。
- 暂无应用内自动更新，需要从 Releases 手动安装新版。
- Codex 本地事件格式变化时，状态联动可能需要重新适配。
- 安装包尚未使用商业代码签名证书。

## 来源与许可

本项目基于 [zzliu93-debug/FocuSD](https://github.com/zzliu93-debug/FocuSD) 定制开发。

公开分发或接受贡献前，请确认原项目的许可要求，并为本仓库补充适用的 `LICENSE` 文件。
