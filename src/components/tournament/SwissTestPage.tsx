import { useState, useEffect, useCallback } from 'react';
import { tournamentApi } from './api';
import { ConfigSection } from './sections/ConfigSection';
import { PlayersSection } from './sections/PlayersSection';
import { RoundSection } from './sections/RoundSection';
import { StandingsSection } from './sections/StandingsSection';
import { DiagnosticsSection } from './sections/DiagnosticsSection';
import { PlayerSummary } from './sections/PlayerSummary';
import { Trophy, RefreshCw, Plus, Trash2, Download, Upload } from 'lucide-react';

export function SwissTestPage() {
  const [tournament, setTournament] = useState<any>(null);
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [engineStatus, setEngineStatus] = useState<any>(null);
  const [presets, setPresets] = useState<any[]>([]);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Override overflow:hidden on html/body for this scrollable page
  useEffect(() => {
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    const root = document.getElementById('root');
    if (root) root.style.overflow = 'auto';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      if (root) root.style.overflow = '';
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!tournament?.id) return;
    try {
      const t = await tournamentApi.getTournament(tournament.id);
      setTournament(t);
    } catch (e: any) {
      setError(e.message);
    }
  }, [tournament?.id]);

  useEffect(() => {
    tournamentApi.getEngineStatus().then(setEngineStatus).catch(() => {});
    tournamentApi.listPresets().then(setPresets).catch(() => {});
    tournamentApi.listTournaments().then(setTournaments).catch(() => {});
  }, []);

  const createNew = async () => {
    try {
      const t = await tournamentApi.createTournament('New Tournament');
      setTournament(t);
      setDiagnostics(null);
      setError(null);
      const list = await tournamentApi.listTournaments();
      setTournaments(list);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const deleteTournament = async () => {
    if (!tournament?.id) return;
    if (!confirm('Delete this tournament?')) return;
    try {
      await tournamentApi.deleteTournament(tournament.id);
      setTournament(null);
      setDiagnostics(null);
      const list = await tournamentApi.listTournaments();
      setTournaments(list);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const exportTournament = () => {
    if (!tournament) return;
    const blob = new Blob([JSON.stringify(tournament, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tournament-${tournament.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTournament = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const t = await tournamentApi.importTournament(data);
        setTournament(t);
        const list = await tournamentApi.listTournaments();
        setTournaments(list);
      } catch (err: any) {
        setError(err.message);
      }
    };
    input.click();
  };

  const handleAction = async (fn: () => Promise<any>) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      if (result?.tournament) setTournament(result.tournament);
      if (result?.diagnostics) setDiagnostics(result.diagnostics);
      else await refresh();
    } catch (e: any) {
      setError(e.message);
      try {
        const parsed = JSON.parse(e.message.replace(/^.*?{/, '{'));
        if (parsed.diagnostics) setDiagnostics(parsed.diagnostics);
      } catch { /* not json */ }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-700/50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Trophy className="w-6 h-6 text-amber-400" />
            <h1 className="text-lg font-bold text-white">Swiss Tournament Test</h1>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
              FIDE Dutch System
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={createNew} className="btn-sm btn-primary" title="New tournament">
              <Plus className="w-4 h-4" />
            </button>
            <button onClick={refresh} className="btn-sm btn-ghost" title="Refresh" disabled={!tournament}>
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={exportTournament} className="btn-sm btn-ghost" title="Export" disabled={!tournament}>
              <Download className="w-4 h-4" />
            </button>
            <button onClick={importTournament} className="btn-sm btn-ghost" title="Import">
              <Upload className="w-4 h-4" />
            </button>
            <button onClick={deleteTournament} className="btn-sm btn-danger" title="Delete" disabled={!tournament}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Tournament selector */}
        {tournaments.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-slate-400">Tournaments:</span>
            {tournaments.map(t => (
              <button
                key={t.id}
                onClick={() => { setTournament(t); setDiagnostics(null); setError(null); }}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  tournament?.id === t.id
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {t.name} ({t.status})
              </button>
            ))}
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {!tournament ? (
          <div className="text-center py-20 text-slate-500">
            <Trophy className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p className="text-lg">Create or select a tournament to begin</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Config & Players (side by side on large screens) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ConfigSection
                tournament={tournament}
                engineStatus={engineStatus}
                onAction={handleAction}
              />
              <PlayersSection
                tournament={tournament}
                presets={presets}
                onAction={handleAction}
                onRefresh={refresh}
              />
            </div>

            {/* Rounds */}
            {tournament.rounds?.length > 0 && (
              <RoundSection
                tournament={tournament}
                onAction={handleAction}
                onRefresh={refresh}
              />
            )}

            {/* Standings */}
            {tournament.standings?.length > 0 && (
              <StandingsSection
                tournament={tournament}
              />
            )}

            {/* Diagnostics */}
            {diagnostics && (
              <DiagnosticsSection diagnostics={diagnostics} />
            )}

            {/* Player Summary (final) */}
            {tournament.status === 'finished' && (
              <PlayerSummary tournament={tournament} />
            )}
          </div>
        )}
      </main>

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 flex items-center gap-3">
            <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
            <span className="text-slate-200">Processing...</span>
          </div>
        </div>
      )}
    </div>
  );
}
