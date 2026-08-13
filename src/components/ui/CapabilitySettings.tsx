import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle, Clock3, Loader2, RefreshCw, Server, ShieldCheck, Wrench } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import {
  fetchMCPServers,
  fetchSkills,
  setMCPEnabled,
  setSkillEnabled,
  testMCPServer,
  type MCPServerItem,
  type SkillCatalogItem,
  type SkillUsageItem,
} from '../../services/capabilitiesApi';

function Toggle({ enabled, disabled, onChange }: { enabled: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button type="button" disabled={disabled} aria-pressed={enabled} onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${enabled ? 'bg-accent-500' : 'bg-surface-700'}`}>
      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : ''}`} />
    </button>
  );
}

function EmptyWorkspace() {
  const { t } = useTranslation();
  return <p className="rounded-xl border border-border bg-surface-800/60 p-4 text-xs text-text-muted">{t('settings.capabilitiesNeedWorkspace')}</p>;
}

export function SkillsSettings() {
  const { t } = useTranslation();
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const [skills, setSkills] = useState<SkillCatalogItem[]>([]);
  const [usage, setUsage] = useState<SkillUsageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true); setError('');
    try { const result = await fetchSkills(workspaceId); setSkills(result.skills); setUsage(result.usage); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { void refresh(); }, [refresh]);
  if (!workspaceId) return <EmptyWorkspace />;
  return <section className="space-y-3">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-xs font-semibold text-text-primary">{t('settings.skillsTitle')}</h3><p className="mt-1 text-[10px] leading-4 text-text-muted">{t('settings.skillsDescription')}</p></div><button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-border p-2 text-text-secondary hover:text-text-primary disabled:opacity-40" aria-label={t('common.refresh')}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button></div>
    {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[10px] text-red-300">{error}</p>}
    {!loading && !skills.length && <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-text-muted">{t('settings.noSkills')}</p>}
    {skills.map((skill) => { const latest = usage.find((record) => record.name === skill.name && record.source === skill.source); return <article key={`${skill.source}:${skill.name}`} className="rounded-xl border border-border bg-surface-800/60 p-3"><div className="flex items-start gap-3"><div className="mt-0.5 rounded-lg bg-accent-500/10 p-2 text-accent-400"><Wrench size={14} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h4 className="truncate text-xs font-semibold text-text-primary">${skill.name}</h4><span className="rounded-full bg-surface-700 px-2 py-0.5 text-[9px] text-text-muted">{skill.source}</span></div><p className="mt-1 text-[10px] leading-4 text-text-secondary">{skill.description || t('settings.invalidSkill')}</p>{Boolean(skill.shadows?.length) && <p className="mt-1 text-[9px] text-amber-300">{t('settings.skillOverrides', { sources: skill.shadows?.join(', ') })}</p>}{skill.error && <p className="mt-2 flex gap-1 text-[10px] text-red-300"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{skill.error}</p>}{latest && <p className="mt-2 flex items-center gap-1 text-[9px] text-text-muted"><Clock3 size={10} /> {t('settings.lastUsedBy', { agent: latest.agentType, time: new Date(latest.activatedAt).toLocaleString() })}</p>}</div><Toggle enabled={skill.enabled} disabled={Boolean(skill.error) || busy === skill.name} onChange={() => { setBusy(skill.name); void setSkillEnabled(workspaceId, skill.name, !skill.enabled).then(() => refresh()).catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError))).finally(() => setBusy('')); }} /></div></article>; })}
    <div className="rounded-xl border border-border bg-surface-800/40 p-3 text-[10px] leading-4 text-text-muted">{t('settings.skillsCliHint')} <code className="text-accent-300">meshcli skill add &lt;path-or-git-url&gt;</code></div>
  </section>;
}

export function MCPSettings() {
  const { t } = useTranslation();
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const [servers, setServers] = useState<MCPServerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => { if (!workspaceId) return; setLoading(true); setError(''); try { setServers((await fetchMCPServers(workspaceId)).servers); } catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); } finally { setLoading(false); } }, [workspaceId]);
  useEffect(() => { void refresh(); }, [refresh]);
  if (!workspaceId) return <EmptyWorkspace />;
  return <section className="space-y-3">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-xs font-semibold text-text-primary">{t('settings.mcpTitle')}</h3><p className="mt-1 text-[10px] leading-4 text-text-muted">{t('settings.mcpDescription')}</p></div><button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-border p-2 text-text-secondary hover:text-text-primary disabled:opacity-40" aria-label={t('common.refresh')}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button></div>
    {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[10px] text-red-300">{error}</p>}
    {servers.map((server) => <article key={server.id} className="rounded-xl border border-border bg-surface-800/60 p-3"><div className="flex items-start gap-3"><div className="mt-0.5 rounded-lg bg-blue-500/10 p-2 text-blue-300"><Server size={14} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h4 className="truncate text-xs font-semibold text-text-primary">{server.name}</h4><span className="rounded-full bg-surface-700 px-2 py-0.5 text-[9px] text-text-muted">{server.scope}</span></div><p className="mt-1 text-[10px] text-text-muted">{server.transport} · {server.status} · {t('settings.toolCount', { count: server.toolCount })}</p><div className="mt-2 flex flex-wrap gap-1">{server.readOnly && <span className="flex items-center gap-1 rounded bg-green-500/10 px-1.5 py-0.5 text-[9px] text-green-300"><ShieldCheck size={9} />{t('settings.readOnly')}</span>}{server.authentication !== 'none' && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-300">{t('settings.authenticationRequired')}</span>}</div>{server.tools.length > 0 && <p className="mt-2 break-words text-[9px] leading-4 text-text-muted">{server.tools.join(', ')}</p>}{testResults[server.id] && <p className="mt-2 text-[9px] text-text-secondary">{testResults[server.id]}</p>}<button type="button" disabled={!server.enabled || busy === server.id} onClick={() => { setBusy(server.id); setTestResults((current) => ({ ...current, [server.id]: t('settings.testingMcp') })); void testMCPServer(server.id, workspaceId).then((result) => setTestResults((current) => ({ ...current, [server.id]: result.message }))).catch((nextError) => setTestResults((current) => ({ ...current, [server.id]: nextError instanceof Error ? nextError.message : String(nextError) }))).finally(() => setBusy('')); }} className="mt-2 flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary disabled:opacity-40">{busy === server.id ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}{t('settings.testMcp')}</button></div><Toggle enabled={server.enabled} disabled={busy === server.id} onChange={() => { setBusy(server.id); void setMCPEnabled(server.id, !server.enabled).then(() => refresh()).catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError))).finally(() => setBusy('')); }} /></div></article>)}
    <div className="rounded-xl border border-border bg-surface-800/40 p-3 text-[10px] leading-4 text-text-muted">{t('settings.mcpCliHint')} <code className="text-accent-300">meshcli mcp add ...</code></div>
  </section>;
}
