import { useTranslation } from 'react-i18next';
import { X, Sun, Moon, Monitor, RefreshCw, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { listProviders } from '../../services/providers/registry';
import { fetchModels, fetchServerConfig, testConnection, type ServerLLMConfig } from '../../services/providers/api';
import { MCPSettings, SkillsSettings } from './CapabilitySettings';

export function SettingsPanel() {
  const { t } = useTranslation();
  const showSettings = useSettingsStore((s) => s.showSettings);
  const setShowSettings = useSettingsStore((s) => s.setShowSettings);
  const config = useSettingsStore((s) => s.llmConfig);
  const updateConfig = useSettingsStore((s) => s.updateLLMConfig);
  const assistantProviderId = useSettingsStore((s) => s.assistantProviderId);
  const setAssistantProviderId = useSettingsStore((s) => s.setAssistantProviderId);
  const showSystemPrompts = useSettingsStore((s) => s.showSystemPrompts);
  const toggleSystemPrompts = useSettingsStore((s) => s.toggleSystemPrompts);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const providers = listProviders();
  const [loadingModels, setLoadingModels] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{ success: boolean; message: string } | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [serverConfig, setServerConfig] = useState<ServerLLMConfig | null>(null);
  const [serverConfigError, setServerConfigError] = useState('');
  const [assistantServerConfig, setAssistantServerConfig] = useState<ServerLLMConfig | null>(null);
  const [assistantConfigError, setAssistantConfigError] = useState('');
  const [activeSection, setActiveSection] = useState<'general' | 'skills' | 'mcp'>('general');
  const resolvedAssistantProviderId = assistantProviderId === 'same'
    ? config.providerId
    : assistantProviderId;

  useEffect(() => {
    if (!showSettings || config.providerId === 'mock') {
      setServerConfig(null);
      setServerConfigError('');
      return;
    }

    let cancelled = false;
    setServerConfig(null);
    setServerConfigError('');
    setModels([]);
    setConnectionResult(null);

    fetchServerConfig(config.providerId)
      .then((nextConfig) => {
        if (cancelled) return;
        setServerConfig(nextConfig);
        if (nextConfig.model && nextConfig.model !== config.model) {
          updateConfig({ model: nextConfig.model });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setServerConfigError(error instanceof Error ? error.message : t('settings.bffUnavailable'));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showSettings, config.providerId, config.model, updateConfig, t]);

  useEffect(() => {
    if (!showSettings || resolvedAssistantProviderId === 'mock') {
      setAssistantServerConfig(null);
      setAssistantConfigError(
        resolvedAssistantProviderId === 'mock' ? t('settings.assistantMockUnavailable') : '',
      );
      return;
    }

    let cancelled = false;
    setAssistantServerConfig(null);
    setAssistantConfigError('');
    fetchServerConfig(resolvedAssistantProviderId)
      .then((nextConfig) => {
        if (!cancelled) setAssistantServerConfig(nextConfig);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAssistantConfigError(error instanceof Error ? error.message : t('settings.bffUnavailable'));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showSettings, resolvedAssistantProviderId, t]);

  const handleFetchModels = useCallback(async () => {
    setLoadingModels(true);
    setConnectionResult(null);
    try {
      const fetchedModels = await fetchModels(config.providerId);
      setModels(fetchedModels);
    } catch (error) {
      setConnectionResult({
        success: false,
        message: error instanceof Error ? error.message : t('settings.fetchModelsFailed'),
      });
    } finally {
      setLoadingModels(false);
    }
  }, [config.providerId, t]);

  const handleTestConnection = useCallback(async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      const result = await testConnection(config.providerId);
      setConnectionResult(result);
    } finally {
      setTestingConnection(false);
    }
  }, [config.providerId]);

  if (!showSettings) return null;

  const labelClass = 'block text-xs font-medium mb-1';
  const inputClass =
    'w-full bg-surface-800 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:border-accent-500/50 focus:outline-none transition-colors';

  const themeOptions = [
    { value: 'light' as const, icon: Sun, label: t('settings.themeLight') },
    { value: 'dark' as const, icon: Moon, label: t('settings.themeDark') },
    { value: 'system' as const, icon: Monitor, label: t('settings.themeSystem') },
  ];

  return (
    <div className="absolute top-0 right-0 z-50 h-full w-[380px] max-w-[calc(100vw-1rem)] bg-surface-900 border-l border-border shadow-2xl shadow-black/50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-text-primary">{t('settings.title')}</h2>
        <button
          onClick={() => setShowSettings(false)}
          className="text-text-secondary hover:text-text-primary transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1 border-b border-border bg-surface-900 px-3 py-2">
        {(['general', 'skills', 'mcp'] as const).map((section) => (
          <button
            type="button"
            key={section}
            onClick={() => setActiveSection(section)}
            className={`rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${activeSection === section ? 'bg-accent-500/15 text-accent-300' : 'text-text-muted hover:bg-surface-800 hover:text-text-primary'}`}
          >
            {t(`settings.section${section.charAt(0).toUpperCase()}${section.slice(1)}`)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {activeSection === 'general' && <>
        {/* Theme Section */}
        <div className="border-b border-border pb-4">
          <h3 className="text-xs font-semibold text-text-secondary mb-3">{t('settings.theme')}</h3>
          <div className="flex gap-2">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setTheme(option.value)}
                className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                  theme === option.value
                    ? 'border-accent-500 bg-accent-500/10 text-accent-400'
                    : 'border-border bg-surface-800 text-text-secondary hover:border-border-hover'
                }`}
              >
                <option.icon size={18} />
                <span className="text-[10px] font-medium">{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Model routing */}
        <section>
          <div className="mb-2">
            <h3 className="text-xs font-semibold text-text-secondary">{t('settings.modelRouting')}</h3>
            <p className="text-[10px] text-text-muted mt-1">{t('settings.modelRoutingDescription')}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface-800/60 p-3 space-y-3">
            <div>
              <label className={labelClass}>{t('settings.nodeChatProvider')}</label>
              <select
                value={config.providerId}
                onChange={(e) => updateConfig({ providerId: e.target.value })}
                className={inputClass}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
                <span className="text-text-muted truncate">
                  {config.providerId === 'mock'
                    ? t('settings.localMockMode')
                    : serverConfig
                      ? `${serverConfig.endpointHost} · ${serverConfig.model || t('settings.noModelConfigured')}`
                      : serverConfigError || t('settings.loadingServerConfig')}
                </span>
                {config.providerId !== 'mock' && serverConfig && (
                  <span className={serverConfig.configured ? 'text-green-400' : 'text-amber-400'}>
                    {serverConfig.configured ? t('settings.ready') : t('settings.notConfigured')}
                  </span>
                )}
              </div>
            </div>

            <div className="h-px bg-border" />

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="text-xs font-medium">{t('settings.assistantProvider')}</label>
                {assistantProviderId === 'same' && (
                  <span className="rounded-full bg-accent-500/10 px-2 py-0.5 text-[10px] text-accent-400">
                    {t('settings.followsNodeChat')}
                  </span>
                )}
              </div>
              <select
                value={assistantProviderId}
                onChange={(e) => setAssistantProviderId(e.target.value)}
                className={inputClass}
              >
                <option value="same">{t('settings.sameAsNodeChat')}</option>
                {providers.filter((provider) => provider.id !== 'mock').map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
                <span className={assistantConfigError ? 'text-amber-400 truncate' : 'text-text-muted truncate'}>
                  {assistantServerConfig
                    ? `${assistantServerConfig.endpointHost} · ${assistantServerConfig.model || t('settings.noModelConfigured')}`
                    : assistantConfigError || t('settings.loadingServerConfig')}
                </span>
                {assistantServerConfig && (
                  <span className={assistantServerConfig.configured ? 'text-green-400' : 'text-amber-400'}>
                    {assistantServerConfig.configured ? t('settings.ready') : t('settings.notConfigured')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Server connection */}
        {config.providerId !== 'mock' && (
          <section>
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-xs font-semibold text-text-secondary">{t('settings.serverConnection')}</h3>
              <span className={`flex items-center gap-1 text-xs ${serverConfig?.configured ? 'text-green-400' : 'text-amber-400'}`}>
                {serverConfig?.configured ? <CheckCircle size={12} /> : <XCircle size={12} />}
                {serverConfig?.configured ? t('settings.configured') : t('settings.notConfigured')}
              </span>
            </div>
            <div className="rounded-xl border border-border bg-surface-800/60 p-3 space-y-3">
              {serverConfig && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-surface-900/70 px-3 py-2">
                    <div className="text-[10px] text-text-muted">{t('settings.endpoint')}</div>
                    <div className="mt-0.5 truncate text-xs text-text-primary">{serverConfig.endpointHost}</div>
                  </div>
                  <div className="rounded-lg bg-surface-900/70 px-3 py-2">
                    <div className="text-[10px] text-text-muted">{t('settings.model')}</div>
                    <div className="mt-0.5 truncate text-xs text-text-primary">{serverConfig.model || t('settings.noModelConfigured')}</div>
                  </div>
                  <div className="col-span-2 flex items-center justify-between rounded-lg bg-surface-900/70 px-3 py-2 text-xs">
                    <span className="text-text-muted">{t('settings.apiKey')}</span>
                    <span className={serverConfig.configured ? 'text-green-400' : 'text-amber-400'}>
                      {serverConfig.configured ? t('settings.configuredOnServer') : t('settings.missingOnServer')}
                    </span>
                  </div>
                </div>
              )}
              {serverConfigError && <p className="text-[10px] text-red-400">{serverConfigError}</p>}

              <div className="flex gap-2">
                <button
                  onClick={handleTestConnection}
                  disabled={!serverConfig?.configured || testingConnection}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-surface-700 px-3 py-2 text-xs transition-colors hover:bg-surface-600 disabled:opacity-50"
                >
                  {testingConnection ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : connectionResult?.success ? (
                    <CheckCircle size={12} className="text-green-400" />
                  ) : connectionResult?.success === false ? (
                    <XCircle size={12} className="text-red-400" />
                  ) : null}
                  {t('settings.testConnection')}
                </button>
                {config.providerId !== 'anthropic' && (
                  <button
                    onClick={handleFetchModels}
                    disabled={!serverConfig?.configured || loadingModels}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-surface-700 px-3 py-2 text-xs transition-colors hover:bg-surface-600 disabled:opacity-50"
                  >
                    {loadingModels ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {t('settings.fetchModels')}
                  </button>
                )}
              </div>

              {connectionResult && (
                <p className={`text-[10px] ${connectionResult.success ? 'text-green-400' : 'text-red-400'}`}>
                  {connectionResult.message}
                </p>
              )}
              {models.length > 0 && (
                <p className="text-[10px] text-text-muted break-words">
                  {t('settings.availableModels', { count: models.length })}: {models.slice(0, 5).map((model) => model.id).join(', ')}
                  {models.length > 5 ? '…' : ''}
                </p>
              )}
              <p className="text-[10px] text-text-muted">{t('settings.serverConfigDescription')}</p>
            </div>
          </section>
        )}

        {/* Generation settings */}
        {config.providerId !== 'mock' && (
          <section>
            <h3 className="text-xs font-semibold text-text-secondary mb-2">{t('settings.generation')}</h3>
            <div className="rounded-xl border border-border bg-surface-800/60 p-3 space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <label className="font-medium">{t('settings.temperature')}</label>
                  <span className="text-text-muted">{config.temperature}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={config.temperature}
                  onChange={(e) => updateConfig({ temperature: parseFloat(e.target.value) })}
                  className="w-full accent-accent-500"
                />
              </div>
              <div>
                <label className={labelClass}>{t('settings.maxTokens')}</label>
                <input
                  type="number"
                  value={config.maxTokens}
                  onChange={(e) => updateConfig({ maxTokens: parseInt(e.target.value) || 2048 })}
                  className={inputClass}
                />
              </div>
            </div>
          </section>
        )}

        {/* Mock Provider Config */}
        {config.providerId === 'mock' && (
          <div>
            <label className={labelClass}>{t('settings.tokenDelay')}</label>
            <input
              type="number"
              value={config.mockDelay}
              onChange={(e) =>
                updateConfig({ mockDelay: parseInt(e.target.value) || 30 })
              }
              className={inputClass}
              min="5"
              max="500"
            />
            <p className="text-xs text-text-muted mt-1">
              {t('settings.tokenDelayDescription')}
            </p>
          </div>
        )}

        {/* Display Settings */}
        <div className="border-t border-border pt-4">
          <h3 className="text-xs font-semibold text-text-secondary mb-3">{t('settings.display')}</h3>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs text-text-secondary">{t('settings.showSystemPrompts')}</span>
            <button
              onClick={toggleSystemPrompts}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                showSystemPrompts ? 'bg-accent-500' : 'bg-surface-700'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  showSystemPrompts ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </label>
          <p className="text-[10px] text-text-muted mt-1">
            {t('settings.showSystemPromptsDescription')}
          </p>
        </div>

        {/* Language Settings */}
        <div className="border-t border-border pt-4">
          <h3 className="text-xs font-semibold text-text-secondary mb-3">Language</h3>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className={inputClass}
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </div>
        </>}
        {activeSection === 'skills' && <SkillsSettings />}
        {activeSection === 'mcp' && <MCPSettings />}
      </div>

      <div className="px-4 py-3 border-t border-border">
        <p className="text-[10px] text-text-muted text-center">
          {t('settings.savedToLocalStorage')}
        </p>
      </div>
    </div>
  );
}
