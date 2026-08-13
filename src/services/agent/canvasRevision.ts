import { useAssistantStore } from '../../stores/assistantStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { ChatStateSnapshot, FlowStateSnapshot } from './canvasRevisionTypes';

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

function flowFingerprint(state: FlowStateSnapshot): string {
  return JSON.stringify({
    nodes: state.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      topic: node.data.topic,
      parentNodeId: node.data.parentNodeId,
      parentNodeIds: node.data.parentNodeIds,
      branchText: node.data.branchText,
      mergeAction: node.data.mergeAction,
      collapsed: node.data.collapsed,
      label: node.data.label,
      color: node.data.color,
    })),
    edges: state.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.data?.label,
    })),
  });
}

function chatFingerprint(state: ChatStateSnapshot): string {
  return JSON.stringify(Object.fromEntries(Object.entries(state.conversations).map(([nodeId, conversation]) => [
    nodeId,
    conversation.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      triggeredBy: message.triggeredBy,
    })),
  ])));
}

export function markFlowCanvasMutated(current: FlowStateSnapshot, previous: FlowStateSnapshot): void {
  if (flowFingerprint(current) !== flowFingerprint(previous)) markCanvasMutated();
}

export function markChatCanvasMutated(current: ChatStateSnapshot, previous: ChatStateSnapshot): void {
  if (chatFingerprint(current) !== chatFingerprint(previous)) markCanvasMutated();
}
