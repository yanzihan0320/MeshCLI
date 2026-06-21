import { describe, it, expect, beforeEach } from 'vitest';
import { useFlowStore } from '../flowStore';

beforeEach(() => {
  // Reset store state between tests
  useFlowStore.setState({ nodes: [], edges: [] });
});

describe('flowStore', () => {
  describe('addChatNode', () => {
    it('adds a node with correct position and data', () => {
      const id = useFlowStore.getState().addChatNode(
        { x: 100, y: 200 },
        { topic: 'Test Topic' }
      );
      const { nodes } = useFlowStore.getState();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].id).toBe(id);
      expect(nodes[0].position).toEqual({ x: 100, y: 200 });
      expect(nodes[0].data.topic).toBe('Test Topic');
      expect(nodes[0].type).toBe('chat');
    });

    it('assigns default dimensions of 400x500', () => {
      useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'T' });
      const node = useFlowStore.getState().nodes[0];
      expect(node.style?.width).toBe(400);
      expect(node.style?.height).toBe(500);
    });

    it('returns a unique id for each node', () => {
      const id1 = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'A' });
      const id2 = useFlowStore.getState().addChatNode({ x: 100, y: 0 }, { topic: 'B' });
      expect(id1).not.toBe(id2);
      expect(useFlowStore.getState().nodes).toHaveLength(2);
    });

    it('preserves extra data fields like parentNodeId', () => {
      useFlowStore.getState().addChatNode(
        { x: 0, y: 0 },
        { topic: 'Child', parentNodeId: 'parent-1', branchText: 'selected text' }
      );
      const node = useFlowStore.getState().nodes[0];
      expect(node.data.parentNodeId).toBe('parent-1');
      expect(node.data.branchText).toBe('selected text');
    });
  });

  describe('removeNode', () => {
    it('removes the node by id', () => {
      const id = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'A' });
      useFlowStore.getState().addChatNode({ x: 100, y: 0 }, { topic: 'B' });
      expect(useFlowStore.getState().nodes).toHaveLength(2);

      useFlowStore.getState().removeNode(id);
      expect(useFlowStore.getState().nodes).toHaveLength(1);
      expect(useFlowStore.getState().nodes[0].data.topic).toBe('B');
    });

    it('also removes connected edges', () => {
      const id1 = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'A' });
      const id2 = useFlowStore.getState().addChatNode({ x: 100, y: 0 }, { topic: 'B' });
      const id3 = useFlowStore.getState().addChatNode({ x: 200, y: 0 }, { topic: 'C' });
      useFlowStore.getState().addEdge(id1, id2, 'branch');
      useFlowStore.getState().addEdge(id2, id3, 'branch');
      expect(useFlowStore.getState().edges).toHaveLength(2);

      useFlowStore.getState().removeNode(id2);
      // Both edges involving id2 should be removed
      expect(useFlowStore.getState().edges).toHaveLength(0);
    });

    it('does nothing when removing a non-existent id', () => {
      useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'A' });
      useFlowStore.getState().removeNode('non-existent');
      expect(useFlowStore.getState().nodes).toHaveLength(1);
    });
  });

  describe('updateNodeData', () => {
    it('merges new data into existing node data', () => {
      const id = useFlowStore.getState().addChatNode(
        { x: 0, y: 0 },
        { topic: 'Original', collapsed: false }
      );
      useFlowStore.getState().updateNodeData(id, { topic: 'Updated' });
      const node = useFlowStore.getState().nodes[0];
      expect(node.data.topic).toBe('Updated');
      expect(node.data.collapsed).toBe(false); // preserved
    });

    it('does not affect other nodes', () => {
      const id1 = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'A' });
      useFlowStore.getState().addChatNode({ x: 100, y: 0 }, { topic: 'B' });
      useFlowStore.getState().updateNodeData(id1, { topic: 'A-updated' });
      expect(useFlowStore.getState().nodes[1].data.topic).toBe('B');
    });
  });

  describe('addEdge', () => {
    it('creates an edge with correct properties', () => {
      const id1 = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'A' });
      const id2 = useFlowStore.getState().addChatNode({ x: 100, y: 0 }, { topic: 'B' });
      useFlowStore.getState().addEdge(id1, id2, 'test label');

      const { edges } = useFlowStore.getState();
      expect(edges).toHaveLength(1);
      expect(edges[0].source).toBe(id1);
      expect(edges[0].target).toBe(id2);
      expect(edges[0].data?.label).toBe('test label');
      expect(edges[0].type).toBe('topic');
      expect(edges[0].sourceHandle).toBe('right');
      expect(edges[0].targetHandle).toBe('left');
    });

    it('creates deterministic edge id from source and target', () => {
      useFlowStore.getState().addEdge('src-1', 'tgt-2', 'label');
      expect(useFlowStore.getState().edges[0].id).toBe('e-src-1-tgt-2');
    });
  });

  describe('getChildCount', () => {
    it('returns 0 for a node with no children', () => {
      const id = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'A' });
      expect(useFlowStore.getState().getChildCount(id)).toBe(0);
    });

    it('counts edges where the node is the source', () => {
      const parent = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'P' });
      const child1 = useFlowStore.getState().addChatNode({ x: 100, y: 0 }, { topic: 'C1' });
      const child2 = useFlowStore.getState().addChatNode({ x: 100, y: 100 }, { topic: 'C2' });
      useFlowStore.getState().addEdge(parent, child1, 'branch 1');
      useFlowStore.getState().addEdge(parent, child2, 'branch 2');
      expect(useFlowStore.getState().getChildCount(parent)).toBe(2);
    });

    it('does not count edges where the node is the target', () => {
      const grandparent = useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'GP' });
      const parent = useFlowStore.getState().addChatNode({ x: 100, y: 0 }, { topic: 'P' });
      const child = useFlowStore.getState().addChatNode({ x: 200, y: 0 }, { topic: 'C' });
      useFlowStore.getState().addEdge(grandparent, parent, 'branch');
      useFlowStore.getState().addEdge(parent, child, 'branch');
      // Parent has 1 child (child), not counting the edge from grandparent
      expect(useFlowStore.getState().getChildCount(parent)).toBe(1);
    });
  });

  describe('setNodes / setEdges', () => {
    it('replaces all nodes', () => {
      useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'A' });
      useFlowStore.getState().addChatNode({ x: 100, y: 0 }, { topic: 'B' });
      expect(useFlowStore.getState().nodes).toHaveLength(2);

      useFlowStore.getState().setNodes([]);
      expect(useFlowStore.getState().nodes).toHaveLength(0);
    });

    it('replaces all edges', () => {
      useFlowStore.getState().addEdge('a', 'b', 'label');
      expect(useFlowStore.getState().edges).toHaveLength(1);

      useFlowStore.getState().setEdges([]);
      expect(useFlowStore.getState().edges).toHaveLength(0);
    });
  });

  describe('updateNodeData', () => {

    it('updates node color', () => {
  const id = useFlowStore.getState().addChatNode(
    { x: 0, y: 0 },
    { topic: 'Test' }
  );

  useFlowStore.getState().updateNodeData(id, { color: '#ef4444' });

  const node = useFlowStore.getState().nodes.find((n) => n.id === id);

  expect(node?.data.color).toBe('#ef4444');
    });

    it('updates node label', () => {
      const id = useFlowStore.getState().addChatNode(
        { x: 0, y: 0 },
        { topic: 'Test' }
      );

      useFlowStore.getState().updateNodeData(id, { label: 'Research' });

      const node = useFlowStore.getState().nodes.find((n) => n.id === id);

      expect(node?.data.label).toBe('Research');
    });

    it('clears color and label when undefined is passed', () => {
      const id = useFlowStore.getState().addChatNode(
        { x: 0, y: 0 },
        { topic: 'Test', color: '#fff', label: 'Temp' }
      );

      useFlowStore.getState().updateNodeData(id, {
        color: undefined,
        label: undefined,
      });

      const node = useFlowStore.getState().nodes.find((n) => n.id === id);

      expect(node?.data.color).toBeUndefined();
      expect(node?.data.label).toBeUndefined();
    });

    it('does not overwrite other node data fields when updating color/label', () => {
      const id = useFlowStore.getState().addChatNode(
        { x: 0, y: 0 },
        { topic: 'Original', collapsed: true }
      );

      useFlowStore.getState().updateNodeData(id, {
        color: '#22c55e',
        label: 'Approved',
      });

      const node = useFlowStore.getState().nodes.find((n) => n.id === id);

      expect(node?.data.topic).toBe('Original');
      expect(node?.data.collapsed).toBe(true);
      expect(node?.data.color).toBe('#22c55e');
      expect(node?.data.label).toBe('Approved');
    });
  })
});
