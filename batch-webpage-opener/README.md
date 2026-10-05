# 批量打开网页助手

Chrome 浏览器扩展（Manifest V3）。把不同场景要用的网址分别存进「工作」「学习」「休闲」等分组，点一下就把这一组网页全部打开，分组和网址自动保存。

- 版本：0.5.0
- 类型：Chrome 扩展（Manifest V3）

## 功能

- **按场景分组**：不同用途的网址分开存放，分组可重命名、删除
- **一键整组打开**：点「打开网页」把当前分组里的网址全部打开
- **网站图标**：每条网址自动取 favicon，一眼看清是哪个站
- **按需勾选**：可只勾选其中几条，只打开选中的
- **自动保存**：分组与网址写入 `chrome.storage`，下次打开还在
- **本地化**：内置 `zh_CN` 文案

## 目录结构

```
batch-webpage-opener/
├── manifest.json              # 扩展清单（MV3）
├── background.js              # Service Worker，负责埋点事件转发
├── popup.html                 # 弹窗界面
├── popup.css                  # 弹窗样式
├── popup.js                   # 弹窗逻辑（分组/网址增删改、批量打开）
├── _locales/
│   └── zh_CN/messages.json    # 中文文案
├── assets/
│   ├── icon-16.png
│   ├── icon-48.png
│   ├── icon-128.png
│   └── logo.png               # 弹窗顶部 Logo
└── sdk/
    └── qfa-lite.js            # 轻量埋点 SDK
```

## 安装（开发者模式加载）

1. 打开 `chrome://extensions/`
2. 右上角开启「开发者模式」
3. 点「加载已解压的扩展程序」，选择本目录

## 说明

- 权限：`storage`、`favicon`；host 权限为 `https://tracking.zbrowser.cn/*`
- `background.js` 中的 `QFA_APP_ID` 目前是占位符 `YOUR_QFA_APP_ID`，实际使用时替换为真实应用 ID
- `sdk/qfa-lite.js` 为第三方轻量埋点 SDK，仅用于统计扩展安装/启动事件