/** Presentation errors for the local manager; storage and CLI errors stay intact. */
export function managerError(error: unknown, action = ''): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const fsCode = (error as NodeJS.ErrnoException | null)?.code;
  const reply = (code: string, message: string) => ({ code, message });
  if (/置顶记忆超过容量/.test(raw)) return reply('PINNED_CAPACITY', '置顶记忆超过容量，保存已取消，原内容未改变。请缩短置顶内容、取消部分置顶，或在插件设置中提高 maxBytes 后重试。');
  // Preserve the import journal's outcome and backup location on partial failures.
  if (raw.startsWith('import failed (')) return reply('IMPORT_FAILED', '导入未完成。请保留备份，先检查恢复状态再重试。详细信息：' + raw);
  if (/cannot roll back a subsequently changed file/.test(raw)) return reply('ROLLBACK_CHANGED', '导入后记忆已被修改，撤销已停止。请先导出当前记忆，再核对导入备份；不会覆盖这些新修改。');
  if (/preview.*changed|changed since preview|preview first/.test(raw)) return reply('PREVIEW_CHANGED', '记忆或导入设置已变化。请重新点“预览导入”，核对结果后再确认。');
  if (/memory changed|changed since the consolidation|记忆已.*变化/.test(raw)) return reply('MEMORY_CHANGED', '记忆已被其他操作修改。请先复制尚未保存的内容，关闭编辑框后重新打开记忆管理，再核对并编辑。');
  if (/merged profile exceeds/.test(raw)) return reply('IMPORT_CAPACITY', '合并后的用户记忆超过容量，本次未导入。请先精简用户记忆，或在插件设置中提高 maxBytes，再重新预览。');
  if (/combined topic body exceeds|topic exceeds/.test(raw)) return reply('TOPIC_CAPACITY', '项目记忆内容超过 16 KB。请缩短正文或拆分为多个主题，再保存或重新导出后导入。');
  if (/maxBytes is too small/.test(raw)) return reply('PROFILE_CAPACITY', '用户记忆容量不足以保存文件头。请在插件设置中提高 maxBytes，然后重试。');
  if (/归档已达到/.test(raw)) return reply('ARCHIVE_CAPACITY', '归档空间已满，保存已停止。请先备份并清理旧归档，再重试。');
  if (fsCode === 'ENOSPC' || /\bENOSPC\b/.test(raw)) return reply('DISK_FULL', '磁盘空间不足。请释放记忆存储所在磁盘的空间，再重试；导入失败时先检查备份与恢复状态。');
  if (fsCode === 'ENOENT' || /\bENOENT\b/.test(raw)) return reply('PATH_MISSING', action === 'preview-import' || action === 'apply-import'
    ? '找不到目录或记忆文件。请确认填写的是本机已存在的项目文件夹；暂时不迁移的项目可留空。然后重新预览。'
    : '找不到记忆文件或目录。请重新打开管理窗口；仍失败时检查插件中的存储路径是否存在。');
  if (fsCode === 'ENOTDIR' || /\bENOTDIR\b|target project is not a directory/.test(raw)) return reply('NOT_DIRECTORY', '项目路径必须是本机已有的文件夹，不能是文件。请修改目录后重新预览。');
  if (fsCode === 'EACCES' || fsCode === 'EPERM' || /\b(EACCES|EPERM)\b/.test(raw)) return reply('ACCESS_DENIED', '无法访问记忆存储目录。请检查文件夹的读写权限或文件占用情况，再重试。');
  if (/multiple imported projects cannot target/.test(raw)) return reply('DUPLICATE_DIRECTORY', '多个旧项目对应了同一本机目录。请为每个项目填写不同目录，或将暂不迁移的项目留空，再预览。');
  if (/同名.*存在/.test(raw)) return reply('DUPLICATE_NAME', '已有同名记忆。请取消新增并编辑已有记忆，或使用其他名称。');
  if (/key.*reserved|MEMORY is reserved/.test(raw)) return reply('RESERVED_NAME', '该名称由插件保留。请换一个记忆名称。');
  if (/topic must|key must/.test(raw)) return reply('INVALID_NAME', '记忆名称无效。请使用简短的单行名称；项目名称不能以点开头、使用系统保留名称或含文件名特殊字符。');
  if (action === 'inspect-import' || (/unsupported memory bundle|invalid profile key|invalid topic name|must be an|must be a|duplicate (profile|topic|project)|invalid project id|invalid sourcePath/.test(raw) && action.endsWith('import')))
    return reply('INVALID_BUNDLE', '无法读取此记忆导出文件。请在旧电脑重新导出 DSH 记忆 JSON，保留原格式后再选择文件。');
  if (/lock.*timed out|lock.*timeout|timed out.*lock/i.test(raw)) return reply('BUSY', '记忆正在被其他操作使用。请稍后重试；持续失败时重启 DSH。');
  if (/容量|too large|exceeds 16 MiB/.test(raw)) return reply('FILE_TOO_LARGE', '文件超过容量限制。请精简或拆分记忆后重新导出，再重试。');
  return reply('OPERATION_FAILED', '操作未完成，请检查以下原因后重试：' + raw);
}
