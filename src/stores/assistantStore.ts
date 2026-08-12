import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CanvasCommand, WorkspaceAssistantEvent } from '../../packages/protocol/src/assistant';

export interface AssistantChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface WorkspaceAssistantState {
  threadId: string;
  revision: number;
  messages: AssistantChatMessage[];
  activity: WorkspaceAssistantEvent[];
  pendingCommand?: CanvasCommand;
  running: boolean;
  usedSkills: string[];
}

interface AssistantState {
  workspaces: Record<string, WorkspaceAssistantState>;
  ensureWorkspace: (workspaceId: string) => WorkspaceAssistantState;
  appendMessage: (workspaceId: string, message: AssistantChatMessage) => void;
  appendAssistantDelta: (workspaceId: string, delta: string) => void;
  appendActivity: (workspaceId: string, event: WorkspaceAssistantEvent) => void;
  setRunning: (workspaceId: string, running: boolean) => void;
  setPendingCommand: (workspaceId: string, command?: CanvasCommand) => void;
  setRevision: (workspaceId: string, revision: number) => void;
  setUsedSkills: (workspaceId: string, skills: string[]) => void;
  removeWorkspace: (workspaceId: string) => void;
}

function createWorkspaceState(): WorkspaceAssistantState {
  return {
    threadId: crypto.randomUUID(),
    revision: 0,
    messages: [],
    activity: [],
    running: false,
    usedSkills: [],
  };
}

const MAX_ACTIVITY = 500;
const MAX_MESSAGES = 200;

export const useAssistantStore = create<AssistantState>()(
  persist(
    (set, get) => ({
      workspaces: {},
      ensureWorkspace: (workspaceId) => {
        const existing = get().workspaces[workspaceId];
        if (existing) return existing;
        const created = createWorkspaceState();
        set({ workspaces: { ...get().workspaces, [workspaceId]: created } });
        return created;
      },
      appendMessage: (workspaceId, message) => set((state) => {
        const workspace = state.workspaces[workspaceId] ?? createWorkspaceState();
        return {
          workspaces: {
            ...state.workspaces,
            [workspaceId]: { ...workspace, messages: [...workspace.messages, message].slice(-MAX_MESSAGES) },
          },
        };
      }),
      appendAssistantDelta: (workspaceId, delta) => set((state) => {
        const workspace = state.workspaces[workspaceId] ?? createWorkspaceState();
        const messages = [...workspace.messages];
        const last = messages.at(-1);
        if (last?.role === 'assistant') {
          messages[messages.length - 1] = { ...last, content: last.content + delta };
        } else {
          messages.push({ id: crypto.randomUUID(), role: 'assistant', content: delta, timestamp: Date.now() });
        }
        return { workspaces: { ...state.workspaces, [workspaceId]: { ...workspace, messages } } };
      }),
      appendActivity: (workspaceId, event) => set((state) => {
        const workspace = state.workspaces[workspaceId] ?? createWorkspaceState();
        return {
          workspaces: {
            ...state.workspaces,
            [workspaceId]: { ...workspace, activity: [...workspace.activity, event].slice(-MAX_ACTIVITY) },
          },
        };
      }),
      setRunning: (workspaceId, running) => set((state) => {
        const workspace = state.workspaces[workspaceId] ?? createWorkspaceState();
        return { workspaces: { ...state.workspaces, [workspaceId]: { ...workspace, running } } };
      }),
      setPendingCommand: (workspaceId, pendingCommand) => set((state) => {
        const workspace = state.workspaces[workspaceId] ?? createWorkspaceState();
        return { workspaces: { ...state.workspaces, [workspaceId]: { ...workspace, pendingCommand } } };
      }),
      setRevision: (workspaceId, revision) => set((state) => {
        const workspace = state.workspaces[workspaceId] ?? createWorkspaceState();
        return { workspaces: { ...state.workspaces, [workspaceId]: { ...workspace, revision } } };
      }),
      setUsedSkills: (workspaceId, usedSkills) => set((state) => {
        const workspace = state.workspaces[workspaceId] ?? createWorkspaceState();
        return { workspaces: { ...state.workspaces, [workspaceId]: { ...workspace, usedSkills } } };
      }),
      removeWorkspace: (workspaceId) => set((state) => {
        const { [workspaceId]: _, ...workspaces } = state.workspaces;
        void _;
        return { workspaces };
      }),
    }),
    {
      name: 'meshcli-assistant-v1',
      partialize: (state) => ({ workspaces: state.workspaces }),
    },
  ),
);

