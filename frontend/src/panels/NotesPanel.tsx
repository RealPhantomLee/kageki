import React, { useEffect, useState, useRef } from 'react';
import { useNotesStore } from '../stores/notes';
import { createSyncWSManager } from '../api/websocket';
import type { SyncMessage } from '../types/index';
import axios from 'axios';
import { formatDistanceToNow } from 'date-fns';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';

// Configure marked with highlight.js
marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
});

import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Drawer, DrawerHeader, DrawerContent } from '../components/ui/drawer';
import { ScrollArea } from '../components/ui/scroll-area';
import { Separator } from '../components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import * as d3 from 'd3';
import { Search, Plus, Trash2, Share2, Zap, MessageCircle, Upload } from 'lucide-react';

export const NotesPanel: React.FC = () => {
  const {
    notes,
    activeNoteId,
    filter,
    loading,
    error,
    wsConnected,
    setFilter,
    getFilteredNotes,
    getActiveNote,
    setActiveNote,
    createNote,
    saveNote,
    removeNote,
    loadNotes,
    generateTitle,
    generateKeyPoints,
    setWsConnected,
    setError,
  } = useNotesStore();

  const [editorContent, setEditorContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const [generatingKeyPoints, setGeneratingKeyPoints] = useState(false);
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [showGraphModal, setShowGraphModal] = useState(false);
  const [showChatDrawer, setShowChatDrawer] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importSource, setImportSource] = useState<string>('markdown');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const wsManagerRef = useRef<ReturnType<typeof createSyncWSManager> | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timer | null>(null);
  const graphContainerRef = useRef<SVGSVGElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Load notes on mount
  useEffect(() => {
    loadNotes().catch((err) => {
      console.error('Failed to load notes:', err);
    });
  }, [loadNotes]);

  // Setup WebSocket connection
  useEffect(() => {
    const wsManager = createSyncWSManager();
    wsManagerRef.current = wsManager;

    wsManager.on('note_update', (message: SyncMessage) => {
      if (message.note) {
        useNotesStore.setState((state) => ({
          notes: state.notes.map((n) =>
            n.id === message.note!.id ? message.note! : n
          ),
        }));
      }
    });

    wsManager.on('note_create', (message: SyncMessage) => {
      if (message.note) {
        useNotesStore.setState((state) => ({
          notes: [message.note!, ...state.notes],
        }));
      }
    });

    wsManager.on('note_delete', (message: SyncMessage) => {
      if (message.note_id) {
        useNotesStore.setState((state) => ({
          notes: state.notes.filter((n) => n.id !== message.note_id),
          activeNoteId: state.activeNoteId === message.note_id ? null : state.activeNoteId,
        }));
      }
    });

    wsManager.onConnect(() => {
      setWsConnected(true);
    });

    wsManager.onDisconnect(() => {
      setWsConnected(false);
    });

    wsManager.connect().catch((err) => {
      console.error('Failed to connect WebSocket:', err);
      setWsConnected(false);
    });

    return () => {
      if (wsManager) {
        wsManager.disconnect();
      }
    };
  }, [setWsConnected]);

  // Update editor content when active note changes
  useEffect(() => {
    const activeNote = getActiveNote();
    setEditorContent(activeNote?.content || '');
    setKeyPoints([]);
  }, [activeNoteId, getActiveNote]);

  // Command palette shortcut (Cmd+P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen]);

  // Auto-save on content change
  useEffect(() => {
    if (!activeNoteId || !editorContent) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        setIsSaving(true);
        await saveNote(activeNoteId, { content: editorContent });
      } catch (err) {
        console.error('Failed to save note:', err);
      } finally {
        setIsSaving(false);
      }
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [activeNoteId, editorContent, saveNote]);

  // Draw graph
  useEffect(() => {
    if (!showGraphModal || !graphContainerRef.current) return;

    // Create mock graph data from notes
    const nodes = notes.map((n) => ({
      id: n.id,
      label: n.title || 'Untitled',
    }));

    const links = notes
      .flatMap((n) => (n.outgoing_links || []).map((link) => ({ source: n.id, target: link })))
      .filter((link) => notes.some((n) => n.id === link.target));

    if (nodes.length === 0) return;

    // Clear previous graph
    d3.select(graphContainerRef.current).selectAll('*').remove();

    const width = graphContainerRef.current.clientWidth;
    const height = graphContainerRef.current.clientHeight;

    const svg = d3
      .select(graphContainerRef.current)
      .attr('width', width)
      .attr('height', height);

    const simulation = d3
      .forceSimulation(nodes as any)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2));

    const link = svg
      .append('g')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', '#7c3aed')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 2);

    const node = svg
      .append('g')
      .selectAll('circle')
      .data(nodes)
      .enter()
      .append('circle')
      .attr('r', 8)
      .attr('fill', (d: any) => (d.id === activeNoteId ? '#a855f7' : '#7c3aed'))
      .attr('stroke', '#1a1a1a')
      .attr('stroke-width', 2)
      .on('click', (_, d: any) => {
        setActiveNote(d.id);
      })
      .style('cursor', 'pointer');

    const labels = svg
      .append('g')
      .selectAll('text')
      .data(nodes)
      .enter()
      .append('text')
      .text((d: any) => d.label.substring(0, 10))
      .attr('font-size', '10px')
      .attr('fill', '#e0e0e0')
      .attr('text-anchor', 'middle')
      .attr('pointer-events', 'none');

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('cx', (d: any) => d.x).attr('cy', (d: any) => d.y);

      labels.attr('x', (d: any) => d.x).attr('y', (d: any) => d.y + 15);
    });
  }, [showGraphModal, notes, activeNoteId, setActiveNote]);

  const handleNewNote = async () => {
    try {
      const note = await createNote('Untitled', '');
      setActiveNote(note.id);
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  };

  const handleDeleteNote = async () => {
    if (!activeNoteId) return;
    if (!window.confirm('Delete this note?')) return;

    try {
      await removeNote(activeNoteId);
      setActiveNote(null);
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  const handleGenerateTitle = async () => {
    if (!activeNoteId || !editorContent) return;

    try {
      setGeneratingTitle(true);
      await generateTitle(activeNoteId, editorContent);
    } catch (err) {
      console.error('Failed to generate title:', err);
    } finally {
      setGeneratingTitle(false);
    }
  };

  const handleGenerateKeyPoints = async () => {
    if (!activeNoteId || !editorContent) return;

    try {
      setGeneratingKeyPoints(true);
      const points = await generateKeyPoints(activeNoteId, editorContent);
      setKeyPoints(points);
    } catch (err) {
      console.error('Failed to generate key points:', err);
    } finally {
      setGeneratingKeyPoints(false);
    }
  };

  const handleExport = async () => {
    if (!activeNoteId) return;

    try {
      const response = await axios.get(`/api/notes/${activeNoteId}/export`);
      const element = document.createElement('a');
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(response.data.content));
      element.setAttribute('download', `${getActiveNote()?.title || 'note'}.txt`);
      element.style.display = 'none';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    } catch (err) {
      console.error('Failed to export note:', err);
    }
  };

  const handleImportNotes = async () => {
    if (!importFile) return;
    setImportLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('source', importSource);
      const resp = await axios.post('/api/notes/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      // Show success - imported notes count
      const importedCount = resp.data.count || 1;
      setError(null);
      await loadNotes();
      setShowImportDialog(false);
      setImportFile(null);
      setImportSource('markdown');
    } catch (err) {
      setError(`Failed to import notes: ${String(err)}`);
    } finally {
      setImportLoading(false);
    }
  };

  const handleChatSubmit = async (e: React.KeyboardEvent<HTMLInputElement> | React.MouseEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    if (!chatInput.trim() || !activeNoteId) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setChatLoading(true);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userMessage,
          note_id: activeNoteId,
          context: editorContent,
        }),
      });

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = '';

      // Add placeholder for streaming response
      setChatMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                assistantMessage += data.content;
                // Update last message with streaming content
                setChatMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1].content = assistantMessage;
                  return updated;
                });
              }
            } catch (e) {
              // Ignore parse errors for SSE
            }
          }
        }
      }
    } catch (err) {
      console.error('Chat error:', err);
      setChatMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'Error: Could not connect to AI service',
      }]);
    } finally {
      setChatLoading(false);
    }

    // Auto-scroll to bottom
    setTimeout(() => {
      if (chatScrollRef.current) {
        chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }
    }, 0);
  };

  const filteredNotes = getFilteredNotes();
  const activeNote = getActiveNote();
  const backlinks = notes.filter((n) => (n.outgoing_links || []).includes(activeNoteId || ''));

  return (
    <div className="h-full flex flex-col bg-obsidian-bg text-obsidian-text">
      {/* 4-Zone Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Zone 1: Left File Tree */}
        <div className={`${sidebarCollapsed ? 'w-0' : 'w-64'} transition-all border-r border-obsidian-border flex flex-col glass-card overflow-hidden`}>
          {/* Header */}
          <div className="p-4 border-b border-obsidian-border flex items-center gap-2">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-2 hover:bg-obsidian-surface-hover rounded transition flex-shrink-0"
            >
              {sidebarCollapsed ? '▶' : '◀'}
            </button>
            <div className="flex-1 flex flex-col gap-3">
              <Button
                onClick={handleNewNote}
                className="w-full"
                variant="default"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Note
              </Button>

              <Button
                onClick={() => setShowImportDialog(true)}
                variant="outline"
                className="w-full"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import
              </Button>

              {wsConnected && (
                <Badge variant="success" className="text-xs w-full">
                  <span className="w-1.5 h-1.5 bg-obsidian-success rounded-full mr-1 animate-pulse"></span>
                  Syncing
                </Badge>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="px-4 py-3 border-b border-obsidian-border">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 w-4 h-4 text-obsidian-text-muted" />
              <input
                type="text"
                placeholder="Search notes..."
                value={filter.search || ''}
                onChange={(e) => setFilter({ ...filter, search: e.target.value })}
                className="w-full bg-obsidian-surface-hover border border-obsidian-border text-obsidian-text px-3 py-2 pl-8 rounded text-sm focus:outline-none focus:border-obsidian-accent transition"
              />
            </div>
          </div>

          {/* Notes List */}
          <ScrollArea className="flex-1">
            <div className="space-y-1 p-2">
              {loading && (
                <div className="text-center text-obsidian-text-muted text-sm py-4">Loading...</div>
              )}

              {!loading && filteredNotes.length === 0 && (
                <div className="text-center text-obsidian-text-muted text-sm py-8">
                  {filter.search ? 'No notes found' : 'No notes yet'}
                </div>
              )}

              {filteredNotes.map((note) => (
                <button
                  key={note.id}
                  onClick={() => setActiveNote(note.id)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                    activeNoteId === note.id
                      ? 'bg-obsidian-accent text-white'
                      : 'text-obsidian-text hover:bg-obsidian-surface-hover'
                  }`}
                >
                  <div className="font-medium truncate">{note.title || 'Untitled'}</div>
                  <div className="text-xs opacity-75 mt-1">
                    {formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Zone 2: Center Editor + Preview */}
        <div className="flex-1 flex flex-col overflow-y-auto h-full">
          {activeNote ? (
            <>
              {/* Editor Header */}
              <div className="px-6 py-4 border-b border-obsidian-border flex items-center justify-between glass-card">
                <div className="flex-1">
                  <input
                    type="text"
                    value={activeNote.title || ''}
                    onChange={(e) => saveNote(activeNote.id, { title: e.target.value })}
                    placeholder="Note title..."
                    className="text-2xl font-bold bg-transparent text-obsidian-text outline-none w-full"
                  />
                  <div className="text-sm text-obsidian-text-muted mt-1">
                    Created {formatDistanceToNow(new Date(activeNote.created_at), { addSuffix: true })}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isSaving && (
                    <Badge variant="secondary" className="text-xs">Saving...</Badge>
                  )}
                </div>
              </div>

              {/* Editor with Split View Toggle */}
              <div className={`flex-1 overflow-hidden flex ${showPreview ? 'gap-4' : ''}`}>
                {/* Raw Markdown */}
                <div className={showPreview ? 'w-1/2' : 'w-full'}>
                  <textarea
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    placeholder="Start typing markdown..."
                    className="w-full h-full bg-obsidian-bg text-obsidian-text outline-none resize-none font-mono text-sm p-6 transition-opacity duration-200"
                  />
                </div>

                {/* Preview Pane */}
                {showPreview && (
                  <>
                    <Separator orientation="vertical" />
                    <div className="w-1/2 overflow-y-auto p-6 h-full">
                      <div
                        className="prose prose-invert max-w-none text-obsidian-text"
                        dangerouslySetInnerHTML={{
                          __html: marked.parse(editorContent) as string,
                        }}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Action Buttons */}
              <div className="px-6 py-4 border-t border-obsidian-border glass-card flex flex-wrap gap-2">
                <Button
                  onClick={() => setShowPreview(!showPreview)}
                  variant={showPreview ? 'default' : 'outline'}
                  size="sm"
                >
                  {showPreview ? 'Editor Only' : 'Preview'}
                </Button>

                <Button
                  onClick={handleGenerateTitle}
                  disabled={generatingTitle || !editorContent}
                  variant="default"
                  size="sm"
                >
                  <Zap className="w-3 h-3 mr-1" />
                  {generatingTitle ? 'Generating...' : 'AI Title'}
                </Button>

                <Button
                  onClick={handleGenerateKeyPoints}
                  disabled={generatingKeyPoints || !editorContent}
                  variant="default"
                  size="sm"
                >
                  <Zap className="w-3 h-3 mr-1" />
                  {generatingKeyPoints ? 'Generating...' : 'Key Points'}
                </Button>

                <Button
                  onClick={handleExport}
                  variant="outline"
                  size="sm"
                >
                  <Share2 className="w-3 h-3 mr-1" />
                  Export
                </Button>

                <Button
                  onClick={() => setShowChatDrawer(true)}
                  variant="outline"
                  size="sm"
                >
                  <MessageCircle className="w-3 h-3 mr-1" />
                  Chat
                </Button>

                <Button
                  onClick={handleDeleteNote}
                  variant="destructive"
                  size="sm"
                  className="ml-auto"
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  Delete
                </Button>
              </div>

              {/* Key Points Display */}
              {keyPoints.length > 0 && (
                <div className="px-6 py-3 border-t border-obsidian-border glass-card">
                  <div className="text-sm font-semibold mb-2">Key Points:</div>
                  <ul className="space-y-1 text-sm text-obsidian-text">
                    {keyPoints.map((point, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="text-obsidian-accent">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-obsidian-text-muted">
                <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p>Select or create a note to get started</p>
              </div>
            </div>
          )}

          {error && (
            <div className="px-6 py-2 bg-obsidian-error/20 text-red-300 text-sm border-t border-obsidian-error/50">
              {error}
            </div>
          )}
        </div>

        {/* Zone 3: Right Backlinks + Graph */}
        {activeNote && (
          <div className="w-72 border-l border-obsidian-border flex flex-col glass-card overflow-y-auto h-full">
            {/* Backlinks Header */}
            <div className="p-4 border-b border-obsidian-border">
              <h3 className="font-semibold text-obsidian-text">Backlinks</h3>
              <p className="text-xs text-obsidian-text-muted mt-1">{backlinks.length} linked notes</p>
            </div>

            {/* Backlinks List */}
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-2">
                {backlinks.length === 0 ? (
                  <p className="text-xs text-obsidian-text-muted">No backlinks</p>
                ) : (
                  backlinks.map((note) => (
                    <button
                      key={note.id}
                      onClick={() => setActiveNote(note.id)}
                      className="w-full text-left px-3 py-2 rounded text-sm bg-obsidian-surface-hover hover:bg-obsidian-border text-obsidian-text transition"
                    >
                      {note.title || 'Untitled'}
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>

            {/* Graph Button */}
            <div className="p-4 border-t border-obsidian-border">
              <Button
                onClick={() => setShowGraphModal(!showGraphModal)}
                variant="outline"
                className="w-full text-sm"
              >
                {showGraphModal ? 'Close Graph' : 'View Graph'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Graph Modal */}
      {showGraphModal && (
        <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center" onClick={() => setShowGraphModal(false)}>
          <div
            className="glass-card border border-obsidian-border rounded-lg p-6 w-4/5 h-4/5 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold mb-4 text-obsidian-text">Note Graph</h2>
            <svg
              ref={graphContainerRef}
              className="flex-1 border border-obsidian-border rounded"
              style={{ background: 'rgba(13, 13, 13, 0.5)' }}
            />
            <Button
              onClick={() => setShowGraphModal(false)}
              variant="outline"
              className="mt-4 w-full"
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Chat Drawer */}
      <Drawer
        open={showChatDrawer}
        onOpenChange={setShowChatDrawer}
        side="right"
      >
        <DrawerHeader onClose={() => setShowChatDrawer(false)}>
          <h2 className="text-lg font-semibold text-obsidian-text">AI Chat</h2>
        </DrawerHeader>
        <DrawerContent className="flex flex-col h-full glass-card">
          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto space-y-4 p-4 transition-opacity duration-200"
          >
            {chatMessages.length === 0 && (
              <div className="text-center text-obsidian-text-muted py-8">
                Start chatting about your note...
              </div>
            )}
            {chatMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`px-4 py-2 rounded transition-all duration-200 ${
                  msg.role === 'user'
                    ? 'bg-obsidian-accent/20 text-obsidian-text ml-8'
                    : 'bg-obsidian-surface-hover text-obsidian-text mr-8'
                }`}
              >
                <div
                  dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) as string }}
                  className="prose prose-invert max-w-none"
                />
              </div>
            ))}
            {chatLoading && (
              <div className="px-4 py-2 rounded bg-obsidian-surface-hover text-obsidian-text mr-8">
                <span className="animate-pulse">Thinking...</span>
              </div>
            )}
          </div>
          <div className="p-4 border-t border-obsidian-border flex gap-2">
            <input
              type="text"
              placeholder="Ask about this note..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={handleChatSubmit}
              disabled={chatLoading}
              className="flex-1 bg-obsidian-surface-hover border border-obsidian-border text-obsidian-text px-3 py-2 rounded text-sm focus:outline-none focus:border-obsidian-accent disabled:opacity-50 transition"
            />
            <Button
              onClick={handleChatSubmit}
              variant="default"
              size="sm"
              disabled={!chatInput.trim() || chatLoading}
            >
              Send
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Import Dialog */}
      {showImportDialog && (
        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Import Notes</DialogTitle>
            </DialogHeader>

            {/* Source Selector */}
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium text-obsidian-text mb-2 block">Source Format</span>
                <select
                  value={importSource}
                  onChange={(e) => setImportSource(e.target.value)}
                  className="w-full bg-obsidian-surface-hover border border-obsidian-border text-obsidian-text px-3 py-2 rounded"
                >
                  <option value="markdown">Markdown (.md)</option>
                  <option value="enex">Apple Notes (.enex)</option>
                  <option value="html">Google Docs (.html)</option>
                  <option value="notion">Notion (zip)</option>
                  <option value="chatgpt">ChatGPT (zip)</option>
                </select>
              </label>

              {/* File Drag & Drop */}
              <label className="block border-2 border-dashed border-obsidian-border rounded-lg p-6 text-center cursor-pointer hover:bg-obsidian-surface-hover transition glass-card">
                <input
                  type="file"
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <div className="text-obsidian-text-muted">
                  {importFile ? importFile.name : 'Click to select or drag & drop'}
                </div>
              </label>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowImportDialog(false)}>Cancel</Button>
              <Button onClick={handleImportNotes} disabled={!importFile || importLoading}>
                {importLoading ? 'Importing...' : 'Import'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default NotesPanel;
