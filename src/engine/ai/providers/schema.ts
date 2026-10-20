import { AI_MAX_VARIANTS, type OutputSpec } from '../../../core/types/ai';

const KIND_TYPE = { number: ['number', 'null'], string: ['string', 'null'], boolean: ['boolean', 'null'] } as const;

/** 출력 스키마(공급자 중립 형식을 표준 JSON Schema로). value 타입은 키별 종류에 맞춘다. 모든 속성 required + additionalProperties:false(OpenAI strict 호환), const 대신 enum. */
export function outputSchema(spec: OutputSpec): unknown {
  return {
    type: 'object', additionalProperties: false, required: ['schema', 'runId', 'items'],
    properties: {
      schema: { type: 'string', enum: [spec.tag] },
      runId: { type: 'string', enum: [spec.runId] },
      items: {
        type: 'array',
        items: {
          anyOf: spec.keys.map((k) => ({
            type: 'object', additionalProperties: false, required: ['key', 'value', 'quote', 'file', 'page', 'note', 'variants'],
            properties: {
              key: { type: 'string', enum: [k] },
              value: { type: [...KIND_TYPE[spec.kindOf[k]]] },
              quote: { type: 'string' },
              file: { type: ['string', 'null'] },
              page: { type: ['integer', 'null'] },
              note: { type: 'string' },
              variants: {
                type: 'array', // 개수 제한은 파서(AI_MAX_VARIANTS)가 한다. Claude structured outputs는 maxItems를 받지 않는다.
                items: {
                  type: 'object', additionalProperties: false, required: ['condition', 'value', 'quote'],
                  properties: { condition: { type: 'string' }, value: { type: [...KIND_TYPE[spec.kindOf[k]]] }, quote: { type: 'string' } },
                },
              },
            },
          })),
        },
      },
    },
  };
}
