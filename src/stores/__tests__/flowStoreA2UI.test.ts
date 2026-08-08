import { beforeEach, describe, expect, it } from 'vitest';
import { createChangeSetReviewBlocks } from '../../../packages/protocol/src/a2ui';
import type { AgentEvent, ChangeSet } from '../../../packages/protocol/src/agent';
import { useFlowStore } from '../flowStore';

const changeSet: ChangeSet = {
  changeSetId: 'change-1',
  runId: 'run-1',
  baseCommit: 'a'.repeat(40),
  files: [{ path: 'src/app.ts', status: 'modified', additions: 1, deletions: 0 }],
  diff: 'diff',
  truncated: false,
  createdAt: 1,
};

function event(type: AgentEvent['type'], sequence: number, payload: AgentEvent['payload']): AgentEvent {
  return { version: 1, eventId: `event-${sequence}`, runId: 'run-1', nodeId: 'node-1', sequence, timestamp: sequence + 1, type, payload };
}

describe('flowStore A2UI events', () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [] });
    useFlowStore.getState().addChatNode({ x: 0, y: 0 }, { topic: 'Node' });
    const node = useFlowStore.getState().nodes[0];
    useFlowStore.setState({ nodes: [{ ...node, id: 'node-1' }] });
    useFlowStore.getState().beginNodeRun('node-1', 'run-1', 1);
  });

  it('stores blocks and resolves their status after apply', () => {
    useFlowStore.getState().appendNodeRunEvent('node-1', event('change_set_created', 0, { changeSet }));
    createChangeSetReviewBlocks(changeSet).forEach((block, index) => {
      useFlowStore.getState().appendNodeRunEvent('node-1', event('a2ui_block', index + 1, { block }));
    });
    useFlowStore.getState().appendNodeRunEvent('node-1', event('review_ready', 3, {}));
    useFlowStore.getState().appendNodeRunEvent('node-1', event('patch_applied', 4, { changeSetId: 'change-1' }));

    const blocks = useFlowStore.getState().nodes[0].data.agentRuns?.[0].blocks;
    expect(blocks?.find((block) => block.type === 'diff_review')).toMatchObject({ status: 'applied' });
    expect(blocks?.find((block) => block.type === 'confirmation')).toMatchObject({ status: 'approved' });
  });
});
