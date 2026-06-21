export function getRootSystemPrompt(): string {
  return `You are a knowledgeable assistant helping the user explore topics in depth. Provide clear, well-structured responses using markdown formatting. Use headings, lists, bold text, code blocks, and tables when appropriate to make information scannable and engaging. Keep responses informative but concise — the user can always ask follow-up questions or branch into subtopics.`;
}

export function getMergeSystemPrompt(
  parents: Array<{ topic: string; messages: Array<{ role: string; content: string }> }>,
  action: string
): string {
  const parentSummaries = parents.map((p, i) => {
    const nonSystemMessages = p.messages.filter((m) => m.role !== 'system');

    // Build a conversation digest: pair user questions with assistant answers
    const exchanges: string[] = [];
    for (let j = 0; j < nonSystemMessages.length; j++) {
      const msg = nonSystemMessages[j];
      if (msg.role === 'user') {
        const question = msg.content.slice(0, 200).trim();
        // Look for the next assistant response
        const next = nonSystemMessages[j + 1];
        if (next && next.role === 'assistant' && next.content) {
          const answer = next.content.slice(0, 300).trim();
          exchanges.push(`  Q: ${question}\n  A: ${answer}${next.content.length > 300 ? '...' : ''}`);
        } else {
          exchanges.push(`  Q: ${question}`);
        }
      }
    }

    // Use first user message as topic if the node title is generic
    const firstUserMsg = nonSystemMessages.find((m) => m.role === 'user');
    const effectiveTopic = firstUserMsg
      ? firstUserMsg.content.slice(0, 100).trim()
      : p.topic;

    const digest = exchanges.length > 0
      ? `\n${exchanges.slice(0, 5).join('\n')}`
      : '\n  (no messages yet)';

    return `--- Conversation ${i + 1}: "${effectiveTopic}" ---${digest}`;
  });

  return `You are a knowledgeable assistant synthesizing insights from multiple conversations. The user has selected these conversations to merge:

${parentSummaries.join('\n\n')}

The user's intent: "${action}"

Use the full context from all conversations above to synthesize, compare, correlate, or combine information as directed. Provide clear, well-structured responses using markdown formatting when appropriate.`;
}

export function getBranchSystemPrompt(
  parentTopic: string,
  parentMessages: Array<{ role: string; content: string }>
): string {
  const userQuestions = parentMessages
    .filter((m) => m.role === 'user')
    .map((m) => m.content.slice(0, 60).trim());

  // Use the first user message as the topic if the node title is generic
  const effectiveTopic = userQuestions.length > 0
    ? userQuestions[0]
    : parentTopic;

  const summary = userQuestions.length > 1
    ? `${effectiveTopic} (also discussed: ${userQuestions.slice(1, 4).join('; ')})`
    : effectiveTopic;

  return `You are a knowledgeable assistant. Branched from a conversation about: ${summary}. Provide clear, well-structured responses using markdown formatting when appropriate.`;
}
