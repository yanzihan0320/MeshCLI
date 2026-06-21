import type { ChatNode, TopicEdge } from '../types/flow';

const NODE_WIDTH = 400;
const HORIZONTAL_GAP = 100;
const VERTICAL_GAP = 40;
const NODE_HEIGHT = 500;
const COMPONENT_GAP = 200;

export function calculateMergePosition(
  parentNodes: ChatNode[]
): { x: number; y: number } {
  if (parentNodes.length === 0) return { x: 0, y: 0 };

  let maxRight = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const node of parentNodes) {
    const width = (node.style?.width as number) ?? NODE_WIDTH;
    const height = (node.style?.height as number) ?? NODE_HEIGHT;
    const right = node.position.x + width;
    if (right > maxRight) maxRight = right;
    if (node.position.y < minY) minY = node.position.y;
    if (node.position.y + height > maxY) maxY = node.position.y + height;
  }

  const x = maxRight + HORIZONTAL_GAP;
  const y = (minY + maxY) / 2 - NODE_HEIGHT / 2;

  return { x, y };
}

export function calculateBranchPosition(
  parentNode: ChatNode,
  existingChildCount: number
): { x: number; y: number } {
  const parentX = parentNode.position.x;
  const parentY = parentNode.position.y;
  const parentWidth =
    (parentNode.style?.width as number) ?? NODE_WIDTH;

  const x = parentX + parentWidth + HORIZONTAL_GAP;
  const y =
    parentY + existingChildCount * (NODE_HEIGHT + VERTICAL_GAP);

  return { x, y };
}

interface AutoLayoutOptions {
  horizontalGap?: number;
  verticalGap?: number;
  componentGap?: number;
  origin?: { x: number; y: number };
}

interface NodeMetrics {
  width: number;
  height: number;
}

export function calculateAutoLayoutPositions(
  nodes: ChatNode[],
  edges: TopicEdge[],
  options: AutoLayoutOptions = {}
): Record<string, { x: number; y: number }> {
  if (nodes.length === 0) return {};
  if (nodes.length === 1 && edges.length === 0) {
    const singleNode = nodes[0];
    return {
      [singleNode.id]: {
        x: singleNode.position.x,
        y: singleNode.position.y,
      },
    };
  }

  const horizontalGap = options.horizontalGap ?? HORIZONTAL_GAP;
  const verticalGap = options.verticalGap ?? VERTICAL_GAP;
  const componentGap = options.componentGap ?? COMPONENT_GAP;
  const originX = options.origin?.x ?? 0;
  const originY = options.origin?.y ?? 0;

  const nodeMap = new Map<string, ChatNode>();
  const metrics = new Map<string, NodeMetrics>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    metrics.set(node.id, {
      width: (node.style?.width as number) ?? NODE_WIDTH,
      height: (node.style?.height as number) ?? NODE_HEIGHT,
    });
  }

  const childMap = new Map<string, string[]>();
  const parentMap = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const node of nodes) {
    childMap.set(node.id, []);
    parentMap.set(node.id, []);
    indegree.set(node.id, 0);
  }

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    childMap.get(edge.source)!.push(edge.target);
    parentMap.get(edge.target)!.push(edge.source);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const roots = nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .sort((a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id));

  const queue: string[] = roots.map((node) => node.id);
  const depth = new Map<string, number>();
  const indegreeWork = new Map(indegree);

  for (const root of roots) {
    depth.set(root.id, 0);
  }

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentDepth = depth.get(currentId) ?? 0;

    for (const childId of childMap.get(currentId) ?? []) {
      const childDepth = depth.get(childId);
      const nextDepth = currentDepth + 1;
      if (childDepth === undefined || nextDepth > childDepth) {
        depth.set(childId, nextDepth);
      }

      const nextIndegree = (indegreeWork.get(childId) ?? 0) - 1;
      indegreeWork.set(childId, nextIndegree);
      if (nextIndegree === 0) {
        queue.push(childId);
      }
    }
  }

  for (const node of nodes) {
    if (!depth.has(node.id)) {
      const parentDepths = (parentMap.get(node.id) ?? [])
        .map((parentId) => depth.get(parentId))
        .filter((d): d is number => d !== undefined);
      depth.set(
        node.id,
        parentDepths.length > 0 ? Math.max(...parentDepths) + 1 : 0
      );
    }
  }

  const undirectedAdjacency = new Map<string, Set<string>>();
  for (const node of nodes) {
    undirectedAdjacency.set(node.id, new Set());
  }
  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    undirectedAdjacency.get(edge.source)!.add(edge.target);
    undirectedAdjacency.get(edge.target)!.add(edge.source);
  }

  const components: string[][] = [];
  const visited = new Set<string>();
  const nodeIdsByTop = [...nodes]
    .sort((a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id))
    .map((node) => node.id);

  for (const startId of nodeIdsByTop) {
    if (visited.has(startId)) continue;
    const component: string[] = [];
    const stack = [startId];
    visited.add(startId);
    while (stack.length > 0) {
      const id = stack.pop()!;
      component.push(id);
      for (const neighbor of undirectedAdjacency.get(id) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
    components.push(component);
  }

  const result = new Map<string, { x: number; y: number }>();
  let currentComponentTop = originY;

  for (const componentNodeIds of components) {
    const nodesByDepth = new Map<number, string[]>();
    let maxDepth = 0;

    for (const nodeId of componentNodeIds) {
      const d = depth.get(nodeId) ?? 0;
      maxDepth = Math.max(maxDepth, d);
      const group = nodesByDepth.get(d) ?? [];
      group.push(nodeId);
      nodesByDepth.set(d, group);
    }

    for (const [d, ids] of nodesByDepth) {
      ids.sort((a, b) => {
        const ay = nodeMap.get(a)!.position.y;
        const by = nodeMap.get(b)!.position.y;
        return ay - by || a.localeCompare(b);
      });
      nodesByDepth.set(d, ids);
    }

    const columnWidths: number[] = [];
    for (let d = 0; d <= maxDepth; d += 1) {
      const ids = nodesByDepth.get(d) ?? [];
      let width = NODE_WIDTH;
      for (const id of ids) {
        width = Math.max(width, metrics.get(id)!.width);
      }
      columnWidths[d] = width;
    }

    const columnX: number[] = [];
    columnX[0] = originX;
    for (let d = 1; d <= maxDepth; d += 1) {
      columnX[d] = columnX[d - 1] + columnWidths[d - 1] + horizontalGap;
    }

    const centerY = new Map<string, number>();
    const depthZeroIds = nodesByDepth.get(0) ?? [];

    let nextCenter = 0;
    for (const id of depthZeroIds) {
      const height = metrics.get(id)!.height;
      centerY.set(id, nextCenter + height / 2);
      nextCenter += height + verticalGap;
    }

    for (let d = 0; d < maxDepth; d += 1) {
      const ids = nodesByDepth.get(d) ?? [];

      for (const parentId of ids) {
        const children = (childMap.get(parentId) ?? [])
          .filter((childId) => (depth.get(childId) ?? 0) === d + 1)
          .sort((a, b) => {
            const ay = nodeMap.get(a)!.position.y;
            const by = nodeMap.get(b)!.position.y;
            return ay - by || a.localeCompare(b);
          });

        if (children.length === 0) continue;

        const parentCenter = centerY.get(parentId) ?? 0;
        const totalChildrenHeight = children.reduce(
          (sum, childId) => sum + metrics.get(childId)!.height,
          0
        );
        const totalHeight =
          totalChildrenHeight + verticalGap * (children.length - 1);

        let cursor = parentCenter - totalHeight / 2;
        for (const childId of children) {
          const childHeight = metrics.get(childId)!.height;
          const proposal = cursor + childHeight / 2;
          const existing = centerY.get(childId);
          centerY.set(
            childId,
            existing === undefined ? proposal : (existing + proposal) / 2
          );
          cursor += childHeight + verticalGap;
        }
      }

      const nextDepthIds = (nodesByDepth.get(d + 1) ?? []).sort((a, b) => {
        const ay = centerY.get(a) ?? nodeMap.get(a)!.position.y;
        const by = centerY.get(b) ?? nodeMap.get(b)!.position.y;
        return ay - by || a.localeCompare(b);
      });

      let previousId: string | undefined;
      for (const id of nextDepthIds) {
        if (!centerY.has(id)) {
          centerY.set(id, nodeMap.get(id)!.position.y + metrics.get(id)!.height / 2);
        }

        if (previousId === undefined) {
          previousId = id;
          continue;
        }

        const prevCenter = centerY.get(previousId)!;
        const currentCenter = centerY.get(id)!;
        const minDistance =
          metrics.get(previousId)!.height / 2 +
          metrics.get(id)!.height / 2 +
          verticalGap;
        if (currentCenter < prevCenter + minDistance) {
          centerY.set(id, prevCenter + minDistance);
        }
        previousId = id;
      }
    }

    let componentMinY = Infinity;
    let componentMaxY = -Infinity;
    for (const id of componentNodeIds) {
      const d = depth.get(id) ?? 0;
      const x = columnX[d];
      const y = (centerY.get(id) ?? 0) - metrics.get(id)!.height / 2;
      result.set(id, { x, y });
      componentMinY = Math.min(componentMinY, y);
      componentMaxY = Math.max(componentMaxY, y + metrics.get(id)!.height);
    }

    const componentHeight = componentMaxY - componentMinY;
    const yOffset = currentComponentTop - componentMinY;
    for (const id of componentNodeIds) {
      const positioned = result.get(id)!;
      result.set(id, { x: positioned.x, y: positioned.y + yOffset });
    }

    currentComponentTop += componentHeight + componentGap;
  }

  return Object.fromEntries(result.entries());
}
