import { create } from 'zustand';
import type { Project, Character } from '@/types';
import * as projectRepo from '@/db/repositories/projectRepo';
import * as characterRepo from '@/db/repositories/characterRepo';

interface ProjectStore {
  projects: Project[];
  currentProject: Project | null;
  characters: Character[];
  isLoading: boolean;

  loadProjects: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  createProject: (data: Pick<Project, 'title' | 'type'>) => Promise<Project>;
  updateProject: (id: string, data: Partial<Pick<Project, 'title' | 'type'>>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  loadCharacters: (projectId: string) => Promise<void>;
  createCharacter: (data: Omit<Character, 'id'>) => Promise<Character>;
  updateCharacter: (id: string, data: Partial<Omit<Character, 'id' | 'projectId'>>) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  setActorCharacter: (projectId: string, characterId: string) => Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  currentProject: null,
  characters: [],
  isLoading: false,

  loadProjects: async () => {
    set({ isLoading: true });
    const projects = await projectRepo.getAllProjects();
    set({ projects, isLoading: false });
  },

  loadProject: async (id: string) => {
    set({ isLoading: true });
    const project = await projectRepo.getProjectById(id);
    const characters = project
      ? await characterRepo.getCharactersByProject(id)
      : [];
    set({ currentProject: project, characters, isLoading: false });
  },

  createProject: async (data) => {
    const project = await projectRepo.createProject({ ...data, coverImage: undefined });
    set((state) => ({ projects: [project, ...state.projects] }));
    return project;
  },

  updateProject: async (id, data) => {
    await projectRepo.updateProject(id, data);
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...data, updatedAt: new Date() } : p
      ),
      currentProject:
        state.currentProject?.id === id
          ? { ...state.currentProject, ...data, updatedAt: new Date() }
          : state.currentProject,
    }));
  },

  deleteProject: async (id) => {
    await projectRepo.deleteProject(id);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      currentProject: state.currentProject?.id === id ? null : state.currentProject,
    }));
  },

  loadCharacters: async (projectId) => {
    const characters = await characterRepo.getCharactersByProject(projectId);
    set({ characters });
  },

  createCharacter: async (data) => {
    const character = await characterRepo.createCharacter(data);
    set((state) => ({ characters: [...state.characters, character] }));
    return character;
  },

  updateCharacter: async (id, data) => {
    await characterRepo.updateCharacter(id, data);
    set((state) => ({
      characters: state.characters.map((c) =>
        c.id === id ? { ...c, ...data } : c
      ),
    }));
  },

  deleteCharacter: async (id) => {
    await characterRepo.deleteCharacter(id);
    set((state) => ({
      characters: state.characters.filter((c) => c.id !== id),
    }));
  },

  setActorCharacter: async (projectId, characterId) => {
    await characterRepo.setActorCharacter(projectId, characterId);
    set((state) => ({
      characters: state.characters.map((c) => ({
        ...c,
        isActor: c.id === characterId,
      })),
    }));
  },
}));
