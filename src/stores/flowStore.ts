import type React from 'react';
import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react';
import { nanoid } from 'nanoid';
import type { ChatNode, ChatNodeData, TopicEdge } from '../types/flow';

interface FlowState {
  nodes: ChatNode[];
  edges: TopicEdge[];
  onNodesChange: OnNodesChange<ChatNode>;
  onEdgesChange: OnEdgesChange<TopicEdge>;
  addChatNode: (position: { x: number; y: number }, data: ChatNodeData) => string;
  removeNode: (id: string) => void;
  updateNodeData: (id: string, data: Partial<ChatNodeData>) => void;
  updateNodeStyle: (id: string, style: React.CSSProperties) => void;
  addEdge: (source: string, target: string, label: string) => void;
  setNodes: (nodes: ChatNode[]) => void;
  setEdges: (edges: TopicEdge[]) => void;
  getChildCount: (parentId: string) => number;
  toggleCollapseSmart: () => void;
}

export const useFlowStore = create<FlowState>((set, get) => ({
  nodes: [],
  edges: [],

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  addChatNode: (position, data) => {
    const id = nanoid();
    const newNode: ChatNode = {
      id,
      type: 'chat',
      position,
      data,
      style: { width: 400, height: 500 },
    };
    set({ nodes: [...get().nodes, newNode] });
    return id;
  },

  removeNode: (id) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
    });
  },

  updateNodeData: (id, data) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      ),
    });
  },

  updateNodeStyle: (id, style) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, style: { ...n.style, ...style } } : n
      ),
    });
  },

  addEdge: (source, target, label) => {
    const edge: TopicEdge = {
      id: `e-${source}-${target}`,
      source,
      target,
      sourceHandle: 'right',
      targetHandle: 'left',
      type: 'topic',
      data: { label },
    };
    set({ edges: [...get().edges, edge] });
  },

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  getChildCount: (parentId) => {
    return get().edges.filter((e) => e.source === parentId).length;
  },

  toggleCollapseSmart: () => {
  const nodes = get().nodes;

  if (nodes.length === 0) return;

  const collapsedCount = nodes.filter((n) => n.data?.collapsed).length;

  const shouldCollapse = collapsedCount < nodes.length / 2;

  set({
    nodes: nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        collapsed: shouldCollapse,
      },
    })),
  });
},
  
}));
