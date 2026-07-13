import { useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useAuthStore } from '../../stores/authStore';
import { sendBoardJoin, sendBoardCancel } from '../../game/network/colyseusClient';
import { X, Loader2, Swords } from 'lucide-react';

export function BoardModal() {
  const { selectedBoard, setSelectedBoard, setBoardLocked, colyseusBoards, matchStartedInfo, setMatchStartedInfo } = useGameStore();
  const { user, profile } = useAuthStore();
  const [isWaiting, setIsWaiting] = useState(false);

  // Match started notification
  if (matchStartedInfo) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
        <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl">
          <div className="p-6 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-500/50 flex items-center justify-center mb-4">
              <Swords className="w-7 h-7 text-emerald-400" />
            </div>
            <h3 className="text-white font-bold text-lg mb-2">Match Started!</h3>
            <p className="text-slate-400 text-sm mb-1">
              Board: {matchStartedInfo.boardId}
            </p>
            <p className="text-slate-400 text-sm mb-1">
              You play as: <span className="text-amber-400 font-semibold">{matchStartedInfo.color === 'w' ? 'White' : 'Black'}</span>
            </p>
            <p className="text-slate-500 text-xs mb-6">
              Match ID: {matchStartedInfo.matchId.slice(0, 12)}...
            </p>
            <button
              onClick={() => setMatchStartedInfo(null)}
              className="w-full py-3 rounded-xl font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
            >
              OK
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

  const handleEnterBoard = () => {
    if (!user || !profile) return;
    sendBoardJoin(selectedBoard.id, profile.username);

    if (colyseusStatus === 'idle') {
      setIsWaiting(true);
    }
  };

  const handleCancelWaiting = () => {
    if (!selectedBoard) return;
    sendBoardCancel(selectedBoard.id);
    setIsWaiting(false);
    setBoardLocked(false);
    setSelectedBoard(null);
  };

  const handleClose = () => {
    if (!isWaiting) {
      setBoardLocked(false);
      setSelectedBoard(null);
    }
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
            <h3 className="text-white font-bold text-lg mb-1">Waiting for opponent...</h3>
            <p className="text-slate-400 text-sm mb-1">{selectedBoard.name}</p>
            <p className="text-slate-500 text-xs mb-6">
              Another player needs to join this board to start a match.
            </p>
            <button
              onClick={handleCancelWaiting}
              className="w-full py-3 rounded-xl font-semibold bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Board is in a match
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
              This board already has a match going on.
            </p>
            <button
              onClick={handleClose}
              className="w-full py-3 rounded-xl font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Another player is waiting - show accept view
  if (isWaitingOnServer && !waitingPlayerIsMe) {
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
                  <span className="text-xs font-bold text-white">
                    {boardState?.waitingPlayerName?.charAt(0)?.toUpperCase() || 'P'}
                  </span>
                </div>
                <span className="text-white font-semibold text-sm">
                  {boardState?.waitingPlayerName || 'Player'} vs You
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="flex-1 py-3 rounded-xl font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
              >
                Decline
              </button>
              <button
                onClick={handleEnterBoard}
                className="flex-1 py-3 rounded-xl font-semibold bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700 shadow-lg shadow-emerald-500/20 transition-all"
              >
                Accept!
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default: Enter board prompt
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <h3 className="text-white font-bold text-base">{selectedBoard.name}</h3>
            <p className="text-slate-400 text-xs mt-0.5">Enter this board?</p>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">
          <div className="bg-slate-800/60 rounded-xl p-4 mb-4 text-center">
            <p className="text-slate-300 text-sm">
              Sit at this board and wait for another player to challenge you.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="flex-1 py-3 rounded-xl font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleEnterBoard}
              className="flex-1 py-3 rounded-xl font-semibold bg-gradient-to-r from-amber-500 to-amber-600 text-white hover:from-amber-600 hover:to-amber-700 shadow-lg shadow-amber-500/20 transition-all"
            >
              Enter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
