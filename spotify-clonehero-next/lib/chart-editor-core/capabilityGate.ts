import type {EditCommand} from '@/components/chart-editor/commands';
import type {EditorCapabilities} from '@/components/chart-editor/capabilities';

/**
 * Dispatch-path capability gate (plan 0037 Task 3). A command is allowed
 * only if every entity kind it declares as edit intent (`entityKinds`) is
 * in the capability preset's `editableEntities`, AND every operation class
 * it performs (`operations`) is in `allowedOperations`. `BatchCommand`
 * reports the union of its members' kinds/operations, so a batch is gated
 * as a whole — one disallowed member rejects the entire batch.
 */
export function isCommandAllowed(
  command: EditCommand,
  capabilities: EditorCapabilities,
): boolean {
  for (const kind of command.entityKinds) {
    if (!capabilities.editableEntities.has(kind)) return false;
  }
  for (const op of command.operations) {
    if (!capabilities.allowedOperations.has(op)) return false;
  }
  return true;
}
