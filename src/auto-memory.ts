import { randomUUID } from 'node:crypto';
import type { MemoryStore } from './store.ts';
import type { MemoryPolicyStore } from './policy.ts';
import { parseProvenance } from './provenance.ts';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';

export const AUTO_KINDS = ['background', 'skill', 'language', 'style'] as const;
export type AutoKind = typeof AUTO_KINDS[number];
const excluded = /项目|仓库|代码库|本次|这次|今天|暂时|最近|必须|禁止|不得|规定|发布|部署|提交代码|修改代码|密码|密钥|令牌|转述|引用|示例|例如|假设|朋友|他说|她说|文档|```|^\s*>|[“「『]|\b(project|repository|repo|this time|today|temporar\w*|must|shall|deploy\w*|password|secret|token|example|quote)\b/im;
const personal = /我(?:个人)?(?:更|比较|一直|平时|通常|习惯|喜欢|偏好|主要|是|做|从事|熟悉|擅长|不太|不熟|不会|不懂|现在)|\bI\s+(?:am|work|prefer|like|usually|mainly|know|don't|do not)\b/i;
export function automaticFact(kind: string, value: string, excerpt: string, message: string) {
  if (!AUTO_KINDS.includes(kind as AutoKind) || !value.trim() || value.length > 80 || !excerpt.trim() || excerpt.length > 600 || !message.includes(excerpt) || excluded.test(message) || !personal.test(excerpt)) return null;
  if (kind === 'language') {
    const languages: Record<string, RegExp> = { '中文': /中文|汉语|Chinese/i, '英文': /英文|英语|English/i };
    if (!languages[value]?.test(excerpt) || !/习惯|喜欢|偏好|prefer|like|usually/i.test(excerpt)) return null;
    return { key: '语言偏好', value };
  }
  if (kind === 'style') {
    const styles: Record<string, RegExp> = { '简短': /简短|简洁|短一些|concise|brief/i, '详细': /详细|细致|detail/i, '先说结论': /先.{0,3}(?:结论|结果)|conclusion first/i, '通俗易懂': /大白话|通俗|简单易懂|plain language/i };
    if (!styles[value]?.test(excerpt) || !/习惯|喜欢|偏好|prefer|like/i.test(excerpt)) return null;
    return { key: '表达偏好', value };
  }
  if (!excerpt.includes(value) || !personal.test(value) || /[\r\n;；]/.test(value)) return null;
  if (kind === 'background' && /我(?:主要|平时|一直|是|从事|的职业|的工作|现在转做)|\bI\s+(?:am|work)\b/i.test(value)
    && /职业|开发|工程师|设计师|学生|老师|医生|教师|后端|前端|程序员|产品经理|数据分析|developer|engineer|designer|student|teacher|doctor/i.test(value)) return { key: '职业背景', value };
  if (kind === 'skill') {
    const skill = /我(?:个人)?(?:不太|不)?(?:熟悉|擅长|不熟悉|不会|不懂)([\p{L}\p{N}+#. -]{1,24})/u.exec(value)?.[1]?.trim().replace(/[。.]$/, '');
    if (skill && !/[和与及]/.test(skill)) return { key: '技能：' + skill, value };
  }
  return null;
}
export function createAutomaticMemory(store: MemoryStore, policy: MemoryPolicyStore) {
  return {
    async save(kind: string, value: string, excerpt: string, source: { text: string; seq: number; sessionId: string; turn: number }): Promise<Record<string, JsonValue>> {
      const p = policy.read(); if (p.mode !== 'shared' || !p.inject) throw new Error('用户记忆已停用。');
      const fact = automaticFact(kind, value, excerpt, source.text);
      if (!fact) throw new Error('不是可自动记录的明确个人信息，已跳过。');
      const before = (await store.list()).find(e => e.key === fact.key) ?? null;
      if (before?.invalidatedAt) throw new Error('这条信息已停用，不自动恢复。');
      if (before?.value === fact.value) return { saved: false, duplicate: true, key: fact.key };
      const previousEntry = JSON.stringify(before); if (previousEntry.length > 16384) throw new Error('无法完整保留撤销信息，已跳过。');
      const id = randomUUID();
      const result = await store.update(fact.key, fact.value, 'set', '', { expected: before }, before?.pinned, {
        method: 'automatic', createdAt: before?.provenance?.createdAt || new Date().toISOString(), automaticId: id, automaticTurn: source.turn,
        sourceSessionId: source.sessionId, sourceEventSeq: source.seq, sourceRole: 'user', excerptVerified: true, excerpt, previousEntry,
      }, true);
      if (!result.ok) throw new Error(result.error);
      return { saved: true, id, ...fact, message: '已自动记住，可在回答下方撤销。' };
    },
    async notices(sessionId: string, turn: number) {
      return (await store.list()).filter(e => !e.invalidatedAt && e.provenance?.method === 'automatic' && e.provenance.sourceSessionId === sessionId && e.provenance.automaticTurn === turn)
        .map(e => ({ key: e.key, value: e.value, id: e.provenance!.automaticId }));
    },
    async undo(key: string, id: string) {
      const current = (await store.list()).find(e => e.key === key);
      if (!current || current.provenance?.method !== 'automatic' || current.provenance.automaticId !== id) throw new Error('记忆后来已变化，不能撤销这次记录。');
      const before = JSON.parse(current.provenance.previousEntry ?? 'null');
      if (before && (before.key !== key || typeof before.value !== 'string' || before.value.length > 16384 || before.invalidatedAt)) throw new Error('撤销信息无效');
      const result = await store.update(key, before?.value ?? '', before ? 'set' : 'remove', '', { expected: current }, before?.pinned,
        before?.provenance ? parseProvenance(before.provenance) : undefined, true);
      if (!result.ok) throw new Error(result.error); return { undone: true };
    },
  };
}
