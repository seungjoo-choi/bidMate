import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../src/core/ai/prompt';
import { outputSchema } from '../../src/engine/ai/providers/schema';

type Schema = { required: string[]; properties: { items: { items: { anyOf: Array<{ properties: { key: { enum: string[] }; value: { type: string[] } } }> } } } };

describe('outputSchema', () => {
  it('spec.keys로 키 enum을 만들므로 1키 run에서도 그 키 하나만 허용한다', () => {
    const { spec } = buildPrompt({ runId: 'r1', keys: ['performanceMinAmount'], excerpt: 'x', skippedFiles: [] });
    const s = outputSchema(spec) as Schema;
    const alts = s.properties.items.items.anyOf;
    expect(alts).toHaveLength(1);
    expect(alts[0]!.properties.key.enum).toEqual(['performanceMinAmount']);
    expect(alts[0]!.properties.value.type).toEqual(['string', 'null']);
    expect(s.required).toEqual(['schema', 'runId', 'items']);
  });

  it('여러 키면 키마다 alternative, 순서는 AI_KEYS 순서', () => {
    const { spec } = buildPrompt({ runId: 'r1', keys: ['differentialScoring', 'credibilityScore'], excerpt: 'x', skippedFiles: [] });
    const alts = (outputSchema(spec) as Schema).properties.items.items.anyOf;
    expect(alts.map((a) => a.properties.key.enum[0])).toEqual(['differentialScoring', 'credibilityScore']);
  });
});
