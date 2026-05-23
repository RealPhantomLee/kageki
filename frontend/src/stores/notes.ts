import { create } from 'zustand';
import { Note } from '../types/index';
import axios from 'axios';

interface NotesFilter {
  search?: string;
  tags?: string[];
}

interface NotesStore {
  // State
  notes: Note[];
  activeNoteId: string | null;
  filter: NotesFilter;
  loading: boolean;
  error: string | null;
  wsConnected: boolean;

  // Note management
  setNotes: (notes: Note[]) => void;
  addNote: (note: Note) => void;
  updateNote: (noteId: string, note: Partial<Note>) => void;
  deleteNote: (noteId: string) => void;
  setActiveNote: (noteId: string | null) => void;

  // Filtering and search
  setFilter: (filter: NotesFilter) => void;
  getFilteredNotes: () => Note[];
  getActiveNote: () => Note | undefined;

  // API operations
  createNote: (title: string, content: string) => Promise<Note>;
  saveNote: (noteId: string, data: Partial<Note>) => Promise<void>;
  removeNote: (noteId: string) => Promise<void>;
  loadNotes: () => Promise<void>;
  exportNote: (noteId: string) => Promise<string>;

  // AI operations
  generateTitle: (noteId: string, content: string) => Promise<string>;
  generateKeyPoints: (noteId: string, content: string) => Promise<string[]>;

  // Connection state
  setWsConnected: (connected: boolean) => void;

  // Loading & error
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  notes: [],
  activeNoteId: null,
  filter: {},
  loading: false,
  error: null,
  wsConnected: false,

  setNotes: (notes: Note[]) => {
    set({ notes });
  },

  addNote: (note: Note) => {
    set((state) => ({
      notes: [note, ...state.notes],
    }));
  },

  updateNote: (noteId: string, updates: Partial<Note>) => {
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === noteId ? { ...n, ...updates, updated_at: new Date().toISOString() } : n
      ),
    }));
  },

  deleteNote: (noteId: string) => {
    set((state) => ({
      notes: state.notes.filter((n) => n.id !== noteId),
      activeNoteId: state.activeNoteId === noteId ? null : state.activeNoteId,
    }));
  },

  setActiveNote: (noteId: string | null) => {
    set({ activeNoteId: noteId });
  },

  setFilter: (filter: NotesFilter) => {
    set({ filter });
  },

  getFilteredNotes: () => {
    const { notes, filter } = get();
    let filtered = notes;

    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      filtered = filtered.filter(
        (n) =>
          n.title.toLowerCase().includes(searchLower) ||
          n.content.toLowerCase().includes(searchLower)
      );
    }

    if (filter.tags && filter.tags.length > 0) {
      filtered = filtered.filter((n) =>
        filter.tags!.some((tag) => n.tags?.includes(tag))
      );
    }

    return filtered;
  },

  getActiveNote: () => {
    const { notes, activeNoteId } = get();
    return notes.find((n) => n.id === activeNoteId);
  },

  createNote: async (title: string, content: string) => {
    try {
      set({ loading: true, error: null });
      const response = await axios.post('/api/notes', {
        title,
        content,
      });
      const newNoteId = response.data.id;
      // Fetch the full note object from the backend
      const fullNoteResponse = await axios.get(`/api/notes/${newNoteId}`);
      const newNote = fullNoteResponse.data;
      get().addNote(newNote);
      get().setActiveNote(newNote.id);
      return newNote;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to create note';
      set({ error: errorMsg });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  saveNote: async (noteId: string, data: Partial<Note>) => {
    try {
      set({ error: null });
      await axios.put(`/api/notes/${noteId}`, data);
      get().updateNote(noteId, data);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to save note';
      set({ error: errorMsg });
      throw error;
    }
  },

  removeNote: async (noteId: string) => {
    try {
      set({ error: null });
      await axios.delete(`/api/notes/${noteId}`);
      get().deleteNote(noteId);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to delete note';
      set({ error: errorMsg });
      throw error;
    }
  },

  loadNotes: async () => {
    try {
      set({ loading: true, error: null });
      const response = await axios.get('/api/notes');
      const notes = response.data.notes || response.data;
      get().setNotes(notes);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to load notes';
      set({ error: errorMsg });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  exportNote: async (noteId: string) => {
    try {
      const response = await axios.get(`/api/notes/${noteId}/export`);
      return response.data.content || '';
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to export note';
      set({ error: errorMsg });
      throw error;
    }
  },

  generateTitle: async (noteId: string, content: string) => {
    try {
      const response = await axios.post(`/api/ai/notes/${noteId}/suggest-title`);
      const title = response.data.suggestions?.[0] || 'Untitled';
      get().updateNote(noteId, { title });
      return title;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to generate title';
      set({ error: errorMsg });
      throw error;
    }
  },

  generateKeyPoints: async (noteId: string, content: string) => {
    try {
      const response = await axios.post(`/api/ai/notes/${noteId}/key-points`);
      return response.data.key_points || [];
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to generate key points';
      set({ error: errorMsg });
      throw error;
    }
  },

  setWsConnected: (connected: boolean) => {
    set({ wsConnected: connected });
  },

  setLoading: (loading: boolean) => {
    set({ loading });
  },

  setError: (error: string | null) => {
    set({ error });
  },
}));
