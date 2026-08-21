import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspaceMetadata } from '../types/workspace';

interface WorkspaceState {
  workspaces: WorkspaceMetadata[];
  activeWorkspaceId: string | null;
  createWorkspace: (name?: string) => string;
  switchWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string, replacementName?: string) => void;
  setDefaultAgentModel: (id: string, modelId?: string) => void;
  getActiveWorkspace: () => WorkspaceMetadata | undefined;
}

/**
 * `crypto.randomUUID()` is unavailable in some browsers when MeshCLI is opened
 * from a LAN/non-secure HTTP origin. Keep workspace IDs UUID-shaped for
 * LangGraph, but generate them without depending on that API.
 */
function createWorkspaceId(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      activeWorkspaceId: null,

      createWorkspace: (name?: string) => {
        const id = createWorkspaceId();
        const now = Date.now();
        const metadata: WorkspaceMetadata = {
          id,
          name: name ?? 'New Workspace',
          createdAt: now,
          updatedAt: now,
        };
        set({
          workspaces: [...get().workspaces, metadata],
          activeWorkspaceId: id,
        });
        return id;
      },

      switchWorkspace: (id: string) => {
        if (get().workspaces.some((w) => w.id === id)) {
          set({ activeWorkspaceId: id });
        }
      },

      renameWorkspace: (id: string, name: string) => {
        set({
          workspaces: get().workspaces.map((w) =>
            w.id === id ? { ...w, name, updatedAt: Date.now() } : w
          ),
        });
      },

      deleteWorkspace: (id: string, replacementName?: string) => {
        const { workspaces, activeWorkspaceId } = get();
        const remaining = workspaces.filter((w) => w.id !== id);

        // Remove the workspace data from localStorage
        localStorage.removeItem(`caudalflow-workspace-${id}`);

        if (remaining.length === 0) {
          // No workspaces left — create a new default
          const newId = createWorkspaceId();
          const now = Date.now();
          set({
            workspaces: [{ id: newId, name: replacementName ?? 'My Workspace', createdAt: now, updatedAt: now }],
            activeWorkspaceId: newId,
          });
        } else {
          set({
            workspaces: remaining,
            activeWorkspaceId:
              activeWorkspaceId === id ? remaining[0].id : activeWorkspaceId,
          });
        }
      },

      setDefaultAgentModel: (id: string, modelId?: string) => {
        set({
          workspaces: get().workspaces.map((workspace) => workspace.id === id
            ? { ...workspace, defaultAgentModelId: modelId, updatedAt: Date.now() }
            : workspace),
        });
      },

      getActiveWorkspace: () => {
        const { workspaces, activeWorkspaceId } = get();
        return workspaces.find((w) => w.id === activeWorkspaceId);
      },
    }),
    {
      name: 'caudalflow-workspaces',
      partialize: (state) => ({
        workspaces: state.workspaces,
        activeWorkspaceId: state.activeWorkspaceId,
      }),
      // Migrate nanoid workspace IDs → UUID so LangGraph accepts them as threadIds
      migrate: (persisted: unknown) => {
        const state = persisted as { workspaces: WorkspaceMetadata[]; activeWorkspaceId: string | null };
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (state.workspaces?.some((w) => !UUID_RE.test(w.id))) {
          // Reset to fresh state — old nanoid workspaces can't be migrated cleanly
          return { workspaces: [], activeWorkspaceId: null };
        }
        return state;
      },
      version: 2,
    }
  )
);
