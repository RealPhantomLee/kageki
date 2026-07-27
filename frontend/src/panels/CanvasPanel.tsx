import React, { useCallback, useEffect, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useNotesStore } from '../stores/notes';
import { apiClient } from '../api/client';
import { useAppStore } from '../stores/appStore';
import { Button } from '../components/ui/button';

const CANVAS_ID = 'main';

// Custom Note Card node type
const NoteCardNode: React.FC<NodeProps> = ({ data }) => {
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setActiveNote = useNotesStore((s) => s.setActiveNote);

  return (
    <div
      className="glass-card border border-obsidian-accent rounded-lg p-3 min-w-[200px] max-w-[320px] cursor-pointer select-none"
      onDoubleClick={() => {
        setActiveNote(data.noteId);
        setActiveTab('canvas');
        setActiveTab('notes');
      }}
    >
      <div className="font-semibold text-obsidian-text text-sm truncate">{data.label}</div>
      <div className="text-xs text-obsidian-text-muted mt-1">{data.subtitle}</div>
    </div>
  );
};

const nodeTypes = { noteCard: NoteCardNode };

export const CanvasPanel: React.FC = () => {
  const { notes } = useNotesStore();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);

  // Load canvas nodes from backend
  useEffect(() => {
    const loadCanvas = async () => {
      try {
        const resp = await apiClient.get(`/api/canvas/${CANVAS_ID}/nodes`);
        const canvasNodes = resp.data.nodes as any[];
        const rfNodes: Node[] = canvasNodes.map((cn) => ({
          id: cn.id,
          type: 'noteCard',
          position: { x: cn.x, y: cn.y },
          data: {
            label: cn.note_title,
            noteId: cn.note_id,
            subtitle: `Node ${cn.id.slice(0, 6)}`,
          },
          style: { width: cn.width, height: cn.height },
        }));
        setNodes(rfNodes);

        // Build edges from note outgoing_links
        const rfEdges: Edge[] = [];
        canvasNodes.forEach((cn) => {
          const note = notes.find((n) => n.id === cn.note_id);
          if (note?.outgoing_links) {
            note.outgoing_links.forEach((linkedId) => {
              const targetCanvas = canvasNodes.find((c) => c.note_id === linkedId);
              if (targetCanvas) {
                rfEdges.push({
                  id: `e-${cn.id}-${targetCanvas.id}`,
                  source: cn.id,
                  target: targetCanvas.id,
                  style: { stroke: '#7c3aed' },
                });
              }
            });
          }
        });
        setEdges(rfEdges);
      } catch (e) {
        console.error('Failed to load canvas:', e);
      } finally {
        setLoading(false);
      }
    };
    loadCanvas();
  }, [notes]);

  // Persist node position after drag
  const onNodeDragStop = useCallback(async (_: React.MouseEvent, node: Node) => {
    try {
      await apiClient.put(`/api/canvas/${CANVAS_ID}/nodes/${node.id}`, {
        x: node.position.x,
        y: node.position.y,
      });
    } catch (e) {
      console.error('Failed to save node position:', e);
    }
  }, []);

  // Add note to canvas from sidebar list
  const addNoteToCanvas = async (noteId: string) => {
    const existingNode = nodes.find((n) => n.data.noteId === noteId);
    if (existingNode) return; // Already on canvas

    try {
      const resp = await apiClient.post(`/api/canvas/${CANVAS_ID}/nodes`, {
        note_id: noteId,
        x: Math.random() * 600,
        y: Math.random() * 400,
        width: 280,
        height: 120,
      });
      const note = notes.find((n) => n.id === noteId);
      const newNode: Node = {
        id: resp.data.id,
        type: 'noteCard',
        position: { x: Math.random() * 600, y: Math.random() * 400 },
        data: { label: note?.title || 'Untitled', noteId, subtitle: '' },
        style: { width: 280, height: 120 },
      };
      setNodes((nds) => [...nds, newNode]);
    } catch (e: any) {
      if (e.response?.status !== 409) {
        console.error('Failed to add note to canvas:', e);
      }
    }
  };

  return (
    <div className="h-full flex overflow-hidden bg-obsidian-bg">
      {/* Sidebar: Note list to drag onto canvas */}
      <div className="w-56 border-r border-obsidian-border flex flex-col glass-card overflow-hidden">
        <div className="p-3 border-b border-obsidian-border">
          <h3 className="text-sm font-semibold text-obsidian-text">Notes</h3>
          <p className="text-xs text-obsidian-text-muted mt-1">Double-click to add</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {notes.map((note) => (
            <button
              key={note.id}
              onDoubleClick={() => addNoteToCanvas(note.id)}
              className="w-full text-left px-2 py-1.5 rounded text-xs text-obsidian-text hover:bg-obsidian-surface-hover transition truncate"
            >
              {note.title || 'Untitled'}
            </button>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1">
        {loading ? (
          <div className="h-full flex items-center justify-center text-obsidian-text-muted">
            Loading canvas...
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            nodeTypes={nodeTypes}
            fitView
            style={{ background: '#0d0d0d' }}
          >
            <Controls className="bg-obsidian-surface border border-obsidian-border" />
            <Background variant={BackgroundVariant.Dots} gap={24} color="#2d2d2d" />
          </ReactFlow>
        )}
      </div>
    </div>
  );
};

export default CanvasPanel;
