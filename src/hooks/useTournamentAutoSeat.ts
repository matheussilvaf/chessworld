import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { getActiveRoom } from '../game/network/colyseusClient';
import type { TournamentState } from './useTournamentRoom';

export function useTournamentAutoSeat(
  state: TournamentState,
  connected: boolean,
  reportResult: (roundNumber: number, boardNumber: number, result: string, reason: string) => void,
) {
  const { user } = useAuthStore();
  const seatedForRound = useRef<number>(0);
  const seating = useRef(false);
  const listenersAttached = useRef(false);
  const stateRef = useRef(state);
  const seatRetryTimer = useRef<number | null>(null);
  stateRef.current = state;

  useEffect(() => {
    if (!connected || !user) return;
    if (state.status !== 'round_active') return;
    if (state.currentRound === seatedForRound.current) return;
    if (seating.current) return;
    if (state.pairings.length === 0) return;
    if (state.modules.length === 0) return;

    const room = getActiveRoom();
    if (!room) return;

    const myPairing = state.pairings.find(
      p => p.whitePlayerId === user.id || p.blackPlayerId === user.id
    );
    if (!myPairing) return;
    if (myPairing.isBye) {
      seatedForRound.current = state.currentRound;
      return;
    }
    if (!myPairing.runtimeTableId) return;
    if (myPairing.result) {
      seatedForRound.current = state.currentRound;
      return;
    }

    // Wait for arena modules to be loaded in the scene before sending seat request
    const attemptSeat = (attempts: number) => {
      if (attempts > 20) {
        console.warn('[useTournamentAutoSeat] Gave up waiting for arenaManager after 20 attempts');
        seating.current = false;
        return;
      }
      const scene = (window as any).__worldScene;
      if (!scene || !scene.arenaManager || !scene.arenaManager.isLoaded) {
        seatRetryTimer.current = window.setTimeout(() => attemptSeat(attempts + 1), 500);
        return;
      }

      const color: 'w' | 'b' = myPairing.whitePlayerId === user.id ? 'w' : 'b';
      const opponentId = color === 'w' ? myPairing.blackPlayerId : myPairing.whitePlayerId;

      room.send('tournament_seat', {
        boardId: myPairing.runtimeTableId,
        baseTimeSeconds: stateRef.current.baseTimeSeconds,
        incrementSeconds: stateRef.current.incrementSeconds,
        timeCategory: stateRef.current.timeControlCategory,
        timeLabel: stateRef.current.timeControlLabel,
        opponentId,
        color,
      });

      seatedForRound.current = stateRef.current.currentRound;
    };

    seating.current = true;
    attemptSeat(0);

    if (!listenersAttached.current) {
      listenersAttached.current = true;

      room.onMessage('tournament_seated', (msg: { boardId: string; color: string; seat: string }) => {
        seatPlayerWhenReady(msg.boardId, 'player', msg.seat, msg.color as 'w' | 'b');
        seating.current = false;
      });
    }
  }, [state.status, state.currentRound, state.pairings, state.modules, user, connected]);

  // Report match result to coordinator
  useEffect(() => {
    if (!connected || !user) return;

    const handleMatchEnded = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || !detail.boardId) return;

      const st = stateRef.current;
      if (st.status !== 'round_active') return;

      const myPairing = st.pairings.find(
        p => p.runtimeTableId === detail.boardId &&
             (p.whitePlayerId === user.id || p.blackPlayerId === user.id)
      );
      if (!myPairing) return;

      let result: string;
      if (detail.result === 'checkmate' || detail.result === 'resign' || detail.result === 'timeout' || detail.result === 'abandon') {
        if (detail.winnerId === myPairing.whitePlayerId) {
          result = '1-0';
        } else if (detail.winnerId === myPairing.blackPlayerId) {
          result = '0-1';
        } else {
          result = '1/2-1/2';
        }
      } else {
        result = '1/2-1/2';
      }

      reportResult(st.currentRound, myPairing.boardNumber, result, detail.result || 'normal');
    };

    window.addEventListener('tournament_match_ended', handleMatchEnded);
    return () => window.removeEventListener('tournament_match_ended', handleMatchEnded);
  }, [connected, user, reportResult]);

  useEffect(() => {
    if (state.status === 'idle' || state.status === 'registration_open') {
      seatedForRound.current = 0;
      seating.current = false;
    }
    if (state.status === 'between_rounds' || state.status === 'completed' || state.status === 'finalizing') {
      const scene = (window as any).__worldScene;
      if (scene && typeof scene.unseatPlayer === 'function' && scene.currentSeatInfo) {
        scene.unseatPlayer();
      }
      seating.current = false;
    }
  }, [state.status]);

  useEffect(() => {
    return () => {
      if (seatRetryTimer.current) {
        clearTimeout(seatRetryTimer.current);
      }
    };
  }, []);
}

function seatPlayerWhenReady(boardId: string, role: string, seat: string, color: 'w' | 'b') {
  const scene = (window as any).__worldScene;
  if (!scene) return;

  if (scene.tableRegistry?.tables?.has(boardId)) {
    scene.seatPlayer(boardId, role, seat, color);
    return;
  }

  let attempts = 0;
  const retry = () => {
    attempts++;
    if (attempts > 20) {
      console.warn('[useTournamentAutoSeat] seatPlayerWhenReady gave up for', boardId);
      return;
    }
    const s = (window as any).__worldScene;
    if (s?.tableRegistry?.tables?.has(boardId)) {
      s.seatPlayer(boardId, role, seat, color);
    } else {
      setTimeout(retry, 500);
    }
  };
  setTimeout(retry, 500);
}
