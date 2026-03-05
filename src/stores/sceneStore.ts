import { create } from 'zustand';
import type { Scene, Line } from '@/types';
import * as sceneRepo from '@/db/repositories/sceneRepo';
import * as lineRepo from '@/db/repositories/lineRepo';

interface SceneStore {
  scenes: Scene[];
  currentScene: Scene | null;
  lines: Line[];
  isLoading: boolean;

  loadScenes: (projectId: string) => Promise<void>;
  loadScene: (id: string) => Promise<void>;
  createScene: (data: Pick<Scene, 'projectId' | 'sceneNumber' | 'title' | 'sortOrder'>) => Promise<Scene>;
  updateScene: (id: string, data: Partial<Pick<Scene, 'title' | 'sceneNumber' | 'masteryStatus'>>) => Promise<void>;
  deleteScene: (id: string) => Promise<void>;

  loadLines: (sceneId: string) => Promise<void>;
  createLine: (data: Omit<Line, 'id'>) => Promise<Line>;
  updateLine: (id: string, data: Partial<Pick<Line, 'text' | 'isStageDirection' | 'characterId'>>) => Promise<void>;
  deleteLine: (id: string) => Promise<void>;
}

export const useSceneStore = create<SceneStore>((set, get) => ({
  scenes: [],
  currentScene: null,
  lines: [],
  isLoading: false,

  loadScenes: async (projectId) => {
    set({ isLoading: true });
    const scenes = await sceneRepo.getScenesByProject(projectId);
    set({ scenes, isLoading: false });
  },

  loadScene: async (id) => {
    set({ isLoading: true });
    const scene = await sceneRepo.getSceneById(id);
    const lines = scene ? await lineRepo.getLinesByScene(id) : [];
    set({ currentScene: scene, lines, isLoading: false });
  },

  createScene: async (data) => {
    const scene = await sceneRepo.createScene(data);
    set((state) => ({ scenes: [...state.scenes, scene] }));
    return scene;
  },

  updateScene: async (id, data) => {
    await sceneRepo.updateScene(id, data);
    set((state) => ({
      scenes: state.scenes.map((s) => (s.id === id ? { ...s, ...data } : s)),
      currentScene:
        state.currentScene?.id === id
          ? { ...state.currentScene, ...data }
          : state.currentScene,
    }));
  },

  deleteScene: async (id) => {
    await sceneRepo.deleteScene(id);
    set((state) => ({
      scenes: state.scenes.filter((s) => s.id !== id),
      currentScene: state.currentScene?.id === id ? null : state.currentScene,
    }));
  },

  loadLines: async (sceneId) => {
    const lines = await lineRepo.getLinesByScene(sceneId);
    set({ lines });
  },

  createLine: async (data) => {
    const line = await lineRepo.createLine(data);
    set((state) => ({ lines: [...state.lines, line] }));
    return line;
  },

  updateLine: async (id, data) => {
    await lineRepo.updateLine(id, data);
    set((state) => ({
      lines: state.lines.map((l) => (l.id === id ? { ...l, ...data } : l)),
    }));
  },

  deleteLine: async (id) => {
    await lineRepo.deleteLine(id);
    set((state) => ({ lines: state.lines.filter((l) => l.id !== id) }));
  },
}));
