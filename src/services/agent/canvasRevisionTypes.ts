import type { useChatStore } from '../../stores/chatStore';
import type { useFlowStore } from '../../stores/flowStore';

export type FlowStateSnapshot = ReturnType<typeof useFlowStore.getState>;
export type ChatStateSnapshot = ReturnType<typeof useChatStore.getState>;
