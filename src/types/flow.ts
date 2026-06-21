import type { Node, Edge } from '@xyflow/react';

export interface ChatNodeData {
  topic: string;
  parentNodeId?: string;
  parentNodeIds?: string[];
  branchText?: string;
  mergeAction?: string;
  collapsed?: boolean;
  minimized?: boolean;
  maximized?: boolean;
  [key: string]: unknown;
  color?: string
  label?: string
}

export type ChatNode = Node<ChatNodeData, 'chat'>;

export interface TopicEdgeData {
  label: string;
  [key: string]: unknown;
}

export type TopicEdge = Edge<TopicEdgeData>;
