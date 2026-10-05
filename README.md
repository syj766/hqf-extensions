# hqf-extensions

个人自研插件合集（浏览器扩展 / 小工具）。每个插件一个独立目录，互不干扰。

## 插件列表

| 目录 | 名称 | 说明 | 版本 |
| --- | --- | --- | --- |
| [`batch-webpage-opener`](./batch-webpage-opener) | 批量打开网页助手 | Chrome 扩展：按场景分组，一键打开一组网页 | 0.5.0 |

## 目录约定

```
hqf-extensions/
├── batch-webpage-opener/      # 一个插件一个目录
├── <next-plugin>/
└── README.md
```

- 每个插件目录自带 `README.md`，写清功能、目录结构、安装方式
- 只提交源码，构建产物（`node_modules/`、`dist/`、`build/`）不纳入版本管理