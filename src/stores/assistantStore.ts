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
  historyStartIndex?: number;
  revision: number;
  messages: AssistantChatMessage[];
  activity: WorkspaceAssistantEvent[];
  pendingCommand?: CanvasCommand;
  running: boolean;
  usedSkills: string[];
}

export interface RetractedAssistantTurn {
  userMessageId: string;
  activity: WorkspaceAssistantEvent[];
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
  rotateThread: (workspaceId: string, failedThreadId: string) => void;
  retractLatestTurn: (workspaceId: string) => RetractedAssistantTurn | undefined;
  removeWorkspace: (workspaceId: string) => void;
}

function createWorkspaceState(): WorkspaceAssistantState {
  return {
    threadId: crypto.randomUUID(),
    historyStartIndex: 0,
    revision: 0,
    messages: [],
    activity: [],
    running: false,
    usedSkills: [],
  };
}

function recoverFailedThread(workspace: WorkspaceAssistantState): WorkspaceAssistantState {
  const terminal = [...workspace.activity].reverse()
    .find((event) => event.type === 'turn_failed' || event.type === 'turn_finished');
  if (terminal?.type !== 'turn_failed' || terminal.threadId !== workspace.threadId) return workspace;
  return {
    ...workspace,
    threadId: crypto.randomUUID(),
    historyStartIndex: workspace.messages.length,
    running: false,
    pendingCommand: undefined,
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
        if (existing) {
          const recovered = recoverFailedThread(existing);
          if (recovered !== existing) {
            set({ workspaces: { ...get().workspaces, [workspaceId]: recovered } });
          }
          return recovered;
        }
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
      rotateThread: (workspaceId, failedThreadId) => set((state) => {
        const workspace = state.workspaces[workspaceId] ?? createWorkspaceState();
        if (workspace.threadId !== failedThreadId) return state;
        return {
          workspaces: {
            ...state.workspaces,
            [workspaceId]: {
              ...workspace,
              threadId: crypto.randomUUID(),
              historyStartIndex: workspace.messages.length,
              running: false,
              pendingCommand: undefined,
            },
          },
        };
      }),
      retractLatestTurn: (workspaceId) => {
        const workspace = get().workspaces[workspaceId];
        if (!workspace) return undefined;
        const userMessageIndex = workspace.messages.findLastIndex((message) => message.role === 'user');
        if (userMessageIndex < 0) return undefined;
        const userMessage = workspace.messages[userMessageIndex];
        const turnStartIndex = workspace.activity.findLastIndex((event) => (
          event.type === 'turn_started' && event.timestamp >= userMessage.timestamp
        ));
        const activityStart = turnStartIndex >= 0 ? turnStartIndex : workspace.activity.length;
        const retainedActivity = workspace.activity.slice(0, activityStart);
        const retractedActivity = workspace.activity.slice(activityStart);
        const retainedSkills = [...new Set(retainedActivity
          .filter((event) => event.type === 'skill_activated')
          .map((event) => String(event.payload.name ?? ''))
          .filter(Boolean))];
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [workspaceId]: {
              ...workspace,
              threadId: crypto.randomUUID(),
              historyStartIndex: 0,
              messages: workspace.messages.slice(0, userMessageIndex),
              activity: retainedActivity,
              pendingCommand: undefined,
              running: false,
              usedSkills: retainedSkills,
            },
          },
        }));
        return { userMessageId: userMessage.id, activity: retractedActivity };
      },
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
