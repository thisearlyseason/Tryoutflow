import { failure, success, type AppResult } from '../../../lib/result';

export type EvaluationNoteTag = { id: string; label: string; active: boolean };

export function validateSelectedNoteTags(
  configured: readonly EvaluationNoteTag[],
  selectedIds: readonly string[],
): AppResult<readonly string[], { code: 'invalid_note_tag' | 'duplicate_note_tag' }> {
  if (new Set(selectedIds).size !== selectedIds.length) {
    return failure({ code: 'duplicate_note_tag' });
  }
  const active = new Set(configured.filter((tag) => tag.active).map((tag) => tag.id));
  if (selectedIds.some((id) => !active.has(id))) return failure({ code: 'invalid_note_tag' });
  return success(selectedIds);
}
