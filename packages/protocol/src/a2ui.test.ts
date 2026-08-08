import { describe, expect, it } from 'vitest';
import { AgentEventSchema } from './agent';
import { A2UIBlockSchema, createChangeSetReviewBlocks } from './a2ui';
import type { ChangeSet } from './changes';

const changeSet: ChangeSet = {
  changeSetId: 'change-1',
  runId: 'run-1',
  baseCommit: 'a'.repeat(40),
  files: [{ path: 'src/app.ts', status: 'modified', additions: 3, deletions: 1 }],
  diff: 'diff --git a/src/app.ts b/src/app.ts',
  truncated: false,
  createdAt: 1,
};

describe('A2UI protocol', () => {
  it('creates validated diff review and bound confirmation blocks', () => {
    const blocks = createChangeSetReviewBlocks(changeSet);
    expect(A2UIBlockSchema.array().safeParse(blocks).success).toBe(true);
    expect(blocks.map((block) => block.type)).toEqual(['diff_review', 'confirmation']);
    const confirmation = blocks[1];
    expect(confirmation.type).toBe('confirmation');
    if (confirmation.type === 'confirmation') {
      expect(confirmation.subject).toMatchObject({
        runId: 'run-1',
        changeSetId: 'change-1',
        actionId: 'review-change-1',
      });
    }
  });

  it('rejects malformed interactive blocks carried by Agent events', () => {
    const result = AgentEventSchema.safeParse({
      version: 1,
      eventId: 'event-1',
      runId: 'run-1',
      nodeId: 'node-1',
      sequence: 0,
      timestamp: 1,
      type: 'a2ui_block',
      payload: { block: { type: 'confirmation' } },
    });
    expect(result.success).toBe(false);
  });

  it('validates explanation visualization blocks', () => {
    expect(A2UIBlockSchema.safeParse({
      version: 1,
      id: 'map-1',
      type: 'mind_map',
      title: 'Five perspectives',
      fallbackText: 'Five perspectives on the topic',
      layout: 'tree',
      root: {
        id: 'root',
        label: 'Topic',
        kind: 'topic',
        children: Array.from({ length: 5 }, (_, index) => ({
          id: `branch-${index}`,
          label: `Perspective ${index + 1}`,
          kind: 'idea',
          children: [],
        })),
      },
    }).success).toBe(true);
  });
});
