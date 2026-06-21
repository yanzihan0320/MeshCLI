import { useChatStore } from '../../stores/chatStore';
import { useFlowStore } from '../../stores/flowStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { ChatMessage, Conversation, MessageRole } from '../../types/chat';
import type { ChatNode, TopicEdge } from '../../types/flow';
import type { WorkspaceMetadata } from '../../types/workspace';

const NODE_MESSAGE_LIMIT = 8;
const CONVERSATION_MESSAGE_LIMIT = 24;
const MERGE_SOURCE_MESSAGE_LIMIT = 12;

type AgentMessageRole = Exclude<MessageRole, 'system'>;

interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  timestamp: number;
  imageCount: number;
  hasImages: boolean;
}

interface AgentNode {
  index: number;
  id: string;
  topic: string;
  label?: string;
  color?: string;
  parentNodeId?: string;
  parentNodeIds?: string[];
  branchText?: string;
  mergeAction?: string;
  collapsed: boolean;
  minimized: boolean;
  maximized: boolean;
  selected: boolean;
  position: { x: number; y: number };
  width: number;
  height: number;
  messageCount: number;
  lastUserMessage: string;
  lastAssistantMessage: string;
  messages: AgentMessage[];
}

interface AgentConversation {
  nodeId: string;
  isStreaming: boolean;
  messageCount: number;
  systemMessageCount: number;
  messages: AgentMessage[];
}

interface AgentCurrentMessage extends AgentMessage {
  sourceNodeId: string;
  sourceTopic: string;
}

interface AgentMergeSource {
  nodeId: string;
  topic: string;
  label?: string;
  lastUserMessage: string;
  lastAssistantMessage: string;
  messages: AgentMessage[];
}

interface AgentMergeContext {
  ready: boolean;
  sourceNodeIds: string[];
  sourceTopics: string[];
  sources: AgentMergeSource[];
}

type NodeContext = import('../../stores/chatStore').ActiveNodeContext;

interface LLMConfig {
  providerId: string;
  model: string;
  endpoint: string;
  temperature: number;
}

export interface CanvasAgentState {
  activeWorkspace: Pick<WorkspaceMetadata, 'id' | 'name' | 'createdAt' | 'updatedAt' | 'description'> | null;
  nodes: AgentNode[];
  edges: Array<{ id: string; source: string; target: string; label: string }>;
  conversations: Record<string, AgentConversation>;
  selectedNodes: AgentNode[];
  currentMessages: AgentCurrentMessage[];
  mergeContext: AgentMergeContext | null;
  nodeContext: NodeContext | null;
  llmConfig: LLMConfig;
}

function publicMessages(messages: ChatMessage[]) {
  return messages.filter((message): message is ChatMessage & { role: AgentMessageRole } => message.role !== 'system');
}

function toAgentMessage(message: ChatMessage): AgentMessage {
  const imageCount = message.images?.length ?? 0;
  return {
    id: message.id,
    role: message.role as AgentMessageRole,
    content: message.content,
    timestamp: message.timestamp,
    imageCount,
    hasImages: imageCount > 0,
  };
}

function numberStyleValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function summarizeConversation(conversation: Conversation | undefined, nodeId: string): AgentConversation {
  const allMessages = conversation?.messages ?? [];
  const messages = publicMessages(allMessages);

  return {
    nodeId,
    isStreaming: Boolean(conversation?.isStreaming),
    messageCount: messages.length,
    systemMessageCount: allMessages.length - messages.length,
    messages: messages.slice(-CONVERSATION_MESSAGE_LIMIT).map(toAgentMessage),
  };
}

function summarizeNode(node: ChatNode, conversation: Conversation | undefined, index: number): AgentNode {
  const messages = publicMessages(conversation?.messages ?? []);
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant');

  return {
    index,
    id: node.id,
    topic: node.data.topic,
    label: node.data.label,
    color: node.data.color,
    parentNodeId: node.data.parentNodeId,
    parentNodeIds: node.data.parentNodeIds,
    branchText: node.data.branchText,
    mergeAction: node.data.mergeAction,
    collapsed: Boolean(node.data.collapsed),
    minimized: Boolean(node.data.minimized),
    maximized: Boolean(node.data.maximized),
    selected: Boolean(node.selected),
    position: node.position,
    width: numberStyleValue(node.style?.width, 400),
    height: numberStyleValue(node.style?.height, 500),
    messageCount: messages.length,
    lastUserMessage: lastUserMessage?.content ?? '',
    lastAssistantMessage: lastAssistantMessage?.content ?? '',
    messages: messages.slice(-NODE_MESSAGE_LIMIT).map(toAgentMessage),
  };
}

function summarizeEdge(edge: TopicEdge) {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.data?.label ?? '',
  };
}

function buildCurrentMessages(selectedNodes: AgentNode[], conversations: Record<string, AgentConversation>) {
  return selectedNodes.flatMap((node) =>
    (conversations[node.id]?.messages ?? []).map((message) => ({
      ...message,
      sourceNodeId: node.id,
      sourceTopic: node.topic,
    })),
  );
}

function buildMergeContext(selectedNodes: AgentNode[], conversations: Record<string, AgentConversation>) {
  if (selectedNodes.length < 2) return null;

  return {
    ready: true,
    sourceNodeIds: selectedNodes.map((node) => node.id),
    sourceTopics: selectedNodes.map((node) => node.topic),
    sources: selectedNodes.map((node) => ({
      nodeId: node.id,
      topic: node.topic,
      label: node.label,
      lastUserMessage: node.lastUserMessage,
      lastAssistantMessage: node.lastAssistantMessage,
      messages: (conversations[node.id]?.messages ?? []).slice(-MERGE_SOURCE_MESSAGE_LIMIT),
    })),
  };
}

export function buildCanvasAgentState(nodeContext?: NodeContext | null): CanvasAgentState {
  const resolvedContext = nodeContext !== undefined ? nodeContext : useChatStore.getState().activeNodeContext;
  const flow = useFlowStore.getState();
  const chat = useChatStore.getState();
  const workspace = useWorkspaceStore.getState().getActiveWorkspace();
  const { llmConfig } = useSettingsStore.getState();

  const conversations = Object.fromEntries(
    flow.nodes.map((node) => [node.id, summarizeConversation(chat.conversations[node.id], node.id)]),
  );
  const nodes = flow.nodes.map((node, i) => summarizeNode(node, chat.conversations[node.id], i + 1));
  const selectedNodes = nodes.filter((node) => node.selected);

  return {
    activeWorkspace: workspace
      ? {
          id: workspace.id,
          name: workspace.name,
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
          description: workspace.description,
        }
      : null,
    nodes,
    edges: flow.edges.map(summarizeEdge),
    conversations,
    selectedNodes,
    currentMessages: buildCurrentMessages(selectedNodes, conversations),
    mergeContext: buildMergeContext(selectedNodes, conversations),
    nodeContext: resolvedContext,
    llmConfig: {
      providerId: llmConfig.providerId,
      model: llmConfig.model,
      endpoint: llmConfig.endpoint,
      temperature: llmConfig.temperature ?? 0.7,
    },
  };
}
