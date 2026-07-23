import { useState, useEffect } from 'react';
import { Trophy, Crown, Medal, Award, Swords } from 'lucide-react';
import type { TournamentState } from '../../hooks/useTournamentRoom';

interface TournamentStandingsPanelProps {
  state: TournamentState;
}

export function TournamentStandingsPanel({ state }: TournamentStandingsPanelProps) {
  const isRegistrationOpen = state.status === 'registration_open';
  const isActive = ['starting', 'round_active', 'between_rounds', 'finalizing'].includes(state.status);
  const isCompleted = state.status === 'completed' || state.lastStatus === 'completed';
  const isCancelled = state.status === 'cancelled_insufficient_players' || state.lastStatus === 'cancelled_insufficient_players';

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!isRegistrationOpen || !state.startsAt || !state.serverNow) {
      setSecondsLeft(null);
      return;
    }
    const serverOffset = Date.now() - new Date(state.serverNow).getTime();
    const update = () => {
      const now = Date.now() - serverOffset;
      const diff = Math.max(0, Math.ceil((new Date(state.startsAt).getTime() - now) / 1000));
      setSecondsLeft(diff);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isRegistrationOpen, state.startsAt, state.serverNow]);

  const showRegistrations = isRegistrationOpen && secondsLeft !== null && secondsLeft <= 10;
  const showPreviousStandings = isRegistrationOpen && !showRegistrations && state.standings.length > 0;

  if (isCancelled && !isActive && !isRegistrationOpen) {
    return (
      <div className="w-full h-full flex flex-col">
        <div className="p-4 border-b border-slate-700/50">
          <h3 className="text-sm font-semibold text-slate-400 tracking-wide uppercase">
            Resultado
          </h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-slate-500 text-center">
            Nao houve participantes suficientes
          </p>
        </div>
      </div>
    );
  }

  if (showRegistrations) {
    return (
      <div className="w-full h-full flex flex-col">
        <div className="p-4 border-b border-slate-700/50">
          <h3 className="text-sm font-semibold text-slate-300 tracking-wide uppercase">
            Inscritos ({state.registrations.length})
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {state.registrations.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">Nenhum inscrito ainda</p>
          ) : (
            <div className="space-y-0.5">
              {state.registrations.map((reg, i) => (
                <div key={reg.playerId} className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-slate-800/50">
                  <span className="text-xs text-slate-500 w-5 text-right">{i + 1}</span>
                  <span className="text-sm text-slate-200 flex-1 truncate">{reg.username}</span>
                  <span className="text-xs text-slate-500 font-mono">{reg.rating}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (showPreviousStandings) {
    return (
      <div className="w-full h-full flex flex-col">
        <div className="p-4 border-b border-slate-700/50 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-slate-300 tracking-wide uppercase">
            Ultimo Torneio
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          <StandingsList standings={state.standings} />
        </div>
      </div>
    );
  }

  if (isRegistrationOpen) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p className="text-xs text-slate-500">Aguardando torneio</p>
      </div>
    );
  }

  if (isActive || isCompleted) {
    const standings = state.standings;
    const pairings = state.pairings;
    const title = isCompleted ? 'Classificacao Final' : 'Standings';

    return (
      <div className="w-full h-full flex flex-col">
        <div className="p-4 border-b border-slate-700/50 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-slate-300 tracking-wide uppercase">
            {title}
          </h3>
          {isActive && (
            <span className="ml-auto text-xs text-slate-500">R{state.currentRound}/{state.totalRounds}</span>
          )}
        </div>

        {isActive && pairings.length > 0 && (
          <div className="border-b border-slate-700/50">
            <div className="px-4 py-2 flex items-center gap-1.5">
              <Swords className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-medium text-sky-300 uppercase tracking-wide">
                Rodada {state.currentRound}
              </span>
            </div>
            <div className="px-2 pb-2 space-y-1">
              {pairings.map((p) => (
                <div
                  key={p.boardNumber}
                  className="flex items-center gap-1 px-2 py-1.5 rounded bg-slate-800/40"
                >
                  <span className="text-[10px] text-slate-600 w-4 text-center font-mono">{p.boardNumber}</span>
                  {p.isBye ? (
                    <span className="text-xs text-slate-400 flex-1 text-center italic">
                      {p.whiteUsername || p.blackUsername} (bye)
                    </span>
                  ) : (
                    <>
                      <span className="text-xs text-slate-200 flex-1 text-right truncate">
                        {p.whiteUsername}
                      </span>
                      <span className="text-[10px] text-slate-600 px-1">vs</span>
                      <span className="text-xs text-slate-200 flex-1 text-left truncate">
                        {p.blackUsername}
                      </span>
                      {p.result && (
                        <span className="text-[10px] text-amber-400 font-mono ml-1 shrink-0">
                          {p.result}
                        </span>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {standings.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">
              {state.status === 'starting' ? 'Calculando pareamentos...' : 'Aguardando resultados'}
            </p>
          ) : (
            <StandingsList standings={standings} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center">
      <p className="text-xs text-slate-500">Aguardando torneio</p>
    </div>
  );
}

function StandingsList({ standings }: { standings: TournamentState['standings'] }) {
  return (
    <div className="divide-y divide-slate-800/50">
      {standings.map((s) => (
        <div
          key={s.playerId}
          className={`flex items-center gap-2 px-3 py-2 min-w-0 ${
            s.isChampion ? 'bg-amber-500/5' : 'hover:bg-slate-800/30'
          }`}
        >
          <div className="w-6 flex items-center justify-center">
            {s.position === 1 ? (
              <Crown className="w-4 h-4 text-amber-400" />
            ) : s.position === 2 ? (
              <Medal className="w-3.5 h-3.5 text-slate-300" />
            ) : s.position === 3 ? (
              <Award className="w-3.5 h-3.5 text-amber-700" />
            ) : (
              <span className="text-xs text-slate-500">{s.position}</span>
            )}
          </div>
          <span className={`text-sm flex-1 truncate ${s.isChampion ? 'text-amber-200 font-medium' : 'text-slate-200'}`}>
            {s.username}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-white font-mono w-8 text-right">
              {s.points}
            </span>
            <span className="text-[10px] text-slate-500 font-mono w-16 text-right">
              {s.wins}W {s.draws}D {s.losses}L
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
