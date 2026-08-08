import { describe, expect, it } from 'vitest';
import { deriveExplanationPresentation } from './explanationBlocks';

describe('deriveExplanationPresentation', () => {
  it('creates an inline mind map only for five or more parallel bullets', () => {
    const four = deriveExplanationPresentation('- One\n- Two\n- Three\n- Four', 'Topic');
    expect(four.blocks).toEqual([]);

    const five = deriveExplanationPresentation('## Dimensions\n- One\n- Two\n- Three\n- Four\n- Five', 'Topic');
    expect(five.blocks).toHaveLength(1);
    expect(five.blocks[0]).toMatchObject({ type: 'mind_map', title: 'Dimensions' });
    if (five.blocks[0]?.type === 'mind_map') expect(five.blocks[0].root.children).toHaveLength(5);
    expect(five.content).not.toContain('- One');
  });

  it('turns a markdown comparison table into a controlled table block', () => {
    const result = deriveExplanationPresentation(
      '## Options\n| Option | Speed |\n| --- | --- |\n| A | Fast |\n| B | Safe |',
      'Topic',
    );
    expect(result.blocks[0]).toMatchObject({ type: 'comparison_table', columns: ['Option', 'Speed'] });
    expect(result.content).not.toContain('| A | Fast |');
  });

  it('accepts the common blank corner header used by comparison tables', () => {
    const result = deriveExplanationPresentation(
      '## PE and financing\n| | PE fund | Private financing |\n| --- | --- | --- |\n| 角色 | Investor | Financing action |\n| 方向 | Invests money | Raises money |',
      'PE',
    );
    expect(result.blocks[0]).toMatchObject({
      type: 'comparison_table',
      columns: ['维度', 'PE fund', 'Private financing'],
    });
  });

  it('never throws when the topic is empty', () => {
    expect(() => deriveExplanationPresentation('- A\n- B\n- C\n- D\n- E', '')).not.toThrow();
  });
});
