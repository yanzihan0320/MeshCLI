import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '../chatStore';

beforeEach(() => {
  useChatStore.setState({ conversations: {}, activeNodeContext: null });
});

describe('chatStore', () => {
  describe('initConversation', () => {
    it('creates an empty conversation for a node', () => {
      useChatStore.getState().initConversation('node-1');
      const conv = useChatStore.getState().conversations['node-1'];
      expect(conv).toBeDefined();
      expect(conv.nodeId).toBe('node-1');
      expect(conv.messages).toEqual([]);
      expect(conv.isStreaming).toBe(false);
    });

    it('does not overwrite an existing conversation', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().addMessage('node-1', 'user', 'Hello');
      useChatStore.getState().initConversation('node-1'); // should be a no-op
      expect(useChatStore.getState().conversations['node-1'].messages).toHaveLength(1);
    });
  });

  describe('addMessage', () => {
    it('adds a message with correct role and content', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().addMessage('node-1', 'user', 'Hello');
      const messages = useChatStore.getState().getMessages('node-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello');
      expect(messages[0].id).toBeTruthy();
      expect(messages[0].timestamp).toBeGreaterThan(0);
    });

    it('returns the message id', () => {
      useChatStore.getState().initConversation('node-1');
      const id = useChatStore.getState().addMessage('node-1', 'assistant', 'Hi there');
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('appends to existing messages in order', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().addMessage('node-1', 'user', 'First');
      useChatStore.getState().addMessage('node-1', 'assistant', 'Second');
      useChatStore.getState().addMessage('node-1', 'user', 'Third');
      const messages = useChatStore.getState().getMessages('node-1');
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Third');
    });

    it('returns id but does not add message for non-existent conversation', () => {
      const id = useChatStore.getState().addMessage('non-existent', 'user', 'Hello');
      expect(typeof id).toBe('string');
      expect(useChatStore.getState().getMessages('non-existent')).toEqual([]);
    });
  });

  describe('appendToLastMessage', () => {
    it('appends a chunk to the last message content', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().addMessage('node-1', 'assistant', 'Hello');
      useChatStore.getState().appendToLastMessage('node-1', ' world');
      const messages = useChatStore.getState().getMessages('node-1');
      expect(messages[0].content).toBe('Hello world');
    });

    it('appends multiple chunks sequentially', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().addMessage('node-1', 'assistant', '');
      useChatStore.getState().appendToLastMessage('node-1', 'chunk1');
      useChatStore.getState().appendToLastMessage('node-1', ' chunk2');
      useChatStore.getState().appendToLastMessage('node-1', ' chunk3');
      const messages = useChatStore.getState().getMessages('node-1');
      expect(messages[0].content).toBe('chunk1 chunk2 chunk3');
    });

    it('does nothing for non-existent conversation', () => {
      // Should not throw
      useChatStore.getState().appendToLastMessage('non-existent', 'chunk');
    });

    it('does nothing for empty conversation', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().appendToLastMessage('node-1', 'chunk');
      expect(useChatStore.getState().getMessages('node-1')).toHaveLength(0);
    });
  });

  describe('setStreaming', () => {
    it('sets streaming flag to true', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().setStreaming('node-1', true);
      expect(useChatStore.getState().conversations['node-1'].isStreaming).toBe(true);
    });

    it('sets streaming flag to false', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().setStreaming('node-1', true);
      useChatStore.getState().setStreaming('node-1', false);
      expect(useChatStore.getState().conversations['node-1'].isStreaming).toBe(false);
    });

    it('does nothing for non-existent conversation', () => {
      useChatStore.getState().setStreaming('non-existent', true);
      expect(useChatStore.getState().conversations['non-existent']).toBeUndefined();
    });
  });

  describe('getMessages', () => {
    it('returns empty array for non-existent conversation', () => {
      expect(useChatStore.getState().getMessages('non-existent')).toEqual([]);
    });

    it('returns messages for an existing conversation', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().addMessage('node-1', 'user', 'Hello');
      const messages = useChatStore.getState().getMessages('node-1');
      expect(messages).toHaveLength(1);
    });
  });

  describe('removeConversation', () => {
    it('removes the conversation for a node', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().initConversation('node-2');
      useChatStore.getState().addMessage('node-1', 'user', 'Hello');
      useChatStore.getState().removeConversation('node-1');
      expect(useChatStore.getState().conversations['node-1']).toBeUndefined();
      expect(useChatStore.getState().conversations['node-2']).toBeDefined();
    });

    it('does nothing for non-existent conversation', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().removeConversation('non-existent');
      expect(useChatStore.getState().conversations['node-1']).toBeDefined();
    });
  });

  describe('setConversations', () => {
    it('replaces all conversations', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().addMessage('node-1', 'user', 'Hello');

      useChatStore.getState().setConversations({
        'node-2': { nodeId: 'node-2', messages: [], isStreaming: false },
      });

      expect(useChatStore.getState().conversations['node-1']).toBeUndefined();
      expect(useChatStore.getState().conversations['node-2']).toBeDefined();
    });
  });

  describe('setActiveNodeContext', () => {
    it('sets a root context', () => {
      useChatStore.getState().setActiveNodeContext({
        nodeId: 'node-1',
        mode: 'root',
        topic: 'Root topic',
      });
      const ctx = useChatStore.getState().activeNodeContext;
      expect(ctx).toMatchObject({ nodeId: 'node-1', mode: 'root', topic: 'Root topic' });
    });

    it('sets a merge context with mergeAction', () => {
      useChatStore.getState().setActiveNodeContext({
        nodeId: 'node-2',
        mode: 'merge',
        topic: 'Merge',
        mergeAction: 'synthesize',
      });
      const ctx = useChatStore.getState().activeNodeContext;
      expect(ctx).toMatchObject({ mode: 'merge', mergeAction: 'synthesize' });
    });

    it('sets a branch context', () => {
      useChatStore.getState().setActiveNodeContext({
        nodeId: 'node-3',
        mode: 'branch',
        topic: 'Deep dive',
      });
      expect(useChatStore.getState().activeNodeContext?.mode).toBe('branch');
    });

    it('clears context with null without affecting conversations', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().addMessage('node-1', 'user', 'Hello');
      useChatStore.getState().setActiveNodeContext({
        nodeId: 'node-1',
        mode: 'root',
        topic: 'Topic',
      });
      useChatStore.getState().setActiveNodeContext(null);
      expect(useChatStore.getState().activeNodeContext).toBeNull();
      expect(useChatStore.getState().conversations['node-1'].messages).toHaveLength(1);
    });
  });

  describe('setConversationMessages', () => {
    it('replaces messages for an existing conversation', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().addMessage('node-1', 'user', 'Old message');
      const newMessages = [
        { id: 'msg-1', role: 'user' as const, content: 'New message', timestamp: 1000 },
      ];
      useChatStore.getState().setConversationMessages('node-1', newMessages);
      const messages = useChatStore.getState().getMessages('node-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('New message');
    });

    it('sets messages to an empty array', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().addMessage('node-1', 'user', 'Hello');
      useChatStore.getState().setConversationMessages('node-1', []);
      expect(useChatStore.getState().getMessages('node-1')).toHaveLength(0);
    });

    it('no-ops for a non-existent conversation', () => {
      const newMessages = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello', timestamp: 1000 },
      ];
      useChatStore.getState().setConversationMessages('missing', newMessages);
      expect(useChatStore.getState().conversations['missing']).toBeUndefined();
    });

    it('preserves isStreaming flag', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().setStreaming('node-1', true);
      const newMessages = [
        { id: 'msg-1', role: 'assistant' as const, content: 'Streaming...', timestamp: 1000 },
      ];
      useChatStore.getState().setConversationMessages('node-1', newMessages);
      expect(useChatStore.getState().conversations['node-1'].isStreaming).toBe(true);
    });

    it('does not affect other conversations', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().initConversation('node-2');
      useChatStore.getState().addMessage('node-1', 'user', 'Keep me');
      useChatStore.getState().addMessage('node-2', 'user', 'Original');
      useChatStore.getState().setConversationMessages('node-2', []);
      expect(useChatStore.getState().getMessages('node-1')).toHaveLength(1);
      expect(useChatStore.getState().getMessages('node-1')[0].content).toBe('Keep me');
    });
  });

  describe('addOrUpdateMessage', () => {
    it('appends a new message by id', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().addOrUpdateMessage('node-1', {
        id: 'msg-new',
        role: 'user',
        content: 'Hello',
        timestamp: 1000,
      });
      const messages = useChatStore.getState().getMessages('node-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('msg-new');
    });

    it('updates an existing message in-place', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().addOrUpdateMessage('node-1', {
        id: 'msg-1',
        role: 'assistant',
        content: 'First version',
        timestamp: 1000,
      });
      useChatStore.getState().addOrUpdateMessage('node-1', {
        id: 'msg-1',
        role: 'assistant',
        content: 'Updated version',
        timestamp: 2000,
      });
      const messages = useChatStore.getState().getMessages('node-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Updated version');
    });

    it('preserves other messages when appending or updating', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().addMessage('node-1', 'user', 'Existing');
      useChatStore.getState().addOrUpdateMessage('node-1', {
        id: 'msg-new',
        role: 'assistant',
        content: 'New reply',
        timestamp: 1000,
      });
      const messages = useChatStore.getState().getMessages('node-1');
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('Existing');
      expect(messages[1].content).toBe('New reply');
    });

    it('no-ops for a non-existent conversation', () => {
      useChatStore.getState().addOrUpdateMessage('missing', {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: 1000,
      });
      expect(useChatStore.getState().conversations['missing']).toBeUndefined();
    });

    it('merges properties and preserves triggeredBy on update', () => {
      useChatStore.getState().initConversation('node-1');
      useChatStore.getState().addOrUpdateMessage('node-1', {
        id: 'msg-1',
        role: 'assistant',
        content: 'Original',
        timestamp: 1000,
        triggeredBy: 'node-2',
      });
      useChatStore.getState().addOrUpdateMessage('node-1', {
        id: 'msg-1',
        role: 'assistant',
        content: 'Updated',
        timestamp: 2000,
      });
      const msg = useChatStore.getState().getMessages('node-1')[0];
      expect(msg.content).toBe('Updated');
      expect(msg.triggeredBy).toBe('node-2');
    });
  });
});
