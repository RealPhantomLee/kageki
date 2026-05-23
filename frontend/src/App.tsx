import React, { useState, useEffect, useCallback } from "react";
import { useAppStore } from "./stores/appStore";
import { HomePanel } from "./panels/HomePanel";
import { NotesPanel } from "./panels/NotesPanel";
import { SecurityPanel } from "./panels/SecurityPanel";
import { InfraPanel } from "./panels/InfraPanel";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

interface HealthStatus {
  backendHealthy: boolean;
  haConnected: boolean;
}

export const App: React.FC = () => {
  const { activeTab, setActiveTab } = useAppStore();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [menuOpen, setMenuOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isPWAInstalled, setIsPWAInstalled] = useState(false);
  const [health, setHealth] = useState<HealthStatus>({
    backendHealthy: false,
    haConnected: false,
  });
  const [touchStartX, setTouchStartX] = useState(0);
  const [touchEndX, setTouchEndX] = useState(0);

  // Handle window resize for responsive layout
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Handle keyboard shortcuts (desktop)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !isMobile) {
        const tabMap: Record<string, "home" | "notes" | "security" | "infrastructure"> = {
          '1': 'home',
          '2': 'notes',
          '3': 'security',
          '4': 'infrastructure',
        };

        if (tabMap[e.key]) {
          e.preventDefault();
          setActiveTab(tabMap[e.key]);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, setActiveTab]);

  // Handle swipe navigation (mobile)
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    setTouchEndX(e.changedTouches[0].clientX);

    const tabOrder: ("home" | "notes" | "security" | "infrastructure")[] = [
      "home",
      "notes",
      "security",
      "infrastructure",
    ];

    const currentIndex = tabOrder.indexOf(activeTab as any);
    const swipeDistance = touchStartX - touchEndX;

    // Swipe left (move to next tab)
    if (swipeDistance > 50 && currentIndex < tabOrder.length - 1) {
      setActiveTab(tabOrder[currentIndex + 1]);
      setMenuOpen(false);
    }

    // Swipe right (move to previous tab)
    if (swipeDistance < -50 && currentIndex > 0) {
      setActiveTab(tabOrder[currentIndex - 1]);
      setMenuOpen(false);
    }
  };

  // Handle PWA install prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsPWAInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsPWAInstalled(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  // Request notification permissions
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Poll health endpoint every 10 seconds
  useEffect(() => {
    const pollHealth = async () => {
      try {
        const response = await fetch("/health");
        const isHealthy = response.status === 200;

        if (isHealthy) {
          const data = await response.json();
          setHealth({
            backendHealthy: data.status === "ok",
            haConnected: data.home_assistant_available || false,
          });
        } else {
          setHealth({
            backendHealthy: false,
            haConnected: false,
          });
        }
      } catch (err) {
        console.error("Health check failed:", err);
        setHealth({
          backendHealthy: false,
          haConnected: false,
        });
      }
    };

    // Poll immediately and then every 10 seconds
    pollHealth();
    const interval = setInterval(pollHealth, 10000);

    return () => clearInterval(interval);
  }, []);

  const handleInstallApp = useCallback(async () => {
    if (!installPrompt) return;

    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;

      if (outcome === "accepted") {
        setInstallPrompt(null);
        setIsPWAInstalled(true);
      }
    } catch (err) {
      console.error("Error installing app:", err);
    }
  }, [installPrompt]);

  const handleTabChange = (tab: "home" | "notes" | "security" | "infrastructure") => {
    setActiveTab(tab);
    setMenuOpen(false);
  };

  const renderPanel = () => {
    switch (activeTab) {
      case "home":
        return <HomePanel />;
      case "notes":
        return <NotesPanel />;
      case "security":
        return <SecurityPanel />;
      case "infrastructure":
        return <InfraPanel />;
      default:
        return <HomePanel />;
    }
  };

  const navItems = [
    { id: "home", label: "Home", icon: "🏠" },
    { id: "notes", label: "Notes", icon: "📝" },
    { id: "security", label: "Security", icon: "🔒" },
    { id: "infrastructure", label: "Infrastructure", icon: "⚡" },
  ] as const;

  if (isMobile) {
    return (
      <div
        className="flex flex-col h-screen bg-obsidian-bg text-obsidian-text"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Mobile Header */}
        <div className="glass-card px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold">Phantom</h1>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 hover:bg-obsidian-surface-hover rounded transition"
          >
            ☰
          </button>
        </div>

        {/* Mobile Menu */}
        {menuOpen && (
          <div className="bg-obsidian-surface-hover border-b border-obsidian-border">
            <div className="flex flex-col">
              {navItems.map(({ id, label, icon }) => (
                <button
                  key={id}
                  onClick={() => handleTabChange(id as "home" | "notes" | "security" | "infrastructure")}
                  className={`px-4 py-3 text-left transition ${
                    activeTab === id
                      ? "bg-obsidian-accent text-white font-semibold"
                      : "hover:bg-obsidian-border"
                  }`}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Install Prompt */}
        {installPrompt && !isPWAInstalled && (
          <div className="bg-obsidian-accent/20 border-b border-obsidian-accent px-4 py-2 flex items-center justify-between">
            <span className="text-sm">Install Phantom Portal as an app</span>
            <div className="flex gap-2">
              <button
                onClick={handleInstallApp}
                className="bg-obsidian-accent hover:bg-obsidian-accent-light px-3 py-1 rounded text-sm transition"
              >
                Install
              </button>
              <button
                onClick={() => setInstallPrompt(null)}
                className="text-obsidian-text-muted hover:text-obsidian-text transition"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Main Content - Full Width on Mobile */}
        <div className="flex-1 overflow-hidden">
          {renderPanel()}
        </div>

        {/* Mobile Footer - Always Visible */}
        <div className="glass-card border-t border-obsidian-border grid grid-cols-4 gap-1 p-2">
          {navItems.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id as "home" | "notes" | "security" | "infrastructure")}
              className={`py-2 px-3 rounded transition flex flex-col items-center gap-1 ${
                activeTab === id
                  ? "bg-obsidian-accent text-white font-semibold"
                  : "text-obsidian-text-muted hover:text-obsidian-text hover:bg-obsidian-surface-hover"
              }`}
            >
              <span className="text-lg">{icon}</span>
              <span className="text-xs">{label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Desktop Layout - Narrow Icon Sidebar + Main Content
  return (
    <div className="flex h-screen bg-obsidian-bg text-obsidian-text">
      {/* Left Icon Sidebar - Narrow */}
      <div className="w-20 glass-card border-r border-obsidian-border flex flex-col items-center py-4 gap-4">
        {/* Logo */}
        <div className="w-12 h-12 rounded-lg bg-obsidian-accent flex items-center justify-center text-white font-bold text-lg mb-2">
          P
        </div>

        {/* Navigation Icons */}
        <nav className="flex flex-col gap-2">
          {navItems.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id as "home" | "notes" | "security" | "infrastructure")}
              className={`w-12 h-12 rounded-lg flex items-center justify-center transition-all relative group ${
                activeTab === id
                  ? "bg-obsidian-accent text-white"
                  : "text-obsidian-text-muted hover:bg-obsidian-surface-hover hover:text-obsidian-text"
              }`}
              title={label}
            >
              <span className="text-xl">{icon}</span>
              {/* Tooltip */}
              <span className="absolute left-16 bg-obsidian-surface border border-obsidian-border text-obsidian-text text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                {label}
              </span>
            </button>
          ))}
        </nav>

        {/* Spacer */}
        <div className="flex-1"></div>

        {/* Footer Icons */}
        <div className="flex flex-col gap-3">
          <button
            className="w-12 h-12 rounded-lg text-obsidian-text-muted hover:bg-obsidian-surface-hover hover:text-obsidian-text transition text-xl"
            title="Settings"
          >
            ⚙️
          </button>
          <button
            className="w-12 h-12 rounded-lg text-obsidian-text-muted hover:bg-obsidian-surface-hover hover:text-obsidian-text transition text-xl"
            title="About"
          >
            ℹ️
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Status Bar */}
        <div className="glass-card px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold text-obsidian-text">Phantom Portal</h1>
            <div className="text-sm text-obsidian-text-muted">
              {new Date().toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Status Indicators */}
            <div className="flex items-center gap-2 px-3 py-1 bg-obsidian-surface-hover rounded-full text-xs">
              <span className="w-2 h-2 bg-obsidian-success rounded-full animate-pulse"></span>
              <span className="text-obsidian-text-muted">API</span>
            </div>
            {isPWAInstalled && (
              <span className="text-xs bg-obsidian-accent/20 text-obsidian-accent px-2 py-1 rounded-full">
                PWA
              </span>
            )}
            {Notification.permission === "granted" && (
              <span className="text-xs bg-obsidian-accent/20 text-obsidian-accent px-2 py-1 rounded-full">
                Notifications
              </span>
            )}
          </div>
        </div>

        {/* Panel Content */}
        <div className="flex-1 overflow-hidden">
          {renderPanel()}
        </div>

        {/* Bottom Status Bar - Real Status Info */}
        <div className="glass-card px-6 py-2 flex items-center justify-between text-xs text-obsidian-text-muted">
          <div className="flex gap-6">
            <div className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${health.backendHealthy ? 'bg-obsidian-success' : 'bg-obsidian-error'}`}></span>
              <span>Backend: {health.backendHealthy ? 'OK' : 'Degraded'}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${health.haConnected ? 'bg-obsidian-success' : 'bg-obsidian-error'}`}></span>
              <span>HA: {health.haConnected ? 'Connected' : 'Unavailable'}</span>
            </div>
          </div>
          <div className="text-obsidian-text-muted">
            {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>
    </div>
  );
};
