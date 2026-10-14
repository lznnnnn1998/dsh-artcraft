<div align="center">

# ArtCraft × DSH

**十二个创作应用,一个智能体,零源码改动。**

[ArtCraft](https://github.com/storytold) 组织的全部应用 —— CAD、表格、音频、视频、照片、矢量、
PDF、幻灯片、文档 —— 全部以一等插件的形式接入
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4D6BFE?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![built on Cordis](https://img.shields.io/badge/built%20on-Cordis-6E56CF?style=flat-square)](https://github.com/cordiverse/cordis)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue?style=flat-square)](#许可证)
[![Plugins](https://img.shields.io/badge/plugins-12-success?style=flat-square)](#十二个应用)
[![Tools](https://img.shields.io/badge/tools-92-informational?style=flat-square)](#每个应用两个接口)
[![MCP](https://img.shields.io/badge/MCP-bridged-8A2BE2?style=flat-square)](#每个应用两个接口)
[![Verified](https://img.shields.io/badge/verified-12%2F12-brightgreen?style=flat-square)](#自己验证)
[![npm](https://img.shields.io/npm/v/dsh-artcraft-plugin-gridcraft?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/dsh-artcraft-plugin-gridcraft)

[English](README.md) · 中文

</div>

---

```console
$ dsh --profile web
你 › 帮我做一份 Q3 销售表格,带个柱状图,存到 ~/Documents

  ⏺ gridcraft_commands  {"search": "chart"}          315 条命令,8 个分类
  ⏺ gridcraft_describe  {"id": "insert.chart"}       {range?, type?, title?, at?}
  ⏺ gridcraft_run       sample "sales",2 条命令      退出码 0,耗时 41ms
  ⏺ gridcraft_inspect   ~/Documents/q3.xlsx          1 个工作表,1 个图表,A1:H24

✔ GridCraft 已写入 ~/Documents/q3.xlsx(14,208 字节)
```

## 这是什么

ArtCraft 套件是十二个原生 Rust 应用。每一个都已经自带无头 CLI 和自己的 MCP server —— 但
没有任何东西告诉智能体它们存在、能做什么、该怎么调用。

这个仓库补上这一环。每个应用变成一个 **DSH 插件**,在 `ctx.tools` 上注册可被模型调用的工具,
自动在你这台机器上找到该应用的二进制,并以外部进程的方式驱动它。

**绝不修改任何 craft 的源码。** 所有插件都住在这个仓库里 —— 那些应用是依赖,不是 fork。

## 十二个应用

| | 应用 | 用途 | 命令数 | MCP 工具数 |
|:--|:--|:--|--:|--:|
| 📐 | **CADCraft** | CAD 与制图(AutoCAD 风格) | 305 | 11 |
| 📊 | **GridCraft** | 电子表格(Excel 风格) | 315 | 21 |
| 🎚️ | **SoundCraft** | 数字音频工作站 | 465 | 17 |
| 🖼️ | **PhotoCraft** | 位图编辑(Photoshop 风格) | 858 | 21 |
| 🌄 | **LightCraft** | 照片库与 RAW 冲图 | 296 | 318 |
| 📄 | **PdfCraft** | PDF 阅读与编辑 | 161 | 161 |
| 🖋️ | **VectorCraft** | 矢量绘图(Illustrator 风格) | 743 | 32 |
| 🎬 | **EffectCraft** | 动态图形与合成(After Effects 风格) | 669 | 27 |
| 🎞️ | **FilmCraft** | 非线性视频剪辑 | 693 | 17 |
| 🎨 | **DesignCraft** | 版式与页面设计(InDesign 风格) | 446 | 25 |
| 📽️ | **DeckCraft** | 演示文稿(PowerPoint 风格) | 226 | 25 |
| 📝 | **WordCraft** | 文字处理(Word 风格) | 460 | 16 |

<sub>命令数是从各二进制实时读出来的;MCP 工具数是各 server 自己声明的。</sub>

## 每个应用两个接口

每个插件**同时**暴露两套接口,因为它们回答的是不同的问题:

<table>
<tr><th width="50%">通用命令</th><th width="50%">应用自带的 MCP server</th></tr>
<tr valign="top"><td>

可以触达**整个应用** —— 每一个菜单项都是一个命令 id。

```
gridcraft_commands  {"search": "chart"}
gridcraft_describe  {"id": "insert.chart"}
gridcraft_run       {"commands": [...], "save": "..."}
gridcraft_inspect   {"file": "..."}
gridcraft_convert   {"input": "...", "output": "..."}
```

</td><td>

**建模过的操作**,带真正的 JSON Schema,由应用自己通过 JSON-RPC 提供。

```
gridcraft_mcp_tools  {"search": "range"}
gridcraft_mcp_call   {"tool": "write_range",
                      "arguments": {"range": "A1",
                                    "values": [["x"]]}}
gridcraft_mcp_status {}
```

</td></tr>
</table>

MCP server 每个插件只启动一次并保持常驻(启动 GridCraft 引擎要 ~600ms),空闲五分钟
或插件卸载时关闭。

## 快速开始

**Windows** —— 克隆后在 PowerShell 里执行:

```powershell
git clone https://github.com/lznnnnn1998/dsh-artcraft
cd dsh-artcraft
.\install.ps1                      # 或者: install.cmd (如果 .ps1 被策略禁止运行)
```

它会自动找到 harness 自带的 Node(`PATH` 里没有 `node` / `npm` / `pnpm` 也能装),下载本平台
所需的全部 craft CLI,再把十二个插件装进你的 DSH profile。只想装一个 craft、先试运行、或者
装完立刻验证:

```powershell
.\install.ps1 -Crafts gridcraft,wordcraft -Profile desktop -List     # 只看看会做什么
.\install.ps1 -Crafts gridcraft -Verify                             # 装一个并验证
```

**macOS / Linux** —— 同样两步,手动执行:

```sh
git clone https://github.com/lznnnnn1998/dsh-artcraft
cd dsh-artcraft

# 1. 下载各 craft 的 CLI —— macOS / Windows / Linux 通用,不需要 Rust 工具链
node scripts/install-craft.mjs

# 2. 把插件装进一个 DSH profile,然后重启它
node scripts/install-into-profile.mjs --profile web
```

两个平台跑的是同一套 Node 脚本;`install.ps1` 只是额外负责找 Node、并按 PowerShell 的习惯给出
默认值。安装不会改动系统级设置,也不会改你的 shell 配置。

也可以直接从 npm 装某一个 craft:

```sh
dsh plugin --profile web add dsh-artcraft-plugin-gridcraft
```

每个 craft 是独立的包:`dsh-artcraft-plugin-<craft>`,对应 `cadcraft`、`gridcraft`、
`soundcraft`、`deckcraft`、`wordcraft`、`photocraft`、`lightcraft`、`pdfcraft`、
`vectorcraft`、`effectcraft`、`filmcraft`、`designcraft`。

然后直接说:

> *「打开 CADCraft 的示例户型图,把厨房导出成 PNG。」*
> *「把 SoundCraft 的示例曲子里的底鼓降 6 dB,然后 bounce 出来。」*
> *「把这个 PDF 的第 3 页按 300 dpi 渲染出来。」*

完整安装、配置与排错:**[docs/INSTALL.md](docs/INSTALL.md)**

<details>
<summary><b>环境要求</b></summary>

- **Node.js** `^22.19.0 || >=24.0.0` —— Windows 上会自动使用 harness 自带的 Node,不必加进 `PATH`
- 一个正在运行的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) profile
- **macOS、Windows 11 或 Ubuntu 24.04** —— 安装脚本会自动选对构建,且不需要别的东西
  (不需要 Rust,也不需要 `unzip` / `tar` / `npm` / `pnpm`)

没有别的了。这些 craft 应用**不需要**从源码构建;第 1 步下载的是官方签名的 release 二进制。

</details>

## 自己验证

```sh
node scripts/verify.mjs
```

每个 craft 都必须:找到自己的二进制、加载实时命令目录、暴露正确的工具集、完成 MCP 握手、
并通过一次真实无头运行产出非空文件:

```
craft        binary                       catalog        tools  mcp                     run
cadcraft     cadcraft-cli 0.5.0           305 (live)     8      11 tools (list_commands ok)  ok → out.dxf (34140 B)
gridcraft    gridcraft-cli 0.5.0          315 (live)     8      21 tools (list_commands ok)  ok → out.xlsx (7682 B)
soundcraft   SoundCraft CLI 0.6.1         465 (live)     8      17 tools (list_commands ok)  ok → out.wav (16094696 B)
…                                                                  12 个插件全部通过
```

## 工作原理

每个 craft 只在
[`dsh-plugins/craft-kit/src/profiles.mjs`](dsh-plugins/craft-kit/src/profiles.mjs) 里描述**一次**。
内核把这份描述变成工具,并把各应用之间的差异全部藏起来:

| 应用 | 无头运行怎么写 |
|:--|:--|
| GridCraft、CADCraft、DeckCraft、WordCraft、SoundCraft、DesignCraft | `--cmd 'id={...}'` |
| PhotoCraft、VectorCraft | `--cmd id --params '{...}'` |
| LightCraft、PdfCraft | 位置参数 `id key=value` |
| EffectCraft | 位置参数 `id {...}` |
| FilmCraft | 生成一个 JSONL 脚本文件 |

```
dsh-plugins/
├── craft-kit/              共享内核
│   ├── src/                发现 · 执行 · 命令目录 · 工具工厂 · MCP 客户端
│   ├── lib/                生成的纯 ESM
│   └── catalog/            命令快照 + 探测到的二进制路径
├── plugin-cadcraft/        每个 craft 一个 DSH 插件
├── plugin-gridcraft/       …
└── plugin-wordcraft/
```

关于这些二进制的每一条事实都是**跑出来的**,不是猜的。当某个 craft 的真实 CLI 与预期不符时,
原始输出会记录在 [docs/craft-notes/](docs/craft-notes)。

## 十二个之外

`github.com/storytold` 下所有名字含 `craft` 的 **23** 个仓库都被克隆并评估过
([docs/CRAFT-MATRIX.md](docs/CRAFT-MATRIX.md))。其中十二个是有官方无头 CLI 的应用,做成了插件。
另外十一个是库、素材包,或没有可脚本化入口的 GUI —— 包括伞形应用 `artcraft`,它的 MCP 支持是
文档中明确标注的 UI 桩。

## 文档

| | |
|:--|:--|
| **[docs/INSTALL.md](docs/INSTALL.md)** | 安装、配置、使用、排错 |
| **[docs/CRAFT-MATRIX.md](docs/CRAFT-MATRIX.md)** | 23 个仓库及其已验证的 CLI 接口 |
| **[docs/craft-notes/](docs/craft-notes)** | 各 craft 的证据、怪癖与限制 |

## 参与贡献

发现某个 craft 的 CLI 行为和这里描述的不一致?这些笔记本来就是用来被修正的 —— 带上原始输出
开个 issue,或者自己跑一遍并开启追踪:

```sh
# macOS / Linux
DSH_ARTCRAFT_TRACE=/tmp/trace.log node scripts/verify.mjs <craft>
```

```powershell
# Windows (PowerShell)
$env:DSH_ARTCRAFT_TRACE = "$env:TEMP\artcraft-trace.log"; node scripts\verify.mjs <craft>
```

这会把每次调用的完整 argv 写进该追踪文件。

## 许可证

[MIT](LICENSE-MIT) 或 [Apache-2.0](LICENSE-APACHE) 双许可,任选其一 —— 与这些 craft 应用保持一致。

craft 二进制从各自的 GitHub release 下载,仍归各自的许可证管辖;本仓库没有内嵌它们的任何源码。

<div align="center">
<sub>基于 <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> 构建 · 由 <a href="https://github.com/cordiverse/cordis">Cordis</a> 驱动 · 献给 <a href="https://github.com/storytold">ArtCraft</a> 社区</sub>
</div>
