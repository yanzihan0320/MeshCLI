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
import type { AgentEvent, AgentRunRecord } from '../../packages/protocol/src/agent';
import { isTerminalAgentEvent, statusAfterEvent } from '../../packages/protocol/src/agent';

const MAX_RUNS_PER_NODE = 10;
const MAX_EVENTS_PER_RUN = 1_000;

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
  beginNodeRun: (nodeId: string, runId: string, startedAt?: number) => void;
  appendNodeRunEvent: (nodeId: string, event: AgentEvent) => void;
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

  beginNodeRun: (nodeId, runId, startedAt = Date.now()) => {
    set({
      nodes: get().nodes.map((node) => {
        if (node.id !== nodeId) return node;
        const existingRuns = node.data.agentRuns ?? [];
        if (existingRuns.some((run) => run.runId === runId)) return node;
        const run: AgentRunRecord = {
          runId,
          status: 'queued',
          startedAt,
          events: [],
        };
        return {
          ...node,
          data: {
            ...node.data,
            agentRuns: [...existingRuns, run].slice(-MAX_RUNS_PER_NODE),
          },
        };
      }),
    });
  },

  appendNodeRunEvent: (nodeId, event) => {
    if (event.nodeId !== nodeId) return;
    set({
      nodes: get().nodes.map((node) => {
        if (node.id !== nodeId) return node;
        const runs = node.data.agentRuns ?? [];
        const runIndex = runs.findIndex((run) => run.runId === event.runId);
        if (runIndex < 0) return node;
        const run = runs[runIndex];
        if (run.events.some((storedEvent) => storedEvent.eventId === event.eventId)) return node;
        const updatedRun: AgentRunRecord = {
          ...run,
          status: statusAfterEvent(event.type),
          finishedAt: isTerminalAgentEvent(event.type) ? event.timestamp : run.finishedAt,
          events: [...run.events, event]
            .sort((a, b) => a.sequence - b.sequence)
            .slice(-MAX_EVENTS_PER_RUN),
        };
        const updatedRuns = [...runs];
        updatedRuns[runIndex] = updatedRun;
        return { ...node, data: { ...node.data, agentRuns: updatedRuns } };
      }),
    });
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
