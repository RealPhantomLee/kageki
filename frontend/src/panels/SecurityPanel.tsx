import React, { useEffect, useState, useRef } from 'react';
import { useSecurityStore } from '../stores/security';
import { createSecurityWSManager } from '../api/websocket';
import type { SecurityEvent, Camera, MotionEventMessage } from '../types/index';
import axios from 'axios';
import { formatDistanceToNow, format } from 'date-fns';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { Shield, Camera, AlertTriangle, X, RefreshCw, ZoomIn, CheckCircle2, Circle } from 'lucide-react';

interface CameraSnapshot {
  cameraId: string;
  snapshot: string;
  lastUpdated: number;
}

export const SecurityPanel: React.FC = () => {
  const {
    events,
    cameras,
    selectedCamera,
    armedSystems,
    loading,
    error,
    wsConnected,
    addEvent,
    setCameras,
    selectCamera,
    setArmed,
    setWsConnected,
    setLoading,
    setError,
  } = useSecurityStore();

  // Local state for new design
  const [cameraSnapshots, setCameraSnapshots] = useState<Map<string, CameraSnapshot>>(new Map());
  const [fullscreenCameraId, setFullscreenCameraId] = useState<string | null>(null);
  const [selectedEventForModal, setSelectedEventForModal] = useState<SecurityEvent | null>(null);
  const [motionAlert, setMotionAlert] = useState(false);
  const [lastMotionTime, setLastMotionTime] = useState<Date | null>(null);
  const [armDisarmTime, setArmDisarmTime] = useState<Date | null>(null);

  const wsManagerRef = useRef<ReturnType<typeof createSecurityWSManager> | null>(null);
  const snapshotIntervalRef = useRef<NodeJS.Timer | null>(null);
  const alertTimeoutRef = useRef<NodeJS.Timer | null>(null);
  const fullscreenIntervalRef = useRef<NodeJS.Timer | null>(null);

  // Load cameras on mount
  useEffect(() => {
    const loadCameras = async () => {
      try {
        setLoading(true);
        const response = await axios.get('/api/security/cameras');
        const camerasList = response.data.cameras || [];
        setCameras(camerasList);

        // Load initial snapshots for all cameras
        camerasList.forEach((camera: Camera) => {
          loadCameraSnapshot(camera.id);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load cameras');
      } finally {
        setLoading(false);
      }
    };

    loadCameras();
  }, [setCameras, setLoading, setError]);

  // Load initial events
  useEffect(() => {
    const loadEvents = async () => {
      try {
        const response = await axios.get('/api/security/events?limit=50');
        // Events will be added individually via WebSocket
      } catch (err) {
        console.error('Failed to load events:', err);
      }
    };

    loadEvents();
  }, []);

  // Setup WebSocket connection
  useEffect(() => {
    const wsManager = createSecurityWSManager();
    wsManagerRef.current = wsManager;

    wsManager.on('motion_event', (message: MotionEventMessage) => {
      const newEvent = {
        id: `${Date.now()}`,
        timestamp: message.timestamp,
        camera_id: message.camera,
        confidence: message.confidence,
        thumbnail_url: message.thumbnail_url,
        narration: message.narration,
        created_at: new Date().toISOString(),
      };
      addEvent(newEvent);
      setLastMotionTime(new Date());

      // Trigger motion alert animation
      if (message.confidence > 0.7) {
        setMotionAlert(true);
        if (alertTimeoutRef.current) {
          clearTimeout(alertTimeoutRef.current);
        }
        alertTimeoutRef.current = setTimeout(() => setMotionAlert(false), 3000);

        // Play alert sound
        try {
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          oscillator.frequency.value = 800;
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.2);
        } catch (e) {
          console.log('Audio alert not supported');
        }
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
  }, [addEvent, setWsConnected]);

  // Refresh snapshots every 5 seconds for all cameras
  useEffect(() => {
    const interval = setInterval(() => {
      cameras.forEach((camera) => {
        loadCameraSnapshot(camera.id);
      });
    }, 5000);

    snapshotIntervalRef.current = interval;

    return () => {
      clearInterval(interval);
    };
  }, [cameras]);

  // Fullscreen camera auto-refresh every 3 seconds
  useEffect(() => {
    if (fullscreenCameraId) {
      fullscreenIntervalRef.current = setInterval(() => {
        loadCameraSnapshot(fullscreenCameraId);
      }, 3000);
    }

    return () => {
      if (fullscreenIntervalRef.current) {
        clearInterval(fullscreenIntervalRef.current);
      }
    };
  }, [fullscreenCameraId]);

  const loadCameraSnapshot = async (cameraId: string) => {
    try {
      const response = await axios.get(`/api/security/snapshot/${cameraId}`, {
        responseType: 'blob',
      });
      const blobUrl = URL.createObjectURL(response.data);
      setCameraSnapshots((prev) => {
        const updated = new Map(prev);
        updated.set(cameraId, {
          cameraId,
          snapshot: blobUrl,
          lastUpdated: Date.now(),
        });
        return updated;
      });
    } catch (err) {
      console.error(`Failed to load snapshot for camera ${cameraId}:`, err);
    }
  };

  const handleArmToggle = async (systemId: string = 'default') => {
    try {
      const currentArmed = armedSystems.get(systemId) ?? false;
      const response = await axios.post('/api/security/arm', {
        system_id: systemId,
        state: !currentArmed,
      });
      setArmed(systemId, response.data.armed);
      setArmDisarmTime(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to arm/disarm system');
    }
  };

  const isArmed = armedSystems.get('default') ?? false;
  const motionEvents = events.filter((e) => e.confidence > 0);
  const lastMotionEvent = motionEvents[0];

  const getConfidenceColor = (confidence: number) => {
    if (confidence > 0.9) return 'bg-obsidian-success';
    if (confidence > 0.7) return 'bg-obsidian-warning';
    return 'bg-obsidian-error';
  };

  const getConfidenceBgColor = (confidence: number) => {
    if (confidence > 0.9) return 'bg-green-900/30';
    if (confidence > 0.7) return 'bg-yellow-900/30';
    return 'bg-red-900/30';
  };

  return (
    <div className="h-full flex flex-col bg-obsidian-bg text-obsidian-text overflow-hidden">
      {/* Header */}
      <div className={`px-6 py-4 border-b transition-all glass-card ${
        motionAlert
          ? 'border-obsidian-error animate-pulse'
          : 'border-obsidian-border'
      }`}>
        <div className="flex items-center justify-between gap-4">
          {/* Left: ARM/DISARM Button + Status */}
          <div className="flex items-center gap-4">
            <Button
              onClick={() => handleArmToggle()}
              className={`px-6 py-2 rounded-lg font-bold transition transform active:scale-95 ${
                isArmed
                  ? 'bg-obsidian-error hover:bg-red-700 text-white shadow-lg shadow-red-900/50'
                  : 'bg-obsidian-success hover:bg-green-700 text-white shadow-lg shadow-green-900/50'
              }`}
            >
              {isArmed ? '🔒 ARM' : '🔓 DISARM'}
            </Button>

            <div className="flex items-center gap-3 px-4 py-2 bg-obsidian-surface-hover rounded-lg border border-obsidian-border">
              <Shield className={`w-5 h-5 ${isArmed ? 'text-obsidian-error' : 'text-obsidian-success'}`} />
              <span className="font-semibold">{isArmed ? 'ARMED' : 'DISARMED'}</span>
            </div>
          </div>

          {/* Center: Last Motion Time */}
          <div className="flex items-center gap-3 text-sm text-obsidian-text-muted">
            {lastMotionEvent && lastMotionTime ? (
              <>
                <Circle className="w-2 h-2 fill-obsidian-error text-obsidian-error" />
                <span>Last Motion: {formatDistanceToNow(lastMotionTime, { addSuffix: true })}</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-obsidian-success" />
                <span>All Clear</span>
              </>
            )}
          </div>

          {/* Right: Connection Status */}
          {wsConnected && (
            <Badge variant="success" className="text-xs">
              <span className="w-1.5 h-1.5 bg-obsidian-success rounded-full mr-1 animate-pulse"></span>
              Live
            </Badge>
          )}

          {motionAlert && (
            <Badge variant="destructive" className="text-xs animate-pulse">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Motion Detected
            </Badge>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col gap-4 p-4">
        {/* Camera Grid (Top 2/3) */}
        <div className="flex-1 overflow-hidden">
          <div className="grid grid-cols-2 gap-4 h-full auto-rows-max">
            {cameras.map((camera) => {
              const snapshot = cameraSnapshots.get(camera.id);
              const lastMotion = events
                .filter((e) => e.camera_id === camera.id)
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

              return (
                <div
                  key={camera.id}
                  onClick={() => setFullscreenCameraId(camera.id)}
                  className="group cursor-pointer rounded-xl overflow-hidden glass-card bg-black hover:shadow-lg hover:shadow-obsidian-accent/20 relative h-64 flex flex-col"
                >
                  {snapshot ? (
                    <>
                      <img
                        src={snapshot.snapshot}
                        alt={camera.name}
                        className="w-full h-full object-cover group-hover:brightness-110 transition-all"
                      />
                      {/* Glass overlay with info */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                        <h3 className="font-semibold text-white">{camera.name}</h3>
                        {lastMotion && (
                          <p className="text-xs text-gray-300 mt-1">
                            🔴 Motion: {formatDistanceToNow(new Date(lastMotion.timestamp), { addSuffix: true })}
                          </p>
                        )}
                      </div>
                      {/* Zoom indicator */}
                      <div className="absolute top-2 right-2 bg-black/50 backdrop-blur p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                        <ZoomIn className="w-4 h-4 text-white" />
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-obsidian-surface">
                      <Camera className="w-12 h-12 text-obsidian-text-muted opacity-50" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Motion Timeline (Bottom 1/3) */}
        <div className="h-1/3 glass-card rounded-xl overflow-hidden flex flex-col">
          {/* Timeline Header */}
          <div className="px-4 py-3 border-b border-obsidian-border flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-obsidian-error" />
              Motion Timeline
            </h3>
            <span className="text-xs text-obsidian-text-muted">{events.length} events</span>
          </div>

          {/* Timeline Events */}
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {events.length === 0 ? (
                <div className="text-center text-obsidian-text-muted text-sm py-4">
                  No motion events
                </div>
              ) : (
                events.map((event, index) => (
                  <div
                    key={event.id}
                    onClick={() => setSelectedEventForModal(event)}
                    className={`p-3 rounded-lg border transition cursor-pointer glass-card group ${
                      getConfidenceBgColor(event.confidence)} border-l-4 border-l-obsidian-error`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {/* Time and Icon */}
                        <div className="flex flex-col items-center gap-1 flex-shrink-0">
                          <span className="text-xs font-mono font-semibold">
                            {format(new Date(event.timestamp), 'HH:mm')}
                          </span>
                          <Circle className="w-2.5 h-2.5 fill-obsidian-error text-obsidian-error" />
                        </div>

                        {/* Event Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-obsidian-text truncate">
                              {event.camera_id} Motion
                            </span>
                            <Badge
                              variant="secondary"
                              className={`text-xs flex-shrink-0 ${getConfidenceBgColor(
                                event.confidence
                              )} text-white border-0`}
                            >
                              {(event.confidence * 100).toFixed(0)}%
                            </Badge>
                          </div>
                          {event.narration && (
                            <p className="text-xs text-obsidian-text-muted mt-1 truncate">
                              {event.narration}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Thumbnail */}
                      {event.thumbnail_url && (
                        <img
                          src={event.thumbnail_url}
                          alt="Event"
                          className="w-12 h-12 rounded-lg object-cover flex-shrink-0 group-hover:scale-110 transition-transform"
                        />
                      )}
                    </div>

                    {/* Confidence Bar */}
                    <div className="mt-2 h-1 bg-obsidian-border rounded-full overflow-hidden">
                      <div
                        className={`h-full ${getConfidenceColor(event.confidence)}`}
                        style={{ width: `${event.confidence * 100}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Fullscreen Camera Modal */}
      {fullscreenCameraId && (
        <Dialog open={!!fullscreenCameraId} onOpenChange={(open) => !open && setFullscreenCameraId(null)}>
          <DialogContent className="max-w-4xl bg-black border-obsidian-border p-0">
            <div className="relative w-full h-screen bg-black overflow-hidden">
              {/* Close Button */}
              <button
                onClick={() => setFullscreenCameraId(null)}
                className="absolute top-4 right-4 z-50 p-2 bg-black/50 hover:bg-black/70 rounded-lg transition-all"
              >
                <X className="w-5 h-5 text-white" />
              </button>

              {/* Refresh Button */}
              <button
                onClick={() => loadCameraSnapshot(fullscreenCameraId)}
                className="absolute top-4 left-4 z-50 p-2 bg-black/50 hover:bg-black/70 rounded-lg transition-all"
              >
                <RefreshCw className="w-5 h-5 text-white" />
              </button>

              {/* Camera Snapshot */}
              {cameraSnapshots.get(fullscreenCameraId) && (
                <>
                  <img
                    src={cameraSnapshots.get(fullscreenCameraId)!.snapshot}
                    alt="Fullscreen"
                    className="w-full h-full object-contain"
                  />
                  <p className="absolute bottom-4 left-4 text-xs text-gray-400">
                    {cameras.find((c) => c.id === fullscreenCameraId)?.name}
                  </p>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Event Thumbnail Modal */}
      {selectedEventForModal && (
        <Dialog open={!!selectedEventForModal} onOpenChange={(open) => !open && setSelectedEventForModal(null)}>
          <DialogContent className="max-w-2xl bg-obsidian-surface border-obsidian-border max-h-[90vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              {/* Thumbnail */}
              {selectedEventForModal.thumbnail_url && (
                <div className="rounded-lg overflow-hidden border border-obsidian-border bg-black">
                  <img
                    src={selectedEventForModal.thumbnail_url}
                    alt="Event thumbnail"
                    className="w-full h-auto object-contain"
                  />
                </div>
              )}

              {/* Event Details */}
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold">{selectedEventForModal.camera_id}</h2>
                  <p className="text-sm text-obsidian-text-muted mt-1">
                    {format(new Date(selectedEventForModal.timestamp), 'PPpp')}
                  </p>
                </div>

                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-obsidian-text-muted">Confidence</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-2 bg-obsidian-border rounded-full overflow-hidden">
                        <div
                          className={`h-full ${getConfidenceColor(selectedEventForModal.confidence)}`}
                          style={{ width: `${selectedEventForModal.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold">
                        {(selectedEventForModal.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                </div>

                {selectedEventForModal.narration && (
                  <div>
                    <p className="text-xs text-obsidian-text-muted mb-1">Description</p>
                    <p className="text-sm text-obsidian-text">{selectedEventForModal.narration}</p>
                  </div>
                )}

                {/* Nearby Events */}
                <div>
                  <p className="text-xs text-obsidian-text-muted mb-2">Nearby Events</p>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {events
                      .filter(
                        (e) =>
                          e.camera_id === selectedEventForModal.camera_id &&
                          e.id !== selectedEventForModal.id &&
                          Math.abs(
                            new Date(e.timestamp).getTime() - new Date(selectedEventForModal.timestamp).getTime()
                          ) < 5 * 60 * 1000 // Within 5 minutes
                      )
                      .slice(0, 3)
                      .map((e) => (
                        <div key={e.id} className="text-xs text-obsidian-text-muted py-1 border-b border-obsidian-border">
                          {format(new Date(e.timestamp), 'HH:mm:ss')} • {(e.confidence * 100).toFixed(0)}%
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Error Bar */}
      {error && (
        <div className="px-6 py-3 bg-obsidian-error/20 text-red-300 text-sm border-t border-obsidian-error/50 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
};

export default SecurityPanel;
