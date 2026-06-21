import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFlowStore } from '../../../stores/flowStore';
import { useChatStore } from '../../../stores/chatStore';
import {
  focusNode,
  numberStyleValue,
  createNodeAtEnd,
  handleCreateBranchFromNode,
  handleMergeChatNodes,
  handleDeleteChatNode,
  handleAppendNodeMessage,
  handleUpdateChatNode,
  handleHighlightWorkspaceFinding,
} from '../canvasHandlers';

beforeEach(() => {
  useFlowStore.setState({ nodes: [], edges: [] });
  useChatStore.setState({ conversations: {}, activeNodeContext: null });
});

describe('numberStyleValue', () => {
  it('returns the value when it is a finite number', () => {
    expect(numberStyleValue(42, 100)).toBe(42);
  });

  it('returns fallback for non-number values', () => {
    expect(numberStyleValue('400px', 100)).toBe(100);
    expect(numberStyleValue(undefined, 200)).toBe(200);
    expect(numberStyleValue(null, 300)).toBe(300);
  });

  it('returns fallback for non-finite numbers', () => {
    expect(numberStyleValue(Infinity, 100)).toBe(100);
    expect(numberStyleValue(NaN, 200)).toBe(200);
  });
});

describe('focusNode', () => {
  it('calls setCenter with center coordinates of the node', () => {
    const nodeId = useFlowStore.getState().addChatNode({ x: 100, y: 200 }, { topic: 'Test' });
    const setCenter = vi.fn();
    focusNode(nodeId, setCenter);
    // Default width 400, height 500 → center = (100 + 200, 200 + 250)
    expect(setCenter).toHaveBeenCalledWith(300, 450, { zoom: 0.9, duration: 350 });
  });

  it('returns false for a non-existent node', () => {
    const setCenter = vi.fn();
    expect(focusNode('missing', setCenter)).toBe(false);
    expect(setCenter).not.toHaveBeenCalled();
  });

  it('uses dimension fallbacks when style has no explicit width/height', () => {
    const flow = useFlowStore.getState();
    const nodeId = flow.addChatNode({ x: 0, y: 0 }, { topic: 'No dims' });
    // The addChatNode sets default style {width: 400, height: 500}
    // Override to have no style
    useFlowStore.setState({
      nodes: useFlowStore.getState().nodes.map((n) =>
        n.id === nodeId ? { ...n, style: {} } : n,
      ),
    });
    const setCenter = vi.fn();
    focusNode(nodeId, setCenter);
    // Fallback: width=400, height=500 → center = (200, 250)
    expect(setCenter).toHaveBeenCalledWith(200, 250, { zoom: 0.9, duration: 350 });
  });
});

describe('createNodeAtEnd', () => {
  it('creates a node at the grid position based on count', () => {
    const firstId = createNodeAtEnd('First');
    expect(useFlowStore.getState().nodes).toHaveLength(1);
    const first = useFlowStore.getState().nodes.find((n) => n.id === firstId);
    expect(first?.position).toEqual({ x: 80, y: 80 });
    expect(first?.data.topic).toBe('First');
  });

  it('wraps to next row after 4 nodes', () => {
    for (let i = 0; i < 4; i++) createNodeAtEnd(`Node ${i}`);
    const fifthId = createNodeAtEnd('Fifth');
    const fifth = useFlowStore.getState().nodes.find((n) => n.id === fifthId);
    // count=4 → x = 80 + (4%4)*460 = 80, y = 80 + floor(4/4)*560 = 640
    expect(fifth?.position).toEqual({ x: 80, y: 640 });
  });
});

describe('handleCreateBranchFromNode', () => {
  it('creates a child node and edge from a parent', () => {
    const parentId = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'Parent' });
    useChatStore.getState().initConversation(parentId);

    const result = handleCreateBranchFromNode({
      parentNodeId: parentId,
      topic: 'Child',
    });

    expect(result).toContain('created branch');
    expect(useFlowStore.getState().nodes).toHaveLength(2);
    expect(useFlowStore.getState().edges).toHaveLength(1);
    expect(useFlowStore.getState().edges[0].source).toBe(parentId);
  });

  it('copies parent context to system prompt', () => {
    const parentId = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'Parent' });
    useChatStore.getState().initConversation(parentId);
    useChatStore.getState().addMessage(parentId, 'user', 'What about costs?');
    useChatStore.getState().addMessage(parentId, 'assistant', 'Costs are high.');

    handleCreateBranchFromNode({ parentNodeId: parentId, topic: 'Cost deep-dive' });

    const childNode = useFlowStore.getState().nodes[1];
    const childMessages = useChatStore.getState().getMessages(childNode.id);
    expect(childMessages[0].role).toBe('system');
    expect(childMessages[0].content).toContain('What about costs?');
  });

  it('adds optional prompt and assistant message', () => {
    const parentId = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'Parent' });
    useChatStore.getState().initConversation(parentId);

    handleCreateBranchFromNode({
      parentNodeId: parentId,
      topic: 'Branch',
      prompt: 'Tell me more',
      assistantMessage: 'Here is more info.',
    });

    const childNode = useFlowStore.getState().nodes[1];
    const messages = useChatStore.getState().getMessages(childNode.id);
    const roles = messages.map((m) => m.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    expect(messages.find((m) => m.role === 'user')?.content).toBe('Tell me more');
  });

  it('returns error message for missing parent', () => {
    const result = handleCreateBranchFromNode({
      parentNodeId: 'non-existent',
      topic: 'Orphan',
    });
    expect(result).toContain('was not found');
  });
});

describe('handleMergeChatNodes', () => {
  it('creates a merge node from 2+ parents', () => {
    const firstId = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'A' });
    const secondId = useFlowStore.getState().addChatNode({ x: 500, y: 0 }, { topic: 'B' });
    useChatStore.getState().initConversation(firstId);
    useChatStore.getState().initConversation(secondId);

    const result = handleMergeChatNodes({
      nodeIds: [firstId, secondId],
      topic: 'A+B',
      mergeAction: 'compare',
    });

    expect(result).toContain('created merge node');
    expect(useFlowStore.getState().nodes).toHaveLength(3);
    expect(useFlowStore.getState().edges).toHaveLength(2);
  });

  it('returns error for fewer than 2 valid nodes', () => {
    const onlyId = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'Only' });
    const result = handleMergeChatNodes({
      nodeIds: [onlyId, 'missing'],
      topic: 'Merge',
      mergeAction: 'synthesize',
    });
    expect(result).toBe('at least two valid source nodes are required');
  });

  it('includes assistantSummary when provided', () => {
    const firstId = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'A' });
    const secondId = useFlowStore.getState().addChatNode({ x: 500, y: 0 }, { topic: 'B' });
    useChatStore.getState().initConversation(firstId);
    useChatStore.getState().initConversation(secondId);

    handleMergeChatNodes({
      nodeIds: [firstId, secondId],
      topic: 'Merged',
      mergeAction: 'combine',
      assistantSummary: 'Both options are viable.',
    });

    const mergeNode = useFlowStore.getState().nodes[2];
    const messages = useChatStore.getState().getMessages(mergeNode.id);
    expect(messages.some((m) => m.role === 'assistant' && m.content === 'Both options are viable.')).toBe(true);
  });
});

describe('handleDeleteChatNode', () => {
  it('removes the node and its conversation', () => {
    const nodeId = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'Doomed' });
    useChatStore.getState().initConversation(nodeId);
    useChatStore.getState().addMessage(nodeId, 'user', 'Goodbye');

    const result = handleDeleteChatNode(nodeId);

    expect(result).toContain('deleted node');
    expect(useFlowStore.getState().nodes).toHaveLength(0);
    expect(useChatStore.getState().conversations[nodeId]).toBeUndefined();
  });

  it('returns error for a missing node', () => {
    const result = handleDeleteChatNode('non-existent');
    expect(result).toContain('was not found');
  });
});

describe('handleAppendNodeMessage', () => {
  it('appends a message to an existing node', () => {
    const nodeId = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'Chat' });
    useChatStore.getState().initConversation(nodeId);

    const result = handleAppendNodeMessage({
      nodeId,
      role: 'user',
      content: 'Hello agent',
    });

    expect(result).toContain('appended user message');
    expect(useChatStore.getState().getMessages(nodeId)).toHaveLength(1);
  });

  it('includes triggeredBy metadata', () => {
    const nodeId = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'Target' });
    useChatStore.getState().initConversation(nodeId);

    handleAppendNodeMessage({
      nodeId,
      role: 'assistant',
      content: 'Cross-node update',
      triggeredBy: 'source-node',
    });

    const msg = useChatStore.getState().getMessages(nodeId)[0];
    expect(msg.triggeredBy).toBe('source-node');
  });

  it('returns error for a missing node', () => {
    const result = handleAppendNodeMessage({
      nodeId: 'missing',
      role: 'user',
      content: 'Hello',
    });
    expect(result).toContain('was not found');
  });
});

describe('handleUpdateChatNode', () => {
  it('updates topic of an existing node', () => {
    const nodeId = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'Old' });
    const result = handleUpdateChatNode({ nodeId, topic: 'New' });
    expect(result).toContain('updated node');
    expect(useFlowStore.getState().nodes[0].data.topic).toBe('New');
  });

  it('clears label with null', () => {
    const nodeId = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'Test' });
    useFlowStore.getState().updateNodeData(nodeId, { label: 'Old Label' });
    handleUpdateChatNode({ nodeId, label: null });
    expect(useFlowStore.getState().nodes[0].data.label).toBeUndefined();
  });

  it('returns error for a missing node', () => {
    const result = handleUpdateChatNode({ nodeId: 'missing', topic: 'Nope' });
    expect(result).toContain('was not found');
  });
});

describe('handleHighlightWorkspaceFinding', () => {
  it('creates a finding node with label and color', () => {
    const result = handleHighlightWorkspaceFinding({
      title: 'Key Finding',
      finding: 'This is important.',
      sourceNodeIds: [],
    });

    expect(result).toContain('created finding node');
    const node = useFlowStore.getState().nodes[0];
    expect(node.data.label).toBe('Finding');
    expect(node.data.color).toBe('#22c55e');

    const messages = useChatStore.getState().getMessages(node.id);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toBe('This is important.');
  });

  it('connects to source nodes with finding edges', () => {
    const sourceId = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'Source' });

    handleHighlightWorkspaceFinding({
      title: 'Insight',
      finding: 'Derived from source.',
      sourceNodeIds: [sourceId],
    });

    const edges = useFlowStore.getState().edges;
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe(sourceId);
    expect(edges[0].data?.label).toBe('finding');
  });
});
