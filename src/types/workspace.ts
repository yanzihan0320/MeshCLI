import type { ChatNode, TopicEdge } from './flow';
import type { Conversation } from './chat';

export interface WorkspaceMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  description?: string;
}

export interface WorkspaceData {
  nodes: ChatNode[];
  edges: TopicEdge[];
  conversations: Record<string, Conversation>;
}

export interface WorkspaceFile {
  version: 1;
  type: 'caudalflow-workspace';
  metadata: WorkspaceMetadata;
  data: WorkspaceData;
}
