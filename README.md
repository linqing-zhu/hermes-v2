# Hermes 控制中心 (hermes v2)

一个 **Multi-Agent 控制中心**前端：看板 + 调度区 + 多节点（本机 / 远程 Hermes）+ 派发任务 + 对话 + Obsidian 笔记浏览。
React 19 + Vite + TypeScript，跨平台（Windows / macOS / Linux）。

---

## 1. 先装好环境

- **Node.js 20+**（必装）：https://nodejs.org —— 装完终端输入 `node -v` 能看到版本即可。
- **Hermes**（看真实数据才需要）：要看到看板任务 / 子 agent / 会话，需要本机装好 Hermes 并开启 API Server。
  - 不装也能把界面跑起来，只是看板 / agent 是空的。

## 2. 拿到代码并启动

```bash
git clone https://github.com/linqing-zhu/hermes-v2.git
cd hermes-v2
npm install        # 拉依赖（约 170MB，仓库里不含，正常）
npm run dev        # 启动，终端会打印本地地址，浏览器打开即可
```

> 仓库不含 `node_modules`，所以**必须先 `npm install`**。

## 3. 第一次使用：让本机连上 Hermes

界面打开后，左下角 **配置 → Hermes 节点管理**：

- **本机节点**是自动识别的。如果显示「离线」，说明 Hermes 的 API Server 没开。
- 点本机那行的 **「✎ 说明」**，里面有一张可一键复制的提示词卡片。把这句话发给你本机的 Hermes，让它自己开好 API Server（默认端口 `8642`）：

  > 帮我给这台机器开启 API Server，端口用 8642，生成一个随机 API Key 保存到 .env 里，然后重启 gateway

- 开好后刷新页面，本机节点即可正常使用。点 **「✎ 编辑」** 可以给本机改个名字。

## 4. 添加远程节点（可选）

配置 → 节点管理 → **添加远程节点**：填另一台跑着 Hermes 的机器的 `IP:端口` + API Key。
- 只填地址 + API Key：能对话 + 看状态。
- 额外配 **SSH 别名**（在本机 `~/.ssh/config` 里）：才能读该节点的看板和子 agent。面板里有一张「查找 / 配置 SSH 别名」的提示词卡片，可直接发给本机 Hermes 让它帮你配。

## 5. Obsidian 笔记（可选）

左侧 **文档** → 输入你的 Obsidian vault 目录 → 刷新，即可在树形目录里浏览、阅读本机的 Markdown 笔记。

---

## 平台说明

- **前端 + 界面**：Windows / macOS / Linux 都能跑（只要有 Node.js）。
- **真实数据**（看板 / agent / 会话）：需本机装有 Hermes。
  - Windows：数据目录 `%LOCALAPPDATA%\hermes`
  - macOS / Linux：数据目录 `~/.hermes`，Python 走 `~/.hermes/hermes-agent/venv/bin/python`
- macOS 自带 `ssh`，远程节点的 SSH 功能开箱可用。

## 常用命令

```bash
npm run dev      # 开发启动
npm run build    # 生产构建（tsc + vite build）
npm run lint     # 代码检查
```
