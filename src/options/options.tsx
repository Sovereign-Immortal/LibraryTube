import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { UserSettings } from '../shared/types';
import { clearCache } from '../shared/db';
import './options.css';

const DEFAULT_SETTINGS: UserSettings = {
  provider: 'gemini',
  apiKey: 'AQ.Ab8RN6J1bTyIMAnl8562LdYSyvadcicZiyXpU5_eZt6zzNhnfQ',
  theme: 'auto',
  customCritiquePrompt: ''
};

const Options: React.FC = () => {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<{ message: string; isError: boolean; show: boolean }>({
    message: '',
    isError: false,
    show: false
  });

  useEffect(() => {
    // Load settings from storage
    chrome.storage.local.get(['settings'], (result) => {
      const loaded = { ...DEFAULT_SETTINGS, ...result?.settings };
      setSettings(loaded);
    });
  }, []);

  // Update HTML data-theme attribute
  useEffect(() => {
    const isDark = settings.theme === 'dark' || 
      (settings.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [settings.theme]);

  const showToast = (message: string, isError = false) => {
    setToast({ message, isError, show: true });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 3000);
  };

  const handleSave = () => {
    chrome.storage.local.set({ settings }, () => {
      showToast('Settings saved successfully!');
    });
  };

  const handleClearCache = async () => {
    if (confirm('Are you sure you want to clear the local video transcript and summary cache?')) {
      await clearCache();
      showToast('Cache cleared successfully!');
    }
  };

  const toggleTheme = () => {
    const themes: UserSettings['theme'][] = ['light', 'dark', 'auto'];
    const nextIndex = (themes.indexOf(settings.theme) + 1) % themes.length;
    const nextTheme = themes[nextIndex] || 'auto';
    setSettings(prev => ({ ...prev, theme: nextTheme }));
  };

  return (
    <div className="settings-container">
      <div className="header">
        <div className="title-section">
          <h1>LibroTube</h1>
          <p>Configure your reading environment & AI settings</p>
        </div>
        <button className="theme-toggle" onClick={toggleTheme} title={`Current theme: ${settings.theme}`}>
          {settings.theme === 'light' && '☀️ Light'}
          {settings.theme === 'dark' && '🌙 Dark'}
          {settings.theme === 'auto' && '🖥️ System'}
        </button>
      </div>

      <div className="form-group">
        <label htmlFor="apiKey">Google AI Studio API Key</label>
        <input
          id="apiKey"
          type="password"
          placeholder="Enter your Gemini API Key"
          value={settings.apiKey}
          onChange={(e) => setSettings(prev => ({ ...prev, apiKey: e.target.value }))}
        />
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.5rem', fontStyle: 'italic' }}>
          Gemini is used to transcribe videos (as a fallback if captions fail) and generate summaries/critiques.
        </p>
      </div>

      <div className="form-group">
        <label htmlFor="critiquePrompt">Custom Critique Focus (Optional)</label>
        <textarea
          id="critiquePrompt"
          placeholder="e.g. Pay special attention to hidden corporate sponsorships or technical hand-waving."
          value={settings.customCritiquePrompt || ''}
          onChange={(e) => setSettings(prev => ({ ...prev, customCritiquePrompt: e.target.value }))}
        />
      </div>

      <div className="button-group">
        <button className="btn-primary" onClick={handleSave}>Save Settings</button>
        <button className="btn-secondary" onClick={handleClearCache}>Clear Cache</button>
      </div>

      <div className={`toast ${toast.show ? 'show' : ''} ${toast.isError ? 'error' : ''}`}>
        <span>{toast.message}</span>
      </div>
    </div>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <Options />
    </React.StrictMode>
  );
}
