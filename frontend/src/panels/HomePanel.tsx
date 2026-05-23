import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useHomeAssistantStore } from '../stores/homeassistant';
import type { HomeAssistantDevice } from '../types/index';

export const HomePanel: React.FC = () => {
  const {
    devices,
    scenes,
    loading,
    error,
    lastUpdated,
    setLoading,
    setError,
    loadDevices,
    updateDevice,
    toggleSwitch,
    setLightState,
    activateScene,
  } = useHomeAssistantStore();

  const [controllingDevices, setControllingDevices] = useState<Set<string>>(new Set());
  const refreshIntervalRef = useRef<NodeJS.Timer | null>(null);

  // Load devices on mount
  useEffect(() => {
    loadDevices().catch((err) => {
      console.error('Failed to load Home Assistant devices:', err);
    });
  }, [loadDevices]);

  // Setup auto-refresh every 30 seconds
  useEffect(() => {
    refreshIntervalRef.current = setInterval(() => {
      loadDevices().catch((err) => {
        console.error('Auto-refresh failed:', err);
      });
    }, 30000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [loadDevices]);

  const handleLightControl = useCallback(
    async (entityId: string, newState: boolean) => {
      try {
        setControllingDevices((prev) => new Set(prev).add(entityId));
        await setLightState(entityId, newState);
      } catch (err) {
        console.error('Failed to control light:', err);
      } finally {
        setControllingDevices((prev) => {
          const next = new Set(prev);
          next.delete(entityId);
          return next;
        });
      }
    },
    [setLightState]
  );

  const handleBrightnessChange = useCallback(
    async (entityId: string, brightness: number) => {
      try {
        setControllingDevices((prev) => new Set(prev).add(entityId));
        await setLightState(entityId, true, brightness);
      } catch (err) {
        console.error('Failed to set brightness:', err);
      } finally {
        setControllingDevices((prev) => {
          const next = new Set(prev);
          next.delete(entityId);
          return next;
        });
      }
    },
    [setLightState]
  );

  const handleSwitchControl = useCallback(
    async (entityId: string) => {
      try {
        setControllingDevices((prev) => new Set(prev).add(entityId));
        await toggleSwitch(entityId);
      } catch (err) {
        console.error('Failed to toggle switch:', err);
      } finally {
        setControllingDevices((prev) => {
          const next = new Set(prev);
          next.delete(entityId);
          return next;
        });
      }
    },
    [toggleSwitch]
  );

  const handleSceneActivation = useCallback(
    async (sceneId: string) => {
      try {
        setControllingDevices((prev) => new Set(prev).add(sceneId));
        await activateScene(sceneId);
      } catch (err) {
        console.error('Failed to activate scene:', err);
      } finally {
        setControllingDevices((prev) => {
          const next = new Set(prev);
          next.delete(sceneId);
          return next;
        });
      }
    },
    [activateScene]
  );

  const lights = devices.filter((d) => d.type === 'light');
  const switches = devices.filter((d) => d.type === 'switch');
  const otherDevices = devices.filter((d) => d.type !== 'light' && d.type !== 'switch');

  if (loading && devices.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-obsidian-bg">
        <div className="text-obsidian-text-muted">Loading Home Assistant devices...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-obsidian-bg text-obsidian-text">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
            </svg>
            Home
          </h2>
          <button
            onClick={() => loadDevices()}
            className="px-3 py-1 text-sm bg-obsidian-accent hover:bg-obsidian-accent-light rounded transition"
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        {lastUpdated && (
          <div className="text-xs text-gray-500 mt-2">
            Updated {new Date(lastUpdated).toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="px-4 py-2 bg-red-600/20 text-red-200 text-sm border-b border-red-600/50">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto h-full p-4 space-y-6">
        {/* Lights Section */}
        {lights.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.343a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM15.657 14.657a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM11 17a1 1 0 102 0v-1a1 1 0 10-2 0v1zM5.343 15.657a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM2 10a1 1 0 011-1h1a1 1 0 110 2H3a1 1 0 01-1-1zM5.343 5.343a1 1 0 00-1.414 1.414l.707.707a1 1 0 001.414-1.414l-.707-.707z" />
              </svg>
              Lights
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {lights.map((light) => (
                <LightCard
                  key={light.entity_id}
                  light={light}
                  onToggle={handleLightControl}
                  onBrightnessChange={handleBrightnessChange}
                  isControlling={controllingDevices.has(light.entity_id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Switches Section */}
        {switches.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M6.672 1.911a1 1 0 10-1.932.518l.259.966a1 1 0 001.932-.518l-.259-.966zM2.429 4.74a1 1 0 10-.517 1.932l.966.259a1 1 0 00.517-1.932l-.966-.259zm14.514 10.986a1 1 0 10.517 1.932l.966-.259a1 1 0 00-.517-1.932l-.966.259zM16.25 7a1 1 0 11-2 0 1 1 0 012 0zm-4 8a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
              Switches
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {switches.map((switchDev) => (
                <SwitchCard
                  key={switchDev.entity_id}
                  device={switchDev}
                  onToggle={handleSwitchControl}
                  isControlling={controllingDevices.has(switchDev.entity_id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Scenes Section */}
        {scenes.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
              </svg>
              Scenes
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {scenes.map((scene) => (
                <button
                  key={scene.id}
                  onClick={() => handleSceneActivation(scene.id)}
                  disabled={controllingDevices.has(scene.id)}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-3 rounded-lg transition font-medium"
                >
                  {controllingDevices.has(scene.id) ? 'Activating...' : scene.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Other Devices */}
        {otherDevices.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold mb-3">Other Devices</h3>
            <div className="space-y-2">
              {otherDevices.map((device) => (
                <div
                  key={device.entity_id}
                  className="glass-card rounded p-3 flex items-center justify-between"
                >
                  <div>
                    <div className="font-medium">{device.name}</div>
                    <div className="text-xs text-obsidian-text-muted">{device.entity_id}</div>
                  </div>
                  <div className="text-sm text-obsidian-text-muted">{device.state}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {devices.length === 0 && (
          <div className="text-center text-gray-500 py-8">
            No devices available
          </div>
        )}
      </div>
    </div>
  );
};

interface LightCardProps {
  light: HomeAssistantDevice;
  onToggle: (entityId: string, state: boolean) => Promise<void>;
  onBrightnessChange: (entityId: string, brightness: number) => Promise<void>;
  isControlling: boolean;
}

const LightCard: React.FC<LightCardProps> = ({
  light,
  onToggle,
  onBrightnessChange,
  isControlling,
}) => {
  const isOn = light.state === 'on';
  const brightness = light.attributes?.brightness ?? 255;

  return (
    <div className="glass-card rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{light.name}</div>
          <div className="text-xs text-gray-500">{light.entity_id}</div>
        </div>
        <button
          onClick={() => onToggle(light.entity_id, !isOn)}
          disabled={isControlling}
          className={`px-3 py-1 rounded text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
            isOn
              ? 'bg-obsidian-accent hover:bg-obsidian-accent-light text-white'
              : 'bg-obsidian-border hover:bg-obsidian-surface-hover text-obsidian-text'
          }`}
        >
          {isOn ? 'On' : 'Off'}
        </button>
      </div>

      {isOn && (
        <div className="space-y-2">
          <label className="text-xs text-obsidian-text-muted">Brightness</label>
          <input
            type="range"
            min="0"
            max="255"
            value={brightness}
            onChange={(e) => onBrightnessChange(light.entity_id, parseInt(e.target.value))}
            disabled={isControlling}
            className="w-full h-2 bg-obsidian-border rounded-lg appearance-none cursor-pointer"
          />
          <div className="text-xs text-obsidian-text-muted text-right">
            {((brightness / 255) * 100).toFixed(0)}%
          </div>
        </div>
      )}
    </div>
  );
};

interface SwitchCardProps {
  device: HomeAssistantDevice;
  onToggle: (entityId: string) => Promise<void>;
  isControlling: boolean;
}

const SwitchCard: React.FC<SwitchCardProps> = ({ device, onToggle, isControlling }) => {
  const isOn = device.state === 'on';

  return (
    <div className="glass-card rounded-lg p-4 flex items-center justify-between">
      <div>
        <div className="font-medium">{device.name}</div>
        <div className="text-xs text-gray-500">{device.entity_id}</div>
      </div>
      <button
        onClick={() => onToggle(device.entity_id)}
        disabled={isControlling}
        className={`px-4 py-2 rounded font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
          isOn
            ? 'bg-obsidian-success hover:bg-green-700 text-white'
            : 'bg-obsidian-border hover:bg-obsidian-surface-hover text-obsidian-text'
        }`}
      >
        {isOn ? 'On' : 'Off'}
      </button>
    </div>
  );
};

export default HomePanel;
