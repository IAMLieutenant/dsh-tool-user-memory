# 开发与验证

返回 [首页](../README.md)。本文对应 `0.4.1` 的构建与验证。

## 本地构建

在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm run build
pnpm pack
dsh plugin --profile web add ./dsh-tool-user-memory-0.4.1.tgz
```

把 `web` 换成实际 profile。安装后重启 DSH。测试源码改动时建议使用独立的 `DSH_HOME` 和演示记忆。

## 已经验证了什么

| 检查 | 结果与边界 |
|---|---|
| 锁定依赖的自动化回归 | DSH `0.1.7-alpha.1` 依赖集下，139 项通过 |
| TypeScript 构建 | 通过 |
| 安装包检查 | 解包后直接运行编译产物，候选、预览、确认和来源保存通过 |
| 当前 DSH 界面 | Windows、DSH `0.2.1-rc.2` 官方内核、Chrome、独立测试 profile 下验证 |
| 主题与布局 | 实际切换浅色／深色，核对 DSH 颜色继承；420px 宽度无横向溢出，确认操作留在弹窗内 |

实际界面检查包括：从插件详情打开管理窗口、查看候选、预览新旧内容、修改范围后重新预览、取消、确认保存，以及在项目记忆中查看新内容和来源。README 图片来自这套环境，使用演示数据。

测试并未使用真实账号或模型服务。Harness／AgentLoop 测试使用固定模型响应，不能代替真实模型的提取质量、回答遵循效果或长时间使用评测；Chrome 验证也不代表所有 Electron 桌面壳和全部 DSH 版本都已测试。

## 从哪里读代码

| 文件 | 负责什么 |
|---|---|
| `src/index.ts` | 配置、服务装配和可选自动整理 |
| `src/profile.ts`、`src/store.ts` | 用户画像、置顶、容量和保存 |
| `src/workspace.ts`、`src/prompt.ts` | 项目范围、索引、检索和上下文 |
| `src/candidates.ts`、`src/provenance.ts` | 候选队列、来源记录和审阅状态 |
| `src/manager.ts`、`src/manager-web.ts` | 管理操作、预览核验和本机接口 |
| `src/manager-ui.ts`、`src/client.js` | 管理界面、DSH 入口和主题同步 |
| `src/migration.ts`、`src/history.ts`、`src/lock.ts` | 迁移、历史、归档和并发保护 |
| `tests/candidates.test.ts` | 候选隔离、纠正、范围、容量、置顶与恢复回归 |

来源核验和恢复规则见 [候选确认说明](candidate-review.md)。配置与 CLI 用法见 [使用参考](reference.md)。
