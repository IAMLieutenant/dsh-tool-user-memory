/**
 * Scripted LLM adapter for loop-level tests: no network, deterministic.
 *
 * Call #1 yields an assistant `tool-call` block for `memory_update`;
 * every later call yields a final text answer. This drives the real
 * AgentLoop machinery (assemble → stream → tool dispatch → next turn).
 */

import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';

export class StubAdapter extends LlmAdapter {
  calls = 0;

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const n = this.calls++;
    if (n === 0) {
      const id = 'stub-call-1';
      const argumentsJson = JSON.stringify({ key: 'language', value: 'zh-CN' });
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield {
        type: 'tool-call-delta',
        index: 0,
        id: id as never,
        name: 'memory_update',
        argumentsDelta: argumentsJson,
      };
      yield {
        type: 'block-end',
        index: 0,
        block: {
          type: 'tool-call',
          id: id as never,
          name: 'memory_update',
          arguments: argumentsJson,
        } as never,
      };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    const text = '已记住：语言偏好 zh-CN。';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } as never };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
