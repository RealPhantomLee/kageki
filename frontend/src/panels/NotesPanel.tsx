import React, { useEffect, useState, useRef } from 'react';
import { useNotesStore } from '../stores/notes';
import { createSyncWSManager } from '../api/websocket';
import type { SyncMessage } from '../types/index';
import { apiClient } from '../api/client';
import axios from 'axios';
import { formatDistanceToNow } from 'date-fns';
import { marked, Renderer } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';
import JSZip from 'jszip';

// Configure marked with custom renderer for syntax highlighting and callouts
const renderer = new Renderer();

renderer.code = ({ text, language }) => {
  const validLang = language && hljs.getLanguage(language) ? language : 'plaintext';
  const highlighted = hljs.highlight(text, { language: validLang }).value;
  return `<pre><code class="hljs language-${validLang}">${highlighted}</code></pre>`;
};

// Callout renderer: intercepts > [!TYPE] blockquotes
renderer.blockquote = ({ tokens }) => {
  const raw = tokens.map(t => ('text' in t ? t.text : '')).join('');
  const match = raw.match(/^\[!(INFO|WARNING|ERROR|CHECK|NOTE|TIP)\](.*)/si);

  if (match) {
    const type = match[1].toUpperCase();
    const restContent = match[2].trim();
    const styles: Record<string, {border: string, bg: string, icon: string}> = {
      INFO:    {border: 'border-obsidian-accent',  bg: 'bg-obsidian-accent/10',  icon: 'ℹ️'},
      NOTE:    {border: 'border-obsidian-accent',  bg: 'bg-obsidian-accent/10',  icon: '📝'},
      TIP:     {border: 'border-obsidian-success', bg: 'bg-obsidian-success/10', icon: '💡'},
      WARNING: {border: 'border-obsidian-warning', bg: 'bg-obsidian-warning/10', icon: '⚠️'},
      ERROR:   {border: 'border-obsidian-error',   bg: 'bg-obsidian-error/10',   icon: '🚫'},
      CHECK:   {border: 'border-obsidian-success', bg: 'bg-obsidian-success/10', icon: '✅'},
    };
    const s = styles[type] || styles.INFO;
    return `<div class="callout rounded-lg border-l-4 ${s.border} ${s.bg} p-3 my-3">
      <div class="callout-title flex items-center gap-2 font-semibold text-sm mb-1">${s.icon} ${type}</div>
      <div class="text-sm">${marked.parse(restContent)}</div></div>`;
  }

  return `<blockquote class="border-l-4 border-obsidian-accent pl-4 italic text-obsidian-text-muted my-3">${marked.parser(tokens)}</blockquote>`;
};

// List item renderer for checkboxes
renderer.listitem = ({ text, task, checked }) => {
  if (task) {
    const checkedAttr = checked ? 'checked' : '';
    return `<li class="task-list-item flex items-start gap-2">
      <input type="checkbox" ${checkedAttr} data-task-checkbox class="mt-1 accent-obsidian-accent cursor-pointer" />
      <span>${text.replace(/^<input[^>]+>/, '')}</span>
    </li>`;
  }
  return `<li>${text}</li>`;
};

marked.use({ renderer });

// Frontmatter helper functions
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

const parseFrontmatter = (content: string): { hasFm: boolean; body: string; tags: string[]; aliases: string[] } => {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { hasFm: false, body: content, tags: [], aliases: [] };
  const fm = match[1];
  const body = content.slice(match[0].length).trimStart();
  const tagsMatch = fm.match(/^tags:\s*\[([^\]]*)\]/m);
  const aliasMatch = fm.match(/^aliases:\s*\[([^\]]*)\]/m);
  const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim().replace(/['\"]/g, '')).filter(Boolean) : [];
  const aliases = aliasMatch ? aliasMatch[1].split(',').map(a => a.trim().replace(/['\"]/g, '')).filter(Boolean) : [];
  return { hasFm: true, body, tags, aliases };
};

const updateFrontmatter = (content: string, newTags: string[], newAliases: string[]): string => {
  const tagsYaml = `tags: [${newTags.map(t => `"${t}"`).join(', ')}]`;
  const aliasYaml = newAliases.length ? `aliases: [${newAliases.map(a => `"${a}"`).join(', ')}]` : '';
  const fmLines = [tagsYaml, aliasYaml].filter(Boolean).join('\n');
  const newFm = `---\n${fmLines}\n---`;

  const match = content.match(FRONTMATTER_RE);
  if (match) {
    return content.replace(FRONTMATTER_RE, newFm);
  }
  return `${newFm}\n\n${content}`;
};

import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Drawer, DrawerHeader, DrawerContent } from '../components/ui/drawer';
import { ScrollArea } from '../components/ui/scroll-area';
import { Separator } from '../components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import * as d3 from 'd3';
import { Search, Plus, Trash2, Share2, Zap, MessageCircle, Upload, Calendar } from 'lucide-react';

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
  const [paletteSelectedIdx, setPaletteSelectedIdx] = useState(0);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importSource, setImportSource] = useState<string>('markdown');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importDragOver, setImportDragOver] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showFrontmatter, setShowFrontmatter] = useState(false);
  const [fmTags, setFmTags] = useState<string[]>([]);
  const [fmAliases, setFmAliases] = useState<string[]>([]);
  const [fmTagInput, setFmTagInput] = useState('');
  const wsManagerRef = useRef<ReturnType<typeof createSyncWSManager> | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timer | null>(null);
  const graphContainerRef = useRef<SVGSVGElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

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

  // Sync frontmatter state when note changes
  useEffect(() => {
    if (activeNoteId) {
      const { tags, aliases } = parseFrontmatter(editorContent);
      setFmTags(tags);
      setFmAliases(aliases);
    }
  }, [activeNoteId]);

  // Command palette shortcut (Cmd+P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setCommandPaletteOpen(prev => {
          if (prev) { setSearchQuery(''); setPaletteSelectedIdx(0); }
          return !prev;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  // Reset palette selection on query change
  useEffect(() => {
    setPaletteSelectedIdx(0);
  }, [searchQuery]);

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

    // Wait for modal animation to complete before reading dimensions
    const timeoutId = setTimeout(() => {
      if (!graphContainerRef.current) return;

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
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [showGraphModal, notes, activeNoteId, setActiveNote]);

  const handleNewNote = async () => {
    try {
      const note = await createNote('Untitled', '');
      setActiveNote(note.id);
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  };

  const handleDailyNote = async () => {
    try {
      const response = await apiClient.get('/api/notes/daily');
      const note = response.data;
      const existing = notes.find(n => n.id === note.id);
      if (!existing) {
        useNotesStore.setState((state) => ({
          notes: [note, ...state.notes],
        }));
      }
      setActiveNote(note.id);
    } catch (err) {
      console.error('Failed to load daily note:', err);
    }
  };

  const handlePreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.dataset.taskCheckbox !== undefined) {
      e.preventDefault();
      const checkbox = target;
      const isChecked = checkbox.checked;

      // Find position of this checkbox in the raw markdown
      const allCheckboxes = previewRef.current?.querySelectorAll('[data-task-checkbox]');
      if (!allCheckboxes) return;
      const index = Array.from(allCheckboxes).indexOf(checkbox);

      // Toggle the corresponding markdown checkbox
      let count = -1;
      const newContent = editorContent.replace(/- \[([ x])(?:\])/gi, (match) => {
        count++;
        if (count === index) {
          return isChecked ? '- [x]' : '- [ ]';
        }
        return match;
      });

      setEditorContent(newContent);
    }
  };

  const handlePaletteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setPaletteSelectedIdx(i => Math.min(i + 1, paletteResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setPaletteSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && paletteResults[paletteSelectedIdx]) {
      setActiveNote(paletteResults[paletteSelectedIdx].id);
      setCommandPaletteOpen(false);
      setSearchQuery('');
    }
  };

  const handleFmSave = () => {
    const updated = updateFrontmatter(editorContent, fmTags, fmAliases);
    setEditorContent(updated);
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
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(response.data));
      element.setAttribute('download', `${getActiveNote()?.title || 'note'}.txt`);
      element.style.display = 'none';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    } catch (err) {
      console.error('Failed to export note:', err);
    }
  };

  // Extract all .md files from dropped folders using FileSystemEntry API
  const extractMdFilesFromEntries = async (entries: DataTransferItemList): Promise<File[]> => {
    const files: File[] = [];

    const traverseFileTree = async (item: FileSystemEntry, path: string = ''): Promise<void> => {
      if (item.isFile) {
        const fileItem = item as FileSystemFileEntry;
        return new Promise((resolve) => {
          fileItem.file((file: File) => {
            if (file.name.endsWith('.md')) {
              files.push(file);
            }
            resolve();
          });
        });
      } else if (item.isDirectory) {
        const dirItem = item as FileSystemDirectoryEntry;
        const reader = dirItem.createReader();
        return new Promise((resolve) => {
          reader.readEntries(async (entries: FileSystemEntry[]) => {
            for (const entry of entries) {
              await traverseFileTree(entry, path + item.name + '/');
            }
            resolve();
          });
        });
      }
    };

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i].webkitGetAsEntry();
      if (entry) {
        await traverseFileTree(entry);
      }
    }

    return files;
  };

  // Create a ZIP file from multiple markdown files (for Obsidian Vault format)
  const createZipFromMarkdownFiles = async (files: File[]): Promise<File> => {
    const zip = new JSZip();

    for (const file of files) {
      const content = await file.text();
      zip.file(file.name, content);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    return new File([zipBlob], 'obsidian_vault.zip', { type: 'application/zip' });
  };

  const handleImportNotes = async () => {
    // Determine which files to use
    const filesToImport = importSource === 'markdown' ? importFiles : importFile ? [importFile] : [];
    if (filesToImport.length === 0) return;

    setImportLoading(true);
    try {
      let fileToUpload: File;
      let sourceToUse = importSource;

      if (importSource === 'markdown' && filesToImport.length > 1) {
        // Multiple markdown files: create a ZIP and use obsidian_vault source
        fileToUpload = await createZipFromMarkdownFiles(filesToImport);
        sourceToUse = 'obsidian_vault';
      } else if (importSource === 'markdown' && filesToImport.length === 1) {
        fileToUpload = filesToImport[0];
        sourceToUse = 'markdown';
      } else {
        fileToUpload = filesToImport[0];
      }

      const formData = new FormData();
      formData.append('file', fileToUpload);
      formData.append('source', sourceToUse);

      const resp = await axios.post('/api/notes/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      // Show success - imported notes count
      const importedCount = resp.data.imported || 1;
      setError(null);
      await loadNotes();
      setShowImportDialog(false);
      setImportFile(null);
      setImportFiles([]);
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
              if (data.text) {
                assistantMessage += data.text;
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

  const paletteResults = React.useMemo(() => {
    if (!searchQuery.trim()) return notes.slice(0, 10);
    const fuzzyScore = (haystack: string, needle: string): number => {
      const h = haystack.toLowerCase();
      const n = needle.toLowerCase();
      if (!n) return 1;
      let score = 0, hi = 0;
      for (const ch of n) {
        const pos = h.indexOf(ch, hi);
        if (pos === -1) return 0;
        score += 1 / (pos - hi + 1);
        hi = pos + 1;
      }
      return score;
    };
    return notes
      .map(n => ({ note: n, score: fuzzyScore(n.title, searchQuery) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ note }) => note);
  }, [notes, searchQuery]);

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

              <Button
                onClick={handleDailyNote}
                variant="outline"
                className="w-full"
              >
                <Calendar className="w-4 h-4 mr-2" />
                Today
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

              {/* Frontmatter Collapsible */}
              <div className="border-b border-obsidian-border">
                <button
                  onClick={() => setShowFrontmatter(!showFrontmatter)}
                  className="w-full flex items-center gap-2 px-6 py-2 text-xs text-obsidian-text-muted hover:bg-obsidian-surface-hover transition"
                >
                  <span>{showFrontmatter ? '▼' : '▶'}</span>
                  <span>Frontmatter</span>
                  {fmTags.length > 0 && (
                    <span className="text-obsidian-accent">{fmTags.length} tag{fmTags.length !== 1 ? 's' : ''}</span>
                  )}
                </button>

                {showFrontmatter && (
                  <div className="px-6 py-3 bg-obsidian-surface-hover/30 space-y-3">
                    {/* Tags */}
                    <div>
                      <label className="text-xs font-semibold text-obsidian-text-muted block mb-1">Tags</label>
                      <div className="flex flex-wrap gap-1 mb-1">
                        {fmTags.map((tag, i) => (
                          <span key={i} className="flex items-center gap-1 bg-obsidian-accent/20 text-obsidian-accent text-xs px-2 py-0.5 rounded-full">
                            {tag}
                            <button onClick={() => { const t = fmTags.filter((_, j) => j !== i); setFmTags(t); }} className="hover:text-white">×</button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={fmTagInput}
                          onChange={e => setFmTagInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && fmTagInput.trim()) {
                              setFmTags([...fmTags, fmTagInput.trim()]);
                              setFmTagInput('');
                            }
                          }}
                          placeholder="Add tag, press Enter"
                          className="flex-1 bg-obsidian-surface-hover border border-obsidian-border text-obsidian-text text-xs px-2 py-1 rounded outline-none focus:border-obsidian-accent"
                        />
                        <Button size="sm" variant="outline" onClick={handleFmSave} className="text-xs">Save</Button>
                      </div>
                    </div>

                    {/* Aliases */}
                    <div>
                      <label className="text-xs font-semibold text-obsidian-text-muted block mb-1">Aliases</label>
                      <div className="flex flex-wrap gap-1">
                        {fmAliases.map((alias, i) => (
                          <span key={i} className="flex items-center gap-1 bg-obsidian-surface-hover text-obsidian-text text-xs px-2 py-0.5 rounded-full border border-obsidian-border">
                            {alias}
                            <button onClick={() => setFmAliases(fmAliases.filter((_, j) => j !== i))} className="hover:text-white">×</button>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
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
                        ref={previewRef}
                        onClick={handlePreviewClick}
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
              <label
                className={`block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition glass-card ${
                  importDragOver
                    ? 'border-obsidian-accent bg-obsidian-accent/10'
                    : 'border-obsidian-border hover:bg-obsidian-surface-hover'
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setImportDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setImportDragOver(false);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setImportDragOver(false);

                  if (importSource === 'markdown') {
                    // Use FileSystemEntry API for folder drag-drop
                    const mdFiles = await extractMdFilesFromEntries(e.dataTransfer.items);
                    if (mdFiles.length > 0) {
                      setImportFiles(mdFiles);
                      setImportFile(null);
                    } else {
                      setError('No .md files found in dropped folder');
                    }
                  } else {
                    // Single file for other sources
                    const file = e.dataTransfer.files?.[0];
                    if (file) {
                      setImportFile(file);
                      setImportFiles([]);
                    }
                  }
                }}
              >
                <input
                  type="file"
                  {...(importSource === 'markdown' ? { webkitdirectory: true, multiple: true } : { multiple: false })}
                  onChange={(e) => {
                    if (importSource === 'markdown') {
                      const files = Array.from(e.target.files || []).filter(f => f.name.endsWith('.md'));
                      setImportFiles(files);
                      setImportFile(null);
                    } else {
                      setImportFile(e.target.files?.[0] || null);
                      setImportFiles([]);
                    }
                  }}
                  className="hidden"
                />
                <div className="text-obsidian-text-muted">
                  {importFiles.length > 0
                    ? `${importFiles.length} .md file(s) selected`
                    : importFile
                    ? importFile.name
                    : importSource === 'markdown'
                    ? 'Click to select folder or drag & drop .md files'
                    : 'Click to select or drag & drop file'}
                </div>
              </label>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowImportDialog(false)}>Cancel</Button>
              <Button onClick={handleImportNotes} disabled={(!importFile && importFiles.length === 0) || importLoading}>
                {importLoading ? 'Importing...' : 'Import'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Command Palette */}
      <Dialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
        <DialogContent
          className="fixed left-[50%] top-[10%] translate-x-[-50%] translate-y-0 w-full max-w-lg p-0 gap-0 border border-obsidian-border bg-obsidian-surface"
        >
          {/* Search Input */}
          <div className="flex items-center gap-2 p-3 border-b border-obsidian-border">
            <Search className="w-4 h-4 text-obsidian-text-muted flex-shrink-0" />
            <input
              autoFocus
              type="text"
              placeholder="Search notes..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handlePaletteKeyDown}
              className="flex-1 bg-transparent text-obsidian-text outline-none text-sm"
            />
            <kbd className="text-xs text-obsidian-text-muted border border-obsidian-border rounded px-1">Esc</kbd>
          </div>
          {/* Results */}
          <div className="max-h-72 overflow-y-auto" id="palette-list">
            {paletteResults.length === 0 && (
              <div className="p-4 text-center text-obsidian-text-muted text-sm">No notes found</div>
            )}
            {paletteResults.map((note, idx) => (
              <button
                key={note.id}
                onClick={() => {
                  setActiveNote(note.id);
                  setCommandPaletteOpen(false);
                  setSearchQuery('');
                }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                  idx === paletteSelectedIdx
                    ? 'bg-obsidian-accent text-white'
                    : 'text-obsidian-text hover:bg-obsidian-surface-hover'
                }`}
              >
                <div className="font-medium truncate">{note.title || 'Untitled'}</div>
                <div className="text-xs opacity-60 mt-0.5">
                  {formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default NotesPanel;
