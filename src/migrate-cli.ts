#!/usr/bin/env node
/** Standalone migration command; exporting does not require upgrading DSH. */
import { parseArgs } from 'node:util';
import { applyMemoryImport, exportMemoryFile, previewMemoryImport, rollbackMemoryImport, type ConflictPolicy } from './migration.ts';
import { startManagerServer } from './manager-web.ts';
import { createMemoryManager } from './manager.ts';

const HELP = `DSH 记忆工具

打开本机记忆管理页：
  dsh-memory manage [--port 端口]
检查存储和当前项目：
  dsh-memory doctor [--cwd 项目目录]

导出全部记忆：
  dsh-memory export --file <JSON文件>
预览导入（未指定映射的项目会跳过）：
  dsh-memory import --file <JSON文件> [--map "项目ID=本机项目目录"]
执行已确认的预览：
  dsh-memory import --file <JSON文件> [--map "项目ID=本机项目目录"] --apply --token <previewToken>
恢复导入前的文件：
  dsh-memory rollback --file <backupPath>

可选项：
  --global-only             导出时只包含全局记忆
  --skip-profile            导入时跳过全局记忆
  --policy keep-local       保留本机同名记忆（默认）
  --policy use-imported     用导入内容替换同名记忆
  --map                     可重复指定；目录必须已存在
  --profile <文件>          自定义 user.md 路径
  --workspace-base <目录>   自定义项目记忆存储目录
  --max-bytes <数字>        全局记忆容量，默认 8192 字节
  --workspace-mode git-root 按 Git 根目录共享项目记忆；默认 directory

默认读取 $DSH_HOME/user-memory；未设置 DSH_HOME 时使用 ~/.dsh/user-memory。
CLI 不读取 DSH 插件配置；使用过自定义存储或容量时，请传入对应选项。
导出拒绝覆盖已有文件。导入保留更新时间及失效状态，不自动淘汰记忆。
`;

try {
  const { values, positionals } = parseArgs({ options: {
    file: { type: 'string' }, map: { type: 'string', multiple: true },
    profile: { type: 'string' }, 'workspace-base': { type: 'string' },
    'max-bytes': { type: 'string' }, policy: { type: 'string', default: 'keep-local' },
    'global-only': { type: 'boolean' }, 'skip-profile': { type: 'boolean' },
    apply: { type: 'boolean' }, token: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    port: { type: 'string' }, cwd: { type: 'string' }, 'workspace-mode': { type: 'string', default: 'directory' },
  }, allowPositionals: true });
  if (values.help || positionals.length === 0) console.log(HELP);
  else {
    if (positionals.length !== 1 || !['export', 'import', 'rollback', 'manage', 'doctor'].includes(positionals[0]!)) throw new Error('未知命令；使用 --help 查看说明');
    if (!['manage', 'doctor'].includes(positionals[0]!) && !values.file) throw new Error('请用 --file 指定文件路径');
    if (!['directory', 'git-root'].includes(values['workspace-mode'])) throw new Error('项目模式无效');
    if (values.policy !== 'keep-local' && values.policy !== 'use-imported') throw new Error('无效冲突策略');
    const options = {
      profilePath: values.profile,
      workspaceBase: values['workspace-base'],
      maxBytes: values['max-bytes'] === undefined ? undefined : Number(values['max-bytes']),
      workspaceMode: values['workspace-mode'] as 'directory' | 'git-root',
      includeProfile: !values['skip-profile'],
      policy: values.policy as ConflictPolicy,
      projectMap: (values.map ?? []).map(mapping => {
        const split = mapping.indexOf('=');
        if (split <= 0 || split === mapping.length - 1) throw new Error('--map 格式应为 项目ID=本机项目目录');
        return { id: mapping.slice(0, split), path: mapping.slice(split + 1) };
      }),
    };
    if (positionals[0] === 'manage') {
      const manager = await startManagerServer(options, values.port === undefined ? 0 : Number(values.port));
      console.log(`记忆管理页已启动：${manager.url}\n在浏览器打开以上地址。按 Ctrl+C 关闭；服务仅监听本机。`);
    } else if (positionals[0] === 'doctor') console.log(JSON.stringify(await createMemoryManager(options).diagnose(values.cwd ?? process.cwd()), null, 2));
    else if (positionals[0] === 'export') console.log(JSON.stringify(await exportMemoryFile(values.file!, options, values['global-only'] ? 'global' : 'all'), null, 2));
    else if (positionals[0] === 'rollback') {
      await rollbackMemoryImport(values.file!, options);
      console.log('已恢复导入前的记忆文件。');
    } else {
      const result = values.apply
        ? await applyMemoryImport(values.file!, values.token ?? '', options)
        : await previewMemoryImport(values.file!, options);
      console.log(JSON.stringify(result, null, 2));
      if (!values.apply) console.log('\n以上仅为预览。确认后使用相同选项，加上 --apply --token <previewToken> 执行。');
    }
  }
} catch (error) {
  console.error(`迁移失败：${(error as Error).message ?? String(error)}`);
  process.exitCode = 1;
}
