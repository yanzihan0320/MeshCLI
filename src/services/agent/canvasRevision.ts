import { useAssistantStore } from '../../stores/assistantStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

let suppressionDepth = 0;

export function beginCanvasRevisionSuppression(): void {
  suppressionDepth += 1;
}

export function endCanvasRevisionSuppression(): void {
  suppressionDepth = Math.max(0, suppressionDepth - 1);
}

export function markCanvasMutated(): void {
  if (suppressionDepth > 0) return;
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId;
  if (!workspaceId) return;
  const workspace = useAssistantStore.getState().ensureWorkspace(workspaceId);
  useAssistantStore.getState().setRevision(workspaceId, workspace.revision + 1);
}

