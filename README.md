# dsh-tool-user-memory

[![npm][npm-badge]][npm] [![CI][ci-badge]][ci] [![MIT][license-badge]][license]

这是一个给 DeepSeek Harness 使用的用户记忆插件。它保存你的个人背景和回答偏好，让新对话也能继续参考这些信息。

[English][english] · [下载 0.4.2][release] · [更新日志][changelog]

## 能做什么

你可以像平时一样聊天，比如告诉助手“我主要做 Java 后端开发”或“我习惯用中文”。遇到明确的个人信息时，助手可以自动记录，并在回答下方显示“已记住”和“撤销”。

记忆管理页可以搜索、新增、编辑和删除内容。页面右上角有启用开关，不想使用时关掉即可。

需要手动核对的建议可以在“待确认”里保存或忽略。换电脑时，可以用“备份与迁移”导出数据，再到另一台电脑导入。

![记忆管理界面][memory-image]

## 安装

先安装 DeepSeek Harness，再到 [0.4.2 发布页][release] 下载 `dsh-tool-user-memory-0.4.2.tgz`。在下载目录运行下面的命令，安装后重启 DSH。

```sh
dsh plugin --profile web add ./dsh-tool-user-memory-0.4.2.tgz
```

示例使用 `web` 配置。如果你使用其他配置，把命令中的 `web` 换成对应名称。

## 使用

在 DSH 中打开“插件”，找到这个插件并点击“管理记忆”。已有内容会显示在列表里，也可以点击“新增记忆”手动添加。

平时不用特意说“请记住”，明确的个人背景、技能熟悉度、语言和表达偏好都可以自动记录。记错了就点击回答下方的“撤销”，也可以到管理页修改或删除。

启用后，后续对话会自动带上已保存的用户记忆。助手提出的待确认内容需要你保存后才会生效，替换已有内容时会显示新旧对照。

## 记什么，不记什么

这个插件只记录跟你本人有关的信息。项目配置、代码约束、发布规定和临时要求不会作为自动记忆保存，判断不明确时会跳过。

记忆保存在本机，使用时会发送给你配置的模型服务。关闭或删除记忆会影响后续读取，已经发出的对话内容和已有备份仍会保留。

## 从源码运行

克隆仓库后，安装依赖并构建。下面使用本地路径安装，替换成你自己的仓库绝对路径即可。

```sh
pnpm install --frozen-lockfile
pnpm run build
dsh plugin --profile web add "link:/absolute/path/dsh-tool-user-memory"
```

Windows 路径可以写成 `D:/projects/dsh-tool-user-memory`。重新构建后也需要重启 DSH。

[npm-badge]: https://img.shields.io/npm/v/dsh-tool-user-memory
[npm]: https://www.npmjs.com/package/dsh-tool-user-memory
[ci-badge]: https://github.com/IAMLieutenant/dsh-tool-user-memory/actions/workflows/ci.yml/badge.svg
[ci]: https://github.com/IAMLieutenant/dsh-tool-user-memory/actions/workflows/ci.yml
[license-badge]: https://img.shields.io/badge/license-MIT-blue
[license]: LICENSE
[english]: README.en.md
[release]: https://github.com/IAMLieutenant/dsh-tool-user-memory/releases/tag/v0.4.2
[changelog]: CHANGELOG.md
[memory-image]: docs/images/user-memory-list.png
