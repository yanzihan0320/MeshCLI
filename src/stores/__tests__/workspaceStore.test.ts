// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../workspaceStore';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
  localStorage.clear();
});

describe('workspaceStore', () => {
  describe('createWorkspace', () => {
    it('creates a workspace with default name', () => {
      useWorkspaceStore.getState().createWorkspace();
      const workspaces = useWorkspaceStore.getState().workspaces;
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].name).toBe('New Workspace');
    });

    it('creates a workspace with a custom name', () => {
      useWorkspaceStore.getState().createWorkspace('Research Map');
      const workspaces = useWorkspaceStore.getState().workspaces;
      expect(workspaces[0].name).toBe('Research Map');
    });

    it('returns a valid UUID', () => {
      const id = useWorkspaceStore.getState().createWorkspace();
      expect(id).toMatch(UUID_RE);
    });

    it('sets the new workspace as active', () => {
      const id = useWorkspaceStore.getState().createWorkspace('Active Test');
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(id);
    });
  });

  describe('switchWorkspace', () => {
    it('switches to an existing workspace', () => {
      const firstId = useWorkspaceStore.getState().createWorkspace('First');
      const secondId = useWorkspaceStore.getState().createWorkspace('Second');
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(secondId);
      useWorkspaceStore.getState().switchWorkspace(firstId);
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(firstId);
    });

    it('no-ops for a non-existent workspace id', () => {
      const id = useWorkspaceStore.getState().createWorkspace('Only');
      useWorkspaceStore.getState().switchWorkspace('non-existent');
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(id);
    });
  });

  describe('renameWorkspace', () => {
    it('renames an existing workspace', () => {
      const id = useWorkspaceStore.getState().createWorkspace('Old Name');
      useWorkspaceStore.getState().renameWorkspace(id, 'New Name');
      expect(useWorkspaceStore.getState().workspaces[0].name).toBe('New Name');
    });

    it('updates the updatedAt timestamp', () => {
      const id = useWorkspaceStore.getState().createWorkspace('Original');
      const before = useWorkspaceStore.getState().workspaces[0].updatedAt;
      // Small delay so Date.now() differs
      useWorkspaceStore.getState().renameWorkspace(id, 'Renamed');
      const after = useWorkspaceStore.getState().workspaces[0].updatedAt;
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it('no-ops for a non-existent workspace id', () => {
      useWorkspaceStore.getState().createWorkspace('Keep');
      useWorkspaceStore.getState().renameWorkspace('bad-id', 'Nope');
      expect(useWorkspaceStore.getState().workspaces[0].name).toBe('Keep');
    });
  });

  describe('deleteWorkspace', () => {
    it('removes a workspace from the list', () => {
      const firstId = useWorkspaceStore.getState().createWorkspace('First');
      useWorkspaceStore.getState().createWorkspace('Second');
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
      useWorkspaceStore.getState().deleteWorkspace(firstId);
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
      expect(useWorkspaceStore.getState().workspaces[0].name).toBe('Second');
    });

    it('reassigns active workspace when the active one is deleted', () => {
      useWorkspaceStore.getState().createWorkspace('First');
      const secondId = useWorkspaceStore.getState().createWorkspace('Second');
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(secondId);
      useWorkspaceStore.getState().deleteWorkspace(secondId);
      expect(useWorkspaceStore.getState().activeWorkspaceId).not.toBe(secondId);
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    });

    it('creates a default workspace when the last one is deleted', () => {
      const id = useWorkspaceStore.getState().createWorkspace('Only');
      useWorkspaceStore.getState().deleteWorkspace(id);
      const workspaces = useWorkspaceStore.getState().workspaces;
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].name).toBe('My Workspace');
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(workspaces[0].id);
    });

    it('removes workspace data from localStorage', () => {
      const id = useWorkspaceStore.getState().createWorkspace('Temp');
      localStorage.setItem(`caudalflow-workspace-${id}`, JSON.stringify({ data: true }));
      useWorkspaceStore.getState().deleteWorkspace(id);
      expect(localStorage.getItem(`caudalflow-workspace-${id}`)).toBeNull();
    });
  });

  describe('getActiveWorkspace', () => {
    it('returns the active workspace metadata', () => {
      const id = useWorkspaceStore.getState().createWorkspace('Active');
      const active = useWorkspaceStore.getState().getActiveWorkspace();
      expect(active).toBeDefined();
      expect(active?.id).toBe(id);
      expect(active?.name).toBe('Active');
    });

    it('returns undefined when there are no workspaces', () => {
      const active = useWorkspaceStore.getState().getActiveWorkspace();
      expect(active).toBeUndefined();
    });
  });
});
