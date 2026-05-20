/**
 * TypeScript types for Phantom Portal
 * Interfaces match backend API responses
 */

// Notes/VaultKeeper types
export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  ai_summary?: string;
  ai_summary_generated_at?: string;
  tags?: string[];
}

// Security/Blink types
export interface SecurityEvent {
  id: string;
  timestamp: string;
  camera_id: string;
  confidence: number;
  thumbnail_url?: string;
  narration?: string;
  created_at: string;
}

export interface Camera {
  id: string;
  name: string;
  enabled: boolean;
  status?: 'online' | 'offline' | 'recording';
  thumbnail_url?: string;
  last_motion?: string;
}

export interface BlinkSystem {
  id: string;
  name: string;
  armed: boolean;
}

// Home Assistant types
export interface HomeAssistantDevice {
  entity_id: string;
  name: string;
  type: string;
  state: string;
  attributes?: Record<string, any>;
  brightness?: number;
  color?: { r: number; g: number; b: number };
}

export interface Scene {
  id: string;
  name: string;
  description?: string;
}

export interface SemanticSearchResult {
  id: string;
  title: string;
  similarity_score: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

// WebSocket message types
export interface WebSocketMessage {
  type: string;
  timestamp?: string;
  [key: string]: any;
}

export interface MotionEventMessage extends WebSocketMessage {
  type: "motion_event";
  camera: string;
  confidence: number;
  thumbnail_url?: string;
  narration?: string;
}

export interface SyncMessage extends WebSocketMessage {
  type: 'note_update' | 'note_delete' | 'note_create';
  note?: Note;
  note_id?: string;
}

export interface AppStore {
  activeTab: "home" | "notes" | "security" | "infrastructure";
  setActiveTab: (tab: "home" | "notes" | "security" | "infrastructure") => void;

  isInstallPromptVisible: boolean;
  setInstallPromptVisible: (visible: boolean) => void;

  notificationsEnabled: boolean;
  setNotificationsEnabled: (enabled: boolean) => void;
}
