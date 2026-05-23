import axios, { AxiosError, AxiosInstance } from 'axios';

export const createApiClient = (): AxiosInstance => {
  const client = axios.create({
    baseURL: window.location.origin,
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Response interceptor for error handling
  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      if (error.response?.status === 401) {
        // Handle unauthorized
        console.error('Unauthorized');
      } else if (error.response?.status === 503) {
        console.error('Service unavailable');
      }
      return Promise.reject(error);
    }
  );

  return client;
};

export const apiClient = createApiClient();

// Utility functions for common API calls
export const api = {
  // Security endpoints
  security: {
    getCameras: () => apiClient.get('/api/security/cameras'),
    getSnapshot: (cameraId: string) =>
      apiClient.get(`/api/security/snapshot/${cameraId}`, { responseType: 'blob' }),
    getEvents: (limit = 50, offset = 0) =>
      apiClient.get('/api/security/events', { params: { limit, offset } }),
    armSystem: (systemId: string, state: boolean) =>
      apiClient.post('/api/security/arm', { system_id: systemId, state }),
  },

  // Home Assistant endpoints
  homeassistant: {
    getDevices: () => apiClient.get('/api/ha/devices'),
    controlLight: (entityId: string, state: boolean, brightness?: number, color?: any) =>
      apiClient.post(`/api/ha/light/${entityId}`, { state, brightness, color }),
    controlSwitch: (entityId: string, state: boolean) =>
      apiClient.post(`/api/ha/switch/${entityId}`, { state }),
    activateScene: (sceneId: string) =>
      apiClient.post(`/api/ha/scene/${sceneId}`, {}),
  },

  // Notes endpoints
  notes: {
    list: () => apiClient.get('/api/notes'),
    get: (noteId: string) => apiClient.get(`/api/notes/${noteId}`),
    create: (data: any) => apiClient.post('/api/notes', data),
    update: (noteId: string, data: any) => apiClient.put(`/api/notes/${noteId}`, data),
    delete: (noteId: string) => apiClient.delete(`/api/notes/${noteId}`),
    export: (noteId: string) => apiClient.get(`/api/notes/${noteId}/export`),
  },

  // AI endpoints
  ai: {
    generateTitle: (noteId: string, content: string) =>
      apiClient.post('/api/ai/generate-title', { note_id: noteId, content }),
    generateKeyPoints: (noteId: string, content: string) =>
      apiClient.post('/api/ai/generate-key-points', { note_id: noteId, content }),
    search: (query: string) =>
      apiClient.get('/api/ai/search/semantic', { params: { query } }),
  },

  // Cluster endpoints
  cluster: {
    status: () => apiClient.get('/api/cluster/status'),
    routeInfo: () => apiClient.get('/api/cluster/route-info'),
    pullModel: (modelName: string, node?: string) =>
      apiClient.post(`/api/cluster/pull/${modelName}`, {}, { params: node ? { node } : {} }),
    setRoute: (type: 'llm' | 'embeddings', targetNode: string) =>
      apiClient.post('/api/cluster/route', { type, target_node: targetNode }),
  },

  // Health check
  health: () => apiClient.get('/health'),
};

export default apiClient;
