import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { getWorldRoom } from '../game/network/colyseusClient';
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
    // Wait for modules to be loaded before seating
    if (state.modules.length === 0) return;

    const room = getWorldRoom();
    if (!room) return;

    // Check if arena modules are loaded in the scene
    const scene = (window as any).__worldScene;
    if (!scene || !scene.arenaManager || !scene.arenaManager.isLoaded) {
      // Retry after a short delay
      if (!seatRetryTimer.current) {
        seatRetryTimer.current = window.setTimeout(() => {
          seatRetryTimer.current = null;
        }, 500);
      }
      return;
    }

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

    seating.current = true;
    const color: 'w' | 'b' = myPairing.whitePlayerId === user.id ? 'w' : 'b';
    const opponentId = color === 'w' ? myPairing.blackPlayerId : myPairing.whitePlayerId;

    room.send('tournament_seat', {
      boardId: myPairing.runtimeTableId,
      baseTimeSeconds: state.baseTimeSeconds,
      incrementSeconds: state.incrementSeconds,
      timeCategory: state.timeControlCategory,
      timeLabel: state.timeControlLabel,
      opponentId,
      color,
    });

    if (!listenersAttached.current) {
      listenersAttached.current = true;

      room.onMessage('tournament_seated', (msg: { boardId: string; color: string; seat: string }) => {
        seatPlayerWhenReady(msg.boardId, 'player', msg.seat, msg.color as 'w' | 'b');
        seatedForRound.current = stateRef.current.currentRound;
        seating.current = false;
      });

      room.onMessage('match_started', (msg: { matchId: string; boardId: string; color: string }) => {
        const seat = msg.color === 'w' ? 'bottom' : 'top';
        seatPlayerWhenReady(msg.boardId, 'player', seat, msg.color as 'w' | 'b');
        seatedForRound.current = stateRef.current.currentRound;
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

  // Check if the table is in the registry
  if (scene.tableRegistry?.tables?.has(boardId)) {
    scene.seatPlayer(boardId, role, seat, color);
    return;
  }

  // Retry up to 10 times (5 seconds total)
  let attempts = 0;
  const retry = () => {
    attempts++;
    if (attempts > 10) return;
    const s = (window as any).__worldScene;
    if (s?.tableRegistry?.tables?.has(boardId)) {
      s.seatPlayer(boardId, role, seat, color);
    } else {
      setTimeout(retry, 500);
    }
  };
  setTimeout(retry, 500);
}
