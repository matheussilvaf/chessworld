import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useGameStore } from '../stores/gameStore';
import { joinWorldRoom, leaveWorldRoom, getWorldRoom, isColyseusConfigured, getColyseusEndpoint } from '../game/network/colyseusClient';
import { create } from 'zustand';

export type ColyseusPhase =
  | 'not_configured'
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'connection_failed';

interface ColyseusState {
  phase: ColyseusPhase;
  connected: boolean;
  sessionId: string | null;
  roomId: string | null;
  error: string | null;
  setPhase: (phase: ColyseusPhase) => void;
  setConnected: (sessionId: string, roomId: string) => void;
  setError: (error: string) => void;
  reset: () => void;
}

export const useColyseusStore = create<ColyseusState>((set) => ({
  phase: isColyseusConfigured() ? 'idle' : 'not_configured',
  connected: false,
  sessionId: null,
  roomId: null,
  error: null,
  setPhase: (phase) => set({ phase }),
  setConnected: (sessionId, roomId) => set({
    phase: 'connected',
    connected: true,
    sessionId,
    roomId,
    error: null,
  }),
  setError: (error) => set({
    phase: 'connection_failed',
    connected: false,
    sessionId: null,
    roomId: null,
    error,
  }),
  reset: () => set({
    phase: isColyseusConfigured() ? 'idle' : 'not_configured',
    connected: false,
    sessionId: null,
    roomId: null,
    error: null,
  }),
}));

export function useColyseusConnection() {
  const { user, profile } = useAuthStore();
  const { region, playerPosition } = useGameStore();
  const { setPhase, setConnected, setError } = useColyseusStore();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!isColyseusConfigured()) return;
    if (!user || !profile || !region || attemptedRef.current) return;
    attemptedRef.current = true;

    const endpoint = getColyseusEndpoint();

    console.log('[Colyseus] Connecting to:', endpoint);
    console.log('[Colyseus] Player:', profile.username, '| Region:', region);

    setPhase('connecting');

    const payload = {
      playerId: user.id,
      username: profile.username,
      rating: profile.rating,
      region,
      x: playerPosition.x,
      y: playerPosition.y,
    };

    console.log('[Colyseus] joinOrCreate("world") payload:', {
      ...payload,
      playerId: payload.playerId.slice(0, 8) + '...',
    });

    joinWorldRoom(payload)
      .then((room) => {
        console.log('[Colyseus] Connected! Room:', room.roomId, '| Session:', room.sessionId);
        setConnected(room.sessionId, room.roomId);
      })
      .catch((err) => {
        const message = err.message || String(err);
        console.error('[Colyseus] Connection failed.');
        console.error('[Colyseus] Endpoint:', endpoint);
        console.error('[Colyseus] Error:', message);
        if (err.stack) console.error('[Colyseus] Stack:', err.stack);
        setError(message);
        attemptedRef.current = false;
      });

    return () => {
      const room = getWorldRoom();
      if (room) {
        leaveWorldRoom();
        useColyseusStore.getState().reset();
        attemptedRef.current = false;
      }
    };
  }, [user, profile, region]);
}
