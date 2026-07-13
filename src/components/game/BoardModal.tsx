import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useAuthStore } from '../../stores/authStore';
import { useChessStore } from '../../stores/chessStore';
import { supabase } from '../../lib/supabase';
import { broadcastBoardStatus } from '../../hooks/useRealtimeBoards';
import { X, Loader2, Zap, Clock, Timer, Eye, Swords } from 'lucide-react';

interface TimeControl {
  label: string;
  time: number;
  increment: number;
}

const TIME_CONTROLS: { category: string; icon: React.ReactNode; controls: TimeControl[] }[] = [
  {
    category: 'Bullet',
    icon: <Zap className="w-4 h-4 text-yellow-400" />,
    controls: [
      { label: '1 min', time: 1, increment: 0 },
      { label: '1 + 1', time: 1, increment: 1 },
      { label: '2 + 1', time: 2, increment: 1 },
    ],
  },
  {
    category: 'Blitz',
    icon: <Timer className="w-4 h-4 text-amber-400" />,
    controls: [
      { label: '3 min', time: 3, increment: 0 },
      { label: '3 + 2', time: 3, increment: 2 },
      { label: '5 min', time: 5, increment: 0 },
    ],
  },
  {
    category: 'Rapid',
    icon: <Clock className="w-4 h-4 text-emerald-400" />,
    controls: [
      { label: '10 min', time: 10, increment: 0 },
      { label: '10 + 5', time: 10, increment: 5 },
      { label: '15 + 10', time: 15, increment: 10 },
    ],
  },
];

export function BoardModal() {
  const { selectedBoard, setSelectedBoard, setCurrentMatch, loadBoards, region, setBoardLocked } = useGameStore();
  const { user, profile } = useAuthStore();
  const { initMatch, initSpectate } = useChessStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedTime, setSelectedTime] = useState<TimeControl>({ label: '10 min', time: 10, increment: 0 });
  const [isWaiting, setIsWaiting] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Watch for match creation when Player 1 is waiting
  useEffect(() => {
    if (!selectedBoard || !isWaiting || !user) return;

    channelRef.current = supabase
      .channel(`board_match_${selectedBoard.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'matches',
        filter: `board_id=eq.${selectedBoard.id}`,
      }, (payload) => {
        const match = payload.new as any;
        if (match.white_user_id === user.id || match.black_user_id === user.id) {
          setCurrentMatch(match);
          initMatch(match, user.id);
          setIsWaiting(false);
          setBoardLocked(false);
          setSelectedBoard(null);
        }
      })
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [selectedBoard?.id, isWaiting, user?.id]);

  // Also poll as fallback every 2s while waiting
  useEffect(() => {
    if (!selectedBoard || !isWaiting || !user) return;

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('matches')
        .select('*')
        .eq('board_id', selectedBoard.id)
        .eq('status', 'playing')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data && (data.white_user_id === user.id || data.black_user_id === user.id)) {
        setCurrentMatch(data);
        initMatch(data, user.id);
        setIsWaiting(false);
        setBoardLocked(false);
        setSelectedBoard(null);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [selectedBoard?.id, isWaiting, user?.id]);

  if (!selectedBoard) return null;

  const isOwnWait = selectedBoard.waiting_user_id === user?.id;
  const isWaitingStatus = selectedBoard.status === 'waiting';
  const isInMatch = selectedBoard.status === 'in_match';

  const handleCreateChallenge = async () => {
    if (!user || !profile || !region) return;
    setLoading(true);
    setError('');

    try {
      await supabase.from('boards').update({
        status: 'waiting',
        waiting_user_id: user.id,
        time_minutes: selectedTime.time,
        increment_seconds: selectedTime.increment,
        updated_at: new Date().toISOString(),
      }).eq('id', selectedBoard.id);

      // Broadcast status change to all players instantly
      broadcastBoardStatus(region, selectedBoard.name, 'waiting');

      setIsWaiting(true);
      setBoardLocked(true);
      await loadBoards(region);
    } catch (err: any) {
      setError(err.message || 'Failed to create challenge');
    }
    setLoading(false);
  };

  const handleAcceptChallenge = async () => {
    if (!user || !profile || !region) return;
    setLoading(true);
    setError('');

    try {
      const timeMin = selectedBoard.time_minutes || 10;
      const incSec = selectedBoard.increment_seconds || 0;
      const timeMs = timeMin * 60 * 1000;

      const { data: match, error: matchError } = await supabase.from('matches').insert({
        region,
        board_id: selectedBoard.id,
        white_user_id: selectedBoard.waiting_user_id!,
        black_user_id: user.id,
        status: 'playing',
        turn: 'w',
        current_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        pgn: '',
        time_minutes: timeMin,
        increment_seconds: incSec,
        white_time_ms: timeMs,
        black_time_ms: timeMs,
        last_move_at: new Date().toISOString(),
      }).select().single();

      if (matchError) throw matchError;

      await supabase.from('boards').update({
        status: 'in_match',
        waiting_user_id: null,
        current_match_id: match.id,
        updated_at: new Date().toISOString(),
      }).eq('id', selectedBoard.id);

      // Broadcast status change to all players instantly
      broadcastBoardStatus(region, selectedBoard.name, 'in_match');

      setCurrentMatch(match);
      initMatch(match, user.id);
      setBoardLocked(false);
      await loadBoards(region);
      setSelectedBoard(null);
    } catch (err: any) {
      setError(err.message || 'Failed to accept challenge');
    }
    setLoading(false);
  };

  const handleCancelChallenge = async () => {
    if (!user || !region) return;
    setLoading(true);
    try {
      await supabase.from('boards').update({
        status: 'free',
        waiting_user_id: null,
        updated_at: new Date().toISOString(),
      }).eq('id', selectedBoard.id);

      // Broadcast board is free again
      broadcastBoardStatus(region, selectedBoard.name, 'free');

      setIsWaiting(false);
      setBoardLocked(false);
      await loadBoards(region);
      setSelectedBoard(null);
    } catch (err: any) {
      setError(err.message || 'Failed to cancel');
    }
    setLoading(false);
  };

  const handleClose = () => {
    if (!isWaiting && !isOwnWait) {
      setBoardLocked(false);
      setSelectedBoard(null);
    }
  };

  const handleDecline = () => {
    setBoardLocked(false);
    setSelectedBoard(null);
  };

  // ─── WAITING STATE (Player 1 waiting for opponent) ───
  if (isWaiting || isOwnWait) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
        <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl">
          <div className="p-6 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/20 border-2 border-amber-500/50 flex items-center justify-center mb-4">
              <Loader2 className="w-7 h-7 text-amber-400 animate-spin" />
            </div>
            <h3 className="text-white font-bold text-lg mb-1">Waiting for opponent...</h3>
            <p className="text-slate-400 text-sm mb-1">
              {selectedTime.label} | {selectedBoard.name}
            </p>
            <p className="text-slate-500 text-xs mb-6">
              Your character is locked until a player accepts or you cancel.
            </p>
            <button
              onClick={handleCancelChallenge}
              disabled={loading}
              className="w-full py-3 rounded-xl font-semibold bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Cancel Challenge'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── ACCEPT CHALLENGE VIEW (Player 2 sees this) ───
  if (isWaitingStatus && !isOwnWait) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
        <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Swords className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-white font-bold text-base">{selectedBoard.name}</h3>
                <p className="text-amber-400 text-xs">Challenge available!</p>
              </div>
            </div>
            <button onClick={handleClose} className="text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5">
            <div className="bg-slate-800/60 rounded-xl p-4 mb-4 text-center">
              <p className="text-slate-400 text-xs mb-2">A player is waiting for a duel</p>
              <div className="flex items-center justify-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                  <span className="text-xs font-bold text-white">P1</span>
                </div>
                <span className="text-white font-semibold text-sm">vs You</span>
              </div>
              <div className="flex items-center justify-center gap-3">
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 text-amber-400 text-xs font-semibold border border-amber-500/30">
                  <Clock className="w-3 h-3" />
                  {selectedBoard.time_minutes || 10} min{selectedBoard.increment_seconds ? ` + ${selectedBoard.increment_seconds}s` : ''}
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-700/60 text-slate-300 text-xs">
                  {(selectedBoard.time_minutes || 10) <= 2 ? 'Bullet' : (selectedBoard.time_minutes || 10) <= 5 ? 'Blitz' : 'Rapid'}
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-300 text-sm mb-4">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleDecline}
                className="flex-1 py-3 rounded-xl font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
              >
                Decline
              </button>
              <button
                onClick={handleAcceptChallenge}
                disabled={loading}
                className="flex-1 py-3 rounded-xl font-semibold bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700 shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-40"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Accept!'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── REJOIN / SPECTATOR VIEW (Board has active match) ───
  if (isInMatch) {
    return (
      <BoardInMatchView
        selectedBoard={selectedBoard}
        user={user}
        loading={loading}
        setLoading={setLoading}
        error={error}
        setError={setError}
        setCurrentMatch={setCurrentMatch}
        initMatch={initMatch}
        initSpectate={initSpectate}
        setBoardLocked={setBoardLocked}
        setSelectedBoard={setSelectedBoard}
        handleClose={handleClose}
      />
    );
  }

  // ─── CREATE CHALLENGE VIEW (Player 1 configures) ───
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <h3 className="text-white font-bold text-base">{selectedBoard.name}</h3>
            <p className="text-slate-400 text-xs mt-0.5">Configure your challenge</p>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {TIME_CONTROLS.map((category) => (
            <div key={category.category}>
              <div className="flex items-center gap-2 mb-2">
                {category.icon}
                <span className="text-white font-semibold text-sm">{category.category}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {category.controls.map((tc) => {
                  const isActive = selectedTime.label === tc.label;
                  return (
                    <button
                      key={tc.label}
                      onClick={() => setSelectedTime(tc)}
                      className={`py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${
                        isActive
                          ? 'bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500/60 shadow-lg shadow-emerald-900/20'
                          : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white'
                      }`}
                    >
                      {tc.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleCreateChallenge}
            disabled={loading}
            className="w-full py-3 rounded-xl font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-amber-500 to-amber-600 text-white hover:from-amber-600 hover:to-amber-700 shadow-lg shadow-amber-500/20 mt-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Launch Challenge'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BoardInMatchView({
  selectedBoard,
  user,
  loading: parentLoading,
  setLoading,
  error: parentError,
  setError,
  setCurrentMatch,
  initMatch,
  initSpectate,
  setBoardLocked,
  setSelectedBoard,
  handleClose,
}: any) {
  const [checking, setChecking] = useState(true);
  const [isParticipant, setIsParticipant] = useState(false);
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!selectedBoard?.current_match_id || !user || attemptedRef.current) return;
    attemptedRef.current = true;

    const checkAndRejoin = async () => {
      try {
        const { data: match, error: matchError } = await supabase
          .from('matches')
          .select('*')
          .eq('id', selectedBoard.current_match_id)
          .single();

        if (matchError) throw matchError;

        const participant = match.white_user_id === user.id || match.black_user_id === user.id;

        if (participant && match.status === 'playing') {
          setCurrentMatch(match);
          initMatch(match, user.id);
          setBoardLocked(false);
          setSelectedBoard(null);
        } else {
          setIsParticipant(false);
          setChecking(false);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load match');
        setChecking(false);
      }
    };

    checkAndRejoin();
  }, [selectedBoard?.current_match_id, user?.id]);

  const handleSpectate = async () => {
    if (!selectedBoard.current_match_id) return;
    setLoading(true);
    setError('');

    try {
      const { data: match, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .eq('id', selectedBoard.current_match_id)
        .single();

      if (matchError) throw matchError;

      setCurrentMatch(match);
      initSpectate(match);
      setBoardLocked(false);
      setSelectedBoard(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load match');
    }
    setLoading(false);
  };

  if (checking) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
        <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl p-6 text-center">
          <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-3" />
          <p className="text-white font-semibold">Loading match...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Eye className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h3 className="text-white font-bold text-base">{selectedBoard.name}</h3>
              <p className="text-blue-400 text-xs">Match in progress</p>
            </div>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">
          <div className="bg-slate-800/60 rounded-xl p-4 mb-4 text-center">
            <p className="text-slate-400 text-xs mb-3">Two players are currently playing</p>
            <div className="flex items-center justify-center gap-3">
              <div className="flex flex-col items-center">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center mb-1">
                  <img src="/assets/chesspieces/whiteking.png" alt="" className="w-7 h-7" />
                </div>
                <span className="text-white text-xs font-medium">White</span>
              </div>
              <span className="text-slate-500 text-lg font-bold">vs</span>
              <div className="flex flex-col items-center">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center mb-1">
                  <img src="/assets/chesspieces/blackking.png" alt="" className="w-7 h-7" />
                </div>
                <span className="text-white text-xs font-medium">Black</span>
              </div>
            </div>
          </div>

          {parentError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-300 text-sm mb-4">
              {parentError}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="flex-1 py-3 rounded-xl font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
            >
              Leave
            </button>
            <button
              onClick={handleSpectate}
              disabled={parentLoading}
              className="flex-1 py-3 rounded-xl font-semibold bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 shadow-lg shadow-blue-500/20 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {parentLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                <>
                  <Eye className="w-4 h-4" />
                  Watch
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
