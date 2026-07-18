import { useState, useEffect } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useAuthStore } from '../../stores/authStore';
import { useChessStore } from '../../stores/chessStore';
import { sendCreateChallenge, sendAcceptChallenge, sendBoardCancel } from '../../game/network/colyseusClient';
import { X, Loader2, Swords, Zap, Timer, Clock, Eye, Crown } from 'lucide-react';

interface TimeControl {
  label: string;
  time: number;
  increment: number;
  category: string;
}

const TIME_CONTROLS: { category: string; icon: React.ReactNode; controls: TimeControl[] }[] = [
  {
    category: 'Bullet',
    icon: <Zap className="w-4 h-4 text-yellow-400" />,
    controls: [
      { label: '1 min', time: 1, increment: 0, category: 'bullet' },
      { label: '1 + 1', time: 1, increment: 1, category: 'bullet' },
      { label: '2 + 1', time: 2, increment: 1, category: 'bullet' },
    ],
  },
  {
    category: 'Blitz',
    icon: <Timer className="w-4 h-4 text-amber-400" />,
    controls: [
      { label: '3 min', time: 3, increment: 0, category: 'blitz' },
      { label: '3 + 2', time: 3, increment: 2, category: 'blitz' },
      { label: '5 min', time: 5, increment: 0, category: 'blitz' },
    ],
  },
  {
    category: 'Rapid',
    icon: <Clock className="w-4 h-4 text-emerald-400" />,
    controls: [
      { label: '10 min', time: 10, increment: 0, category: 'rapid' },
      { label: '10 + 5', time: 10, increment: 5, category: 'rapid' },
      { label: '15 + 10', time: 15, increment: 10, category: 'rapid' },
    ],
  },
];

export function BoardModal() {
  const { selectedBoard, setSelectedBoard, setBoardLocked, colyseusBoards, matchStartedInfo, setMatchStartedInfo, challengeColor, setChallengeColor } = useGameStore();
  const { user } = useAuthStore();
  const { openMatch, openSpectate, matchId: activeMatchId, boardId: activeBoardId, reopenBoard } = useChessStore();
  const [selectedTime, setSelectedTime] = useState<TimeControl>({ label: '10 min', time: 10, increment: 0, category: 'rapid' });
  const [selectedSide, setSelectedSide] = useState<'w' | 'b' | 'random'>(
    (selectedBoard as any)?.preSelectedSide || 'random'
  );
  const [isWaiting, setIsWaiting] = useState(false);

  // Auto-detect waiting state from Colyseus board status
  useEffect(() => {
    if (selectedBoard && colyseusBoards.length) {
      const bs = colyseusBoards.find(b => b.id === selectedBoard.id);
      if (bs?.status === 'waiting' && bs.waitingPlayerId === user?.id) {
        setIsWaiting(true);
      }
    }
  }, [selectedBoard, colyseusBoards, user]);

  // Match started: auto-open chess board
  if (matchStartedInfo) {
    const handleOpenMatch = () => {
      if (user) {
        openMatch(matchStartedInfo.matchId, matchStartedInfo.color, user.id);
      }
      setMatchStartedInfo(null);
      setIsWaiting(false);
      setBoardLocked(false);
      setSelectedBoard(null);
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
        <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl">
          <div className="p-6 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-500/50 flex items-center justify-center mb-4">
              <Swords className="w-7 h-7 text-emerald-400" />
            </div>
            <h3 className="text-white font-bold text-lg mb-2">Match Started!</h3>
            <p className="text-slate-400 text-sm mb-1">
              You play as: <span className="text-amber-400 font-semibold">{matchStartedInfo.color === 'w' ? 'White' : 'Black'}</span>
            </p>
            <button
              onClick={handleOpenMatch}
              className="w-full py-3 rounded-xl font-semibold bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700 shadow-lg shadow-emerald-500/20 transition-all mt-4"
            >
              Play!
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedBoard) return null;

  const boardState = colyseusBoards.find(b => b.id === selectedBoard.id || b.name === selectedBoard.name);
  const colyseusStatus = boardState?.status || 'idle';
  const isWaitingOnServer = colyseusStatus === 'waiting';
  const isPlaying = colyseusStatus === 'playing';
  const waitingPlayerIsMe = boardState?.waitingPlayerId === user?.id;

  // If this board has my active match, reopen it
  if (isPlaying && activeMatchId && activeBoardId === selectedBoard.id) {
    reopenBoard();
    setSelectedBoard(null);
    setBoardLocked(false);
    return null;
  }

  const handleCreateChallenge = () => {
    if (!user) return;
    sendCreateChallenge({
      boardId: selectedBoard.id,
      timeCategory: selectedTime.category,
      baseMinutes: selectedTime.time,
      incrementSeconds: selectedTime.increment,
      timeLabel: selectedTime.label,
      side: selectedSide,
    });
    setIsWaiting(true);
  };

  const handleAcceptChallenge = () => {
    if (!user) return;
    sendAcceptChallenge(selectedBoard.id);
  };

  const handleCancelWaiting = () => {
    if (!selectedBoard) return;
    sendBoardCancel(selectedBoard.id);
    setIsWaiting(false);
    setBoardLocked(false);
    setSelectedBoard(null);
    setChallengeColor(null);
  };

  const handleClose = () => {
    if (!isWaiting) {
      setBoardLocked(false);
      setSelectedBoard(null);
    }
  };

  const handleSpectate = () => {
    if (!boardState?.matchId) return;
    openSpectate(boardState.matchId);
    setSelectedBoard(null);
    setBoardLocked(false);
  };

  // Waiting state
  if (isWaiting || (isWaitingOnServer && waitingPlayerIsMe)) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
        <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl">
          <div className="p-6 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/20 border-2 border-amber-500/50 flex items-center justify-center mb-4">
              <Loader2 className="w-7 h-7 text-amber-400 animate-spin" />
            </div>
            <h3 className="text-white font-bold text-lg mb-1">Waiting for duel...</h3>
            <p className="text-slate-400 text-sm mb-1">
              {selectedTime.label} | {selectedBoard.name?.replace(/_/g, ' ')}
            </p>
            {challengeColor && (
              <p className="text-slate-500 text-xs mb-1">
                Playing as: <span className="text-amber-300">{challengeColor === 'w' ? 'White' : 'Black'}</span>
              </p>
            )}
            <p className="text-slate-500 text-xs mb-6">
              Another player needs to join this board to start a match.
            </p>
            <button
              onClick={handleCancelWaiting}
              className="w-full py-3 rounded-xl font-semibold bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors"
            >
              Cancel Challenge
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Board has an active match - offer spectate
  if (isPlaying) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
        <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl">
          <div className="p-6 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-blue-500/20 border-2 border-blue-500/50 flex items-center justify-center mb-4">
              <Swords className="w-7 h-7 text-blue-400" />
            </div>
            <h3 className="text-white font-bold text-lg mb-1">Match in Progress</h3>
            <p className="text-slate-400 text-sm mb-6">
              A match is being played on this board.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="flex-1 py-3 rounded-xl font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleSpectate}
                className="flex-1 py-3 rounded-xl font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 transition-colors flex items-center justify-center gap-2"
              >
                <Eye className="w-4 h-4" />
                Watch
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Another player is waiting - offer to accept
  if (isWaitingOnServer && !waitingPlayerIsMe) {
    const categoryLabel = (boardState?.timeCategory || 'rapid').charAt(0).toUpperCase() + (boardState?.timeCategory || 'rapid').slice(1);

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
        <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Swords className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-white font-bold text-base">{selectedBoard.name?.replace(/_/g, ' ')}</h3>
                <p className="text-amber-400 text-xs">Challenge available!</p>
              </div>
            </div>
            <button onClick={handleClose} className="text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5">
            <div className="bg-slate-800/60 rounded-xl p-4 mb-4 text-center">
              <p className="text-white font-semibold text-sm mb-2">
                {boardState?.waitingPlayerName || 'A player'} is waiting for a duel
              </p>
              <div className="flex items-center justify-center gap-3 mt-3">
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 text-amber-400 text-xs font-semibold border border-amber-500/30">
                  <Clock className="w-3 h-3" />
                  {boardState?.timeLabel || '10 min'}
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-700/60 text-slate-300 text-xs">
                  {categoryLabel}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="flex-1 py-3 rounded-xl font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAcceptChallenge}
                className="flex-1 py-3 rounded-xl font-semibold bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700 shadow-lg shadow-emerald-500/20 transition-all"
              >
                Accept Duel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default: Time control + side selection
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <h3 className="text-white font-bold text-base">{selectedBoard.name?.replace(/_/g, ' ')}</h3>
            <p className="text-slate-400 text-xs mt-0.5">Choose time control and side</p>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Time controls */}
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

          {/* Side selection */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-4 h-4 text-blue-400" />
              <span className="text-white font-semibold text-sm">Side</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: 'w' as const, label: 'White', img: '/assets/chesspieces/whiteking.png' },
                { id: 'random' as const, label: 'Random', img: null },
                { id: 'b' as const, label: 'Black', img: '/assets/chesspieces/blackking.png' },
              ]).map((option) => {
                const isActive = selectedSide === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => setSelectedSide(option.id)}
                    className={`py-2.5 px-3 rounded-lg text-sm font-medium transition-all flex flex-col items-center gap-1 ${
                      isActive
                        ? 'bg-blue-500/20 text-blue-400 border-2 border-blue-500/60'
                        : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    {option.img ? (
                      <img src={option.img} alt={option.label} className="w-6 h-6" />
                    ) : (
                      <div className="w-6 h-6 flex items-center justify-center text-lg">?</div>
                    )}
                    <span className="text-xs">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleCreateChallenge}
            className="w-full py-3 rounded-xl font-semibold transition-all bg-gradient-to-r from-amber-500 to-amber-600 text-white hover:from-amber-600 hover:to-amber-700 shadow-lg shadow-amber-500/20 mt-2"
          >
            Launch Challenge
          </button>
        </div>
      </div>
    </div>
  );
}
