/** OutputSpec.kindOf에 필요한 공고 잎 9개(전부 string) */
export const NOTICE_KINDS = {
  postedAt: 'string', registrationDeadline: 'string', proposalPeriod: 'string', proposalEvalAt: 'string', budgetAmount: 'string',
  projectPeriod: 'string', evalMethod: 'string', jointVentureAllowed: 'string', priceMethod: 'string',
} as const;
