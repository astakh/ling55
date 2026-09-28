/**
 * Pure SRS update function according to Specification Algorithm 5.1.
 * 
 * Constants:
 * INTERVALS = [1, 2, 3, 7, 11, 30]
 * MAX_STAGE = 6
 * 
 * Input:
 * - stage: 0..6
 * - result: 'correct' | 'typo' | 'incorrect'
 * - lessonNumber: current lesson number
 * 
 * Output:
 * { newStage: number, dueLessonNumber: number | null, status: 'active' | 'mastered' }
 */

import { logger } from './logger.js';

export const INTERVALS = [1, 2, 3, 7, 11, 30] as const;
export const MAX_STAGE = 6;

export type ExerciseResult = 'correct' | 'typo' | 'incorrect';
export type WordStatus = 'active' | 'mastered' | 'ignored';

export interface SrsUpdateResult {
  newStage: number;
  dueLessonNumber: number | null;
  status: 'active' | 'mastered';
}

export function updateSrs(
  stage: number,
  result: ExerciseResult,
  lessonNumber: number
): SrsUpdateResult {
  const isSuccess = result === 'correct' || result === 'typo';
  let updateResult: SrsUpdateResult;

  if (isSuccess) {
    const newStage = Math.min(stage + 1, MAX_STAGE);
    if (newStage >= MAX_STAGE) {
      updateResult = {
        newStage: MAX_STAGE,
        dueLessonNumber: null,
        status: 'mastered',
      };
    } else {
      const intervalIndex = Math.max(newStage - 1, 0);
      const interval = INTERVALS[intervalIndex];
      updateResult = {
        newStage,
        dueLessonNumber: lessonNumber + interval,
        status: 'active',
      };
    }
  } else {
    // Error or "Не знаю"
    const newStage = Math.max(stage - 1, 0);
    const intervalIndex = Math.max(newStage - 1, 0);
    const interval = INTERVALS[intervalIndex];
    updateResult = {
      newStage,
      dueLessonNumber: lessonNumber + interval,
      status: 'active',
    };
  }

  logger.info('SRS', `Interval recalculated: stage ${stage} -> ${updateResult.newStage}`, {
    result,
    currentLesson: lessonNumber,
    dueLessonNumber: updateResult.dueLessonNumber,
    status: updateResult.status,
  });

  return updateResult;
}
