import { describe, it, expect } from 'vitest';
import {
  getRootSystemPrompt,
  getBranchSystemPrompt,
  getMergeSystemPrompt,
} from '../systemPrompts';

describe('getRootSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = getRootSystemPrompt();
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe('string');
  });

  it('mentions markdown formatting', () => {
    expect(getRootSystemPrompt()).toContain('markdown');
  });
});

describe('getBranchSystemPrompt', () => {
  it('uses the first user message as the topic', () => {
    const messages = [
      { role: 'user', content: 'What is quantum computing?' },
      { role: 'assistant', content: 'Quantum computing is...' },
    ];
    const prompt = getBranchSystemPrompt('New Chat', messages);
    expect(prompt).toContain('What is quantum computing?');
    expect(prompt).not.toContain('New Chat');
  });

  it('falls back to parentTopic when there are no user messages', () => {
    const prompt = getBranchSystemPrompt('Fallback Topic', []);
    expect(prompt).toContain('Fallback Topic');
  });

  it('includes additional user questions in the summary', () => {
    const messages = [
      { role: 'user', content: 'Main question' },
      { role: 'assistant', content: 'Answer 1' },
      { role: 'user', content: 'Follow-up A' },
      { role: 'assistant', content: 'Answer 2' },
      { role: 'user', content: 'Follow-up B' },
      { role: 'assistant', content: 'Answer 3' },
    ];
    const prompt = getBranchSystemPrompt('New Chat', messages);
    expect(prompt).toContain('also discussed');
    expect(prompt).toContain('Follow-up A');
    expect(prompt).toContain('Follow-up B');
  });

  it('truncates user messages to 60 characters', () => {
    const longMessage = 'A'.repeat(100);
    const messages = [
      { role: 'user', content: longMessage },
      { role: 'assistant', content: 'ok' },
    ];
    const prompt = getBranchSystemPrompt('New Chat', messages);
    // The topic derived from the first message should be at most 60 chars
    expect(prompt).toContain('A'.repeat(60));
    expect(prompt).not.toContain('A'.repeat(61));
  });

  it('limits additional questions to 3', () => {
    const messages = [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'A2' },
      { role: 'user', content: 'Q3' },
      { role: 'assistant', content: 'A3' },
      { role: 'user', content: 'Q4' },
      { role: 'assistant', content: 'A4' },
      { role: 'user', content: 'Q5' },
      { role: 'assistant', content: 'A5' },
    ];
    const prompt = getBranchSystemPrompt('New Chat', messages);
    // Q1 is the topic, Q2-Q4 are in "also discussed", Q5 is excluded
    expect(prompt).toContain('Q2');
    expect(prompt).toContain('Q3');
    expect(prompt).toContain('Q4');
    expect(prompt).not.toContain('Q5');
  });

  it('handles a single user message without "also discussed"', () => {
    const messages = [
      { role: 'user', content: 'Only question' },
      { role: 'assistant', content: 'Answer' },
    ];
    const prompt = getBranchSystemPrompt('New Chat', messages);
    expect(prompt).toContain('Only question');
    expect(prompt).not.toContain('also discussed');
  });

  it('filters out system messages', () => {
    const messages = [
      { role: 'system', content: 'You are an assistant' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
    ];
    const prompt = getBranchSystemPrompt('New Chat', messages);
    expect(prompt).toContain('Hello');
    expect(prompt).not.toContain('You are an assistant');
  });
});

describe('getMergeSystemPrompt', () => {
  const makeParent = (topic: string, msgs: Array<{ role: string; content: string }>) => ({
    topic,
    messages: msgs,
  });

  it('includes all parent conversation digests', () => {
    const parents = [
      makeParent('Topic A', [
        { role: 'user', content: 'What is React?' },
        { role: 'assistant', content: 'React is a JavaScript library for building UIs.' },
      ]),
      makeParent('Topic B', [
        { role: 'user', content: 'What is Vue?' },
        { role: 'assistant', content: 'Vue is a progressive framework.' },
      ]),
    ];
    const prompt = getMergeSystemPrompt(parents, 'Compare these');
    expect(prompt).toContain('Conversation 1');
    expect(prompt).toContain('Conversation 2');
    expect(prompt).toContain('What is React?');
    expect(prompt).toContain('What is Vue?');
  });

  it('includes the user action', () => {
    const parents = [
      makeParent('A', [{ role: 'user', content: 'Hello' }]),
    ];
    const prompt = getMergeSystemPrompt(parents, 'Summarize everything');
    expect(prompt).toContain('Summarize everything');
  });

  it('uses first user message as effective topic instead of node title', () => {
    const parents = [
      makeParent('New Chat', [
        { role: 'user', content: 'Explain quantum entanglement' },
        { role: 'assistant', content: 'Quantum entanglement is...' },
      ]),
    ];
    const prompt = getMergeSystemPrompt(parents, 'Summarize');
    expect(prompt).toContain('Explain quantum entanglement');
    // "New Chat" should not appear as the topic label
    expect(prompt).not.toContain('"New Chat"');
  });

  it('pairs user questions with assistant answers', () => {
    const parents = [
      makeParent('Topic', [
        { role: 'user', content: 'Question 1?' },
        { role: 'assistant', content: 'Answer 1.' },
        { role: 'user', content: 'Question 2?' },
        { role: 'assistant', content: 'Answer 2.' },
      ]),
    ];
    const prompt = getMergeSystemPrompt(parents, 'analyze');
    expect(prompt).toContain('Q: Question 1?');
    expect(prompt).toContain('A: Answer 1.');
    expect(prompt).toContain('Q: Question 2?');
    expect(prompt).toContain('A: Answer 2.');
  });

  it('truncates long answers at 300 characters with ellipsis', () => {
    const longAnswer = 'B'.repeat(400);
    const parents = [
      makeParent('Topic', [
        { role: 'user', content: 'Q' },
        { role: 'assistant', content: longAnswer },
      ]),
    ];
    const prompt = getMergeSystemPrompt(parents, 'test');
    expect(prompt).toContain('B'.repeat(300));
    expect(prompt).toContain('...');
    expect(prompt).not.toContain('B'.repeat(301));
  });

  it('limits exchanges to 5 per parent', () => {
    const messages: Array<{ role: string; content: string }> = [];
    for (let i = 1; i <= 7; i++) {
      messages.push({ role: 'user', content: `Question ${i}` });
      messages.push({ role: 'assistant', content: `Answer ${i}` });
    }
    const parents = [makeParent('Topic', messages)];
    const prompt = getMergeSystemPrompt(parents, 'test');
    expect(prompt).toContain('Question 5');
    expect(prompt).not.toContain('Question 6');
  });

  it('handles parent with no messages', () => {
    const parents = [makeParent('Empty', [])];
    const prompt = getMergeSystemPrompt(parents, 'test');
    expect(prompt).toContain('no messages yet');
  });

  it('filters out system messages from digests', () => {
    const parents = [
      makeParent('Topic', [
        { role: 'system', content: 'System instruction' },
        { role: 'user', content: 'User question' },
        { role: 'assistant', content: 'Response' },
      ]),
    ];
    const prompt = getMergeSystemPrompt(parents, 'test');
    expect(prompt).not.toContain('System instruction');
    expect(prompt).toContain('User question');
  });

  it('handles user question without a following assistant answer', () => {
    const parents = [
      makeParent('Topic', [
        { role: 'user', content: 'Unanswered question' },
      ]),
    ];
    const prompt = getMergeSystemPrompt(parents, 'test');
    expect(prompt).toContain('Q: Unanswered question');
    // Should not have an "A:" for this question
    const lines = prompt.split('\n');
    const qLine = lines.findIndex((l) => l.includes('Q: Unanswered question'));
    expect(lines[qLine + 1]).not.toContain('A:');
  });
});
