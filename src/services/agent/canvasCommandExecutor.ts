import type { CanvasCommand, CanvasCommandResult, CanvasSnapshot } from '../../../packages/protocol/src/assistant';
import { useAssistantStore } from '../../stores/assistantStore';
import { useChatStore } from '../../stores/chatStore';
import { useFlowStore } from '../../stores/flowStore';
import type { Conversation } from '../../types/chat';
import type { ChatNode, TopicEdge } from '../../types/flow';
import {
  createNodeAtEnd,
  handleAppendNodeMessage,
  handleCreateBranchFromNode,
  handleDeleteChatNode,
  handleMergeChatNodes,
  handleUpdateChatNode,
} from '../../components/copilot/canvasHandlers';
import { beginCanvasRevisionSuppression, endCanvasRevisionSuppression } from './canvasRevision';
import { useWorkspaceStore } from '../../stores/workspaceStore';

interface CanvasTransaction {
  actionId: string;
  workspaceId: string;
  beforeRevision: number;
  afterRevision: number;
  nodes: ChatNode[];
  edges: TopicEdge[];
  conversations: Record<string, Conversation>;
}

const transactions = new Map<string, CanvasTransaction[]>();

export function buildCanvasSnapshot(workspaceId: string): CanvasSnapshot {
  const flow = useFlowStore.getState();
  const chat = useChatStore.getState();
  const assistant = useAssistantStore.getState().ensureWorkspace(workspaceId);
  return {
    version: 1,
    workspaceId,
    revision: assistant.revision,
    activeNodeId: chat.activeNodeContext?.nodeId,
    selectedNodeIds: flow.nodes.filter((node) => node.selected).map((node) => node.id),
    nodes: flow.nodes.map((node) => ({
      id: node.id,
      topic: node.data.topic,
      position: node.position,
      selected: Boolean(node.selected),
      parentNodeId: node.data.parentNodeId,
      parentNodeIds: node.data.parentNodeIds,
      label: typeof node.data.label === 'string' ? node.data.label : undefined,
      color: typeof node.data.color === 'string' ? node.data.color : undefined,
      collapsed: Boolean(node.data.collapsed),
      messages: (chat.conversations[node.id]?.messages ?? []).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      })),
    })),
    edges: flow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.data?.label,
    })),
  };
}

function result(
  command: CanvasCommand,
  status: CanvasCommandResult['status'],
  revision: number,
  message: string,
  affectedNodeIds: string[] = [],
  affectedEdgeIds: string[] = [],
  data?: Record<string, unknown>,
): CanvasCommandResult {
  return { version: 1, actionId: command.actionId, workspaceId: command.workspaceId, status, revision, message, affectedNodeIds, affectedEdgeIds, data };
}

export function executeCanvasCommand(
  command: CanvasCommand,
  focus?: (nodeId: string) => boolean,
): CanvasCommandResult {
  const activeWorkspaceId = command.workspaceId;
  const assistant = useAssistantStore.getState().ensureWorkspace(activeWorkspaceId);
  if (useWorkspaceStore.getState().activeWorkspaceId !== activeWorkspaceId) {
    return result(command, 'failed', assistant.revision, 'Canvas command targets a workspace that is not active.');
  }
  if (command.expectedRevision !== assistant.revision) {
    return result(command, 'stale', assistant.revision, `Canvas revision changed from ${command.expectedRevision} to ${assistant.revision}.`);
  }

  const flowBefore = useFlowStore.getState();
  const chatBefore = useChatStore.getState();
  if (command.type === 'read_canvas') {
    return result(command, 'applied', assistant.revision, 'Canvas snapshot read.', [], [], { snapshot: buildCanvasSnapshot(activeWorkspaceId) });
  }
  if (command.type === 'search_nodes') {
    const query = command.payload.query.toLocaleLowerCase();
    const matches = flowBefore.nodes.filter((node) => {
      const text = `${node.data.topic}\n${chatBefore.getMessages(node.id).map((message) => message.content).join('\n')}`;
      return text.toLocaleLowerCase().includes(query);
    }).map((node) => ({ id: node.id, topic: node.data.topic }));
    return result(command, 'applied', assistant.revision, `Found ${matches.length} matching nodes.`, matches.map((item) => item.id), [], { matches });
  }
  if (command.type === 'focus_node') {
    const exists = flowBefore.nodes.some((node) => node.id === command.payload.nodeId);
    if (!exists) return result(command, 'failed', assistant.revision, `Node ${command.payload.nodeId} was not found.`);
    const focused = focus?.(command.payload.nodeId) ?? false;
    return result(command, focused ? 'applied' : 'failed', assistant.revision, focused ? `Focused node ${command.payload.nodeId}.` : 'Canvas viewport is not available.', [command.payload.nodeId]);
  }

  const transaction: CanvasTransaction = {
    actionId: command.actionId,
    workspaceId: activeWorkspaceId,
    beforeRevision: assistant.revision,
    afterRevision: assistant.revision + 1,
    nodes: flowBefore.nodes,
    edges: flowBefore.edges,
    conversations: chatBefore.conversations,
  };

  beginCanvasRevisionSuppression();
  try {
    switch (command.type) {
      case 'create_node': {
        const nodeId = createNodeAtEnd(command.payload.topic);
        useChatStore.getState().initConversation(nodeId);
        useFlowStore.getState().updateNodeData(nodeId, { label: command.payload.label, color: command.payload.color });
        if (command.payload.assistantMessage) useChatStore.getState().addMessage(nodeId, 'assistant', command.payload.assistantMessage);
        break;
      }
      case 'create_branch':
        if (handleCreateBranchFromNode(command.payload).includes('not found')) throw new Error('Parent node was not found.');
        break;
      case 'merge_nodes':
        if (handleMergeChatNodes(command.payload).startsWith('at least')) throw new Error('At least two valid source nodes are required.');
        break;
      case 'append_message':
        if (handleAppendNodeMessage(command.payload).includes('not found')) throw new Error('Target node was not found.');
        break;
      case 'update_node':
        if (handleUpdateChatNode(command.payload).includes('not found')) throw new Error('Target node was not found.');
        break;
      case 'connect_nodes': {
        const nodes = useFlowStore.getState().nodes;
        if (!nodes.some((node) => node.id === command.payload.source) || !nodes.some((node) => node.id === command.payload.target)) {
          throw new Error('Connection source or target node was not found.');
        }
        const duplicate = useFlowStore.getState().edges.some((edge) => edge.source === command.payload.source && edge.target === command.payload.target);
        if (!duplicate) useFlowStore.getState().addEdge(command.payload.source, command.payload.target, command.payload.label);
        break;
      }
      case 'delete_node':
        if (handleDeleteChatNode(command.payload.nodeId).includes('not found')) throw new Error('Target node was not found.');
        break;
    }
  } catch (error) {
    useFlowStore.getState().setNodes(transaction.nodes);
    useFlowStore.getState().setEdges(transaction.edges);
    useChatStore.getState().setConversations(transaction.conversations);
    endCanvasRevisionSuppression();
    return result(command, 'failed', assistant.revision, error instanceof Error ? error.message : String(error));
  }
  endCanvasRevisionSuppression();

  const flowAfter = useFlowStore.getState();
  const beforeNodes = new Map(transaction.nodes.map((node) => [node.id, JSON.stringify(node)]));
  const afterNodes = new Map(flowAfter.nodes.map((node) => [node.id, JSON.stringify(node)]));
  const changedNodes = [...new Set([...beforeNodes.keys(), ...afterNodes.keys()])]
    .filter((id) => beforeNodes.get(id) !== afterNodes.get(id));
  const beforeEdges = new Map(transaction.edges.map((edge) => [edge.id, JSON.stringify(edge)]));
  const afterEdges = new Map(flowAfter.edges.map((edge) => [edge.id, JSON.stringify(edge)]));
  const changedEdges = [...new Set([...beforeEdges.keys(), ...afterEdges.keys()])]
    .filter((id) => beforeEdges.get(id) !== afterEdges.get(id));
  useAssistantStore.getState().setRevision(activeWorkspaceId, transaction.afterRevision);
  const history = transactions.get(activeWorkspaceId) ?? [];
  transactions.set(activeWorkspaceId, [...history, transaction].slice(-50));
  return result(command, 'applied', transaction.afterRevision, `${command.type} applied.`, changedNodes, changedEdges);
}

export function undoCanvasCommand(workspaceId: string, actionId?: string): boolean {
  const history = transactions.get(workspaceId) ?? [];
  const index = actionId ? history.findIndex((item) => item.actionId === actionId) : history.length - 1;
  if (index < 0) return false;
  const transaction = history[index];
  if (useAssistantStore.getState().ensureWorkspace(workspaceId).revision !== transaction.afterRevision) return false;
  beginCanvasRevisionSuppression();
  useFlowStore.getState().setNodes(transaction.nodes);
  useFlowStore.getState().setEdges(transaction.edges);
  useChatStore.getState().setConversations(transaction.conversations);
  endCanvasRevisionSuppression();
  useAssistantStore.getState().setRevision(workspaceId, transaction.beforeRevision);
  transactions.set(workspaceId, history.slice(0, index));
  return true;
}
