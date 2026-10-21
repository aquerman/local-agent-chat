import { logger } from '@librechat/data-schemas';
import type { ScheduleMethods } from '@librechat/data-schemas';

export type ScheduleRunOutcome = Parameters<ScheduleMethods['recordRunOutcome']>[0];

/**
 * Wraps `recordRunOutcome` so every caller (live settlement, reconciler, erasure, deletion
 * drains) reports applied transitions to `listener` without each path wiring it separately.
 */
export function withRunOutcomeListener<T extends Pick<ScheduleMethods, 'recordRunOutcome'>>(
  methods: T,
  listener?: (outcome: ScheduleRunOutcome) => Promise<void>,
): T {
  if (listener == null) {
    return methods;
  }
  const record = methods.recordRunOutcome;
  return {
    ...methods,
    recordRunOutcome: async (params: ScheduleRunOutcome): Promise<boolean> => {
      const transitioned = await record(params);
      if (transitioned) {
        Promise.resolve()
          .then(() => listener(params))
          .catch((err: unknown) => {
            logger.warn(`[schedules] run outcome listener failed for ${params.scheduleId}:`, err);
          });
      }
      return transitioned;
    },
  };
}
