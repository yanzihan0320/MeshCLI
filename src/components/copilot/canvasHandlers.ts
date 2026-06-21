import { useFlowStore } from '../../stores/flowStore';
import { useChatStore } from '../../stores/chatStore';
import { calculateBranchPosition, calculateMergePosition } from '../../utils/nodeLayout';
import { getBranchSystemPrompt, getMergeSystemPrompt } from '../../utils/systemPrompts';
import type { ChatNode } from '../../types/flow';
import type { MessageRole } from '../../types/chat';

export function numberStyleValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function focusNode(
  nodeId: string,
  setCenter: (x: number, y: number, opts: { zoom: number; duration: number }) => void,
): boolean {
  const node = useFlowStore.getState().nodes.find((item) => item.id === nodeId);
  if (!node) return false;

  const width = numberStyleValue(node.style?.width, 400);
  const height = numberStyleValue(node.style?.height, 500);
  setCenter(node.position.x + width / 2, node.position.y + height / 2, {
    zoom: 0.9,
    duration: 350,
  });
  return true;
}

export function createNodeAtEnd(topic: string): string {
  const flow = useFlowStore.getState();
  const count = flow.nodes.length;
  return flow.addChatNode(
    {
      x: 80 + (count % 4) * 460,
      y: 80 + Math.floor(count / 4) * 560,
    },
    { topic, collapsed: false },
  );
}

export function handleCreateBranchFromNode(args: {
  parentNodeId: string;
  topic: string;
  branchText?: string;
  prompt?: string;
  assistantMessage?: string;
}): string {
  const flow = useFlowStore.getState();
  const parent = flow.nodes.find((node) => node.id === args.parentNodeId);
  if (!parent) return `parent node ${args.parentNodeId} was not found`;

  const nodeId = flow.addChatNode(calculateBranchPosition(parent, flow.getChildCount(args.parentNodeId)), {
    topic: args.topic,
    parentNodeId: args.parentNodeId,
    branchText: args.branchText ?? args.topic,
    collapsed: false,
  });
  flow.addEdge(args.parentNodeId, nodeId, args.branchText ?? args.topic);

  const chat = useChatStore.getState();
  chat.initConversation(nodeId);
  const parentMessages = chat.getMessages(args.parentNodeId).map((message) => ({
    role: message.role,
    content: message.content,
  }));
  chat.addMessage(nodeId, 'system', getBranchSystemPrompt(parent.data.topic, parentMessages));
  if (args.prompt) chat.addMessage(nodeId, 'user', args.prompt);
  if (args.assistantMessage) chat.addMessage(nodeId, 'assistant', args.assistantMessage);
  return `created branch ${nodeId}`;
}

export function handleMergeChatNodes(args: {
  nodeIds: string[];
  topic: string;
  mergeAction: string;
  assistantSummary?: string;
}): string {
  const flow = useFlowStore.getState();
  const chat = useChatStore.getState();
  const parents = args.nodeIds
    .map((nodeId) => flow.nodes.find((node) => node.id === nodeId))
    .filter((node): node is ChatNode => Boolean(node));

  if (parents.length < 2) return 'at least two valid source nodes are required';

  const nodeId = flow.addChatNode(calculateMergePosition(parents), {
    topic: args.topic,
    parentNodeIds: parents.map((node) => node.id),
    mergeAction: args.mergeAction,
    collapsed: false,
  });
  for (const parent of parents) {
    flow.addEdge(parent.id, nodeId, args.mergeAction);
  }

  chat.initConversation(nodeId);
  const parentSummaries = parents.map((node) => ({
    topic: node.data.topic,
    messages: chat.getMessages(node.id).map((message) => ({
      role: message.role,
      content: message.content,
    })),
  }));
  chat.addMessage(nodeId, 'system', getMergeSystemPrompt(parentSummaries, args.mergeAction));
  if (args.assistantSummary) chat.addMessage(nodeId, 'assistant', args.assistantSummary);
  return `created merge node ${nodeId}`;
}

export function handleDeleteChatNode(nodeId: string): string {
  const flow = useFlowStore.getState();
  const exists = flow.nodes.some((node) => node.id === nodeId);
  if (!exists) return `node ${nodeId} was not found`;
  flow.removeNode(nodeId);
  useChatStore.getState().removeConversation(nodeId);
  return `deleted node ${nodeId}`;
}

export function handleAppendNodeMessage(args: {
  nodeId: string;
  role: MessageRole;
  content: string;
  triggeredBy?: string;
}): string {
  const exists = useFlowStore.getState().nodes.some((node) => node.id === args.nodeId);
  if (!exists) return `node ${args.nodeId} was not found`;
  useChatStore.getState().initConversation(args.nodeId);
  useChatStore.getState().addMessage(args.nodeId, args.role, args.content, undefined, args.triggeredBy);
  return `appended ${args.role} message to ${args.nodeId}`;
}

export function handleUpdateChatNode(args: {
  nodeId: string;
  topic?: string;
  label?: string | null;
  color?: string | null;
  collapsed?: boolean;
}): string {
  const node = useFlowStore.getState().nodes.find((item) => item.id === args.nodeId);
  if (!node) return `node ${args.nodeId} was not found`;
  useFlowStore.getState().updateNodeData(args.nodeId, {
    ...(args.topic ? { topic: args.topic } : {}),
    ...(args.label !== undefined ? { label: args.label ?? undefined } : {}),
    ...(args.color !== undefined ? { color: args.color ?? undefined } : {}),
    ...(args.collapsed !== undefined ? { collapsed: args.collapsed } : {}),
  });
  return `updated node ${args.nodeId}`;
}

export function handleHighlightWorkspaceFinding(args: {
  title: string;
  finding: string;
  sourceNodeIds: string[];
}): string {
  const flow = useFlowStore.getState();
  const nodeId = createNodeAtEnd(args.title);
  useFlowStore.getState().updateNodeData(nodeId, {
    label: 'Finding',
    color: '#22c55e',
  });
  useChatStore.getState().initConversation(nodeId);
  useChatStore.getState().addMessage(nodeId, 'assistant', args.finding);
  for (const sourceId of args.sourceNodeIds) {
    if (flow.nodes.some((node) => node.id === sourceId)) {
      flow.addEdge(sourceId, nodeId, 'finding');
    }
  }
  return `created finding node ${nodeId}`;
}
