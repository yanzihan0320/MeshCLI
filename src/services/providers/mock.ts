import type { LLMProvider, StreamCallbacks } from './types';
import type { ChatMessage, LLMConfig } from '../../types/chat';

const MOCK_RESPONSES: Record<string, string[]> = {
  default: [
    "That's a fascinating topic! Let me share what I know.\n\n## Key Points\n\n1. **Foundational concepts** — Understanding the basics is crucial before diving deeper into the subject.\n\n2. **Interconnections** — This area connects to several other fields, creating a rich web of knowledge.\n\n3. **Practical applications** — The real-world implications are quite significant.\n\n### Going Deeper\n\nThere are several important aspects to consider:\n\n- The historical development has shaped current understanding\n- Recent discoveries have changed how we think about this\n- There are still open questions worth exploring\n\n> \"The important thing is not to stop questioning. Curiosity has its own reason for existing.\" — Albert Einstein\n\nWould you like to explore any specific aspect in more detail?",

    "Great question! Here's a comprehensive overview.\n\n## Overview\n\nThis subject has **multiple layers** worth understanding:\n\n### The Basics\n\nAt its core, this involves understanding how different components interact with each other. Think of it like a complex system where:\n\n- Each part has a specific role\n- The interactions between parts create emergent behavior\n- Small changes can have significant effects\n\n### Advanced Concepts\n\n```\nInput → Processing → Output\n  ↑                    |\n  └────Feedback────────┘\n```\n\nThe feedback loop is what makes this truly interesting. It enables **self-regulation** and **adaptation**.\n\n### Why It Matters\n\nUnderstanding this helps us:\n1. Make better predictions\n2. Design better systems\n3. Solve complex problems\n\nWhat specific aspect would you like to dive into?",

    "Excellent topic to explore! Let me break this down.\n\n## Background\n\nThis area of knowledge has evolved significantly over the past few decades. Here are the **key milestones**:\n\n| Period | Development | Impact |\n|--------|------------|--------|\n| Early | Foundation theories | Set the groundwork |\n| Middle | Experimental validation | Proved core concepts |\n| Recent | Modern applications | Practical breakthroughs |\n\n### Current Understanding\n\nThe modern view integrates multiple perspectives:\n\n- **Structural** — How things are organized\n- **Functional** — How things work\n- **Dynamic** — How things change over time\n\n### Open Questions\n\nSome fascinating unresolved questions include:\n\n1. How do these systems scale?\n2. What are the fundamental limits?\n3. Can we create artificial versions?\n\nEach of these questions opens up entirely new avenues of exploration. Feel free to select any concept to branch into a deeper discussion!",
  ],
};

function getResponseForTopic(messages: ChatMessage[]): string {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');

  const topic =
    lastUserMsg?.content ||
    (lastUserMsg?.images && lastUserMsg.images.length > 0
      ? 'image'
      : '');

  const responses = MOCK_RESPONSES.default;
  const hash = topic.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return responses[hash % responses.length];
}

export const MockProvider: LLMProvider = {
  id: 'mock',
  name: 'Mock (Development)',
  supportsVision: false,

  streamChat(
    messages: ChatMessage[],
    config: LLMConfig,
    callbacks: StreamCallbacks,
    signal: AbortSignal
  ) {
    const response = getResponseForTopic(messages);
    const delay = config.mockDelay || 30;
    let index = 0;

    const tick = () => {
      if (signal.aborted) return;
      if (index >= response.length) {
        callbacks.onDone();
        return;
      }
      const chunkSize = Math.floor(Math.random() * 3) + 1;
      const chunk = response.slice(index, index + chunkSize);
      index += chunkSize;
      callbacks.onToken(chunk);
      setTimeout(tick, delay + Math.random() * delay);
    };

    setTimeout(tick, 300);
  },
};