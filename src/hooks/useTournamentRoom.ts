import { useState, useEffect, useRef, useCallback } from 'react';
import { Client, Room } from 'colyseus.js';
import { getColyseusWsUrl } from '../config/colyseus';
import { supabase } from '../lib/supabase';

export function useTournamentRoom(tournamentId: string | null) {
  const [tournament, setTournament] = useState<any>(null);
  const [connected, setConnected] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const clientRef = useRef<Client | null>(null);

  const connect = useCallback(async (id: string) => {
    if (roomRef.current) {
      await roomRef.current.leave();
      roomRef.current = null;
    }

    const wsUrl = getColyseusWsUrl();
    if (!wsUrl) return;

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    try {
      if (!clientRef.current) {
        clientRef.current = new Client(wsUrl);
      }
      const room = await clientRef.current.joinOrCreate('tournament', {
        tournamentId: id,
        accessToken: token,
      });

      roomRef.current = room;
      setConnected(true);

      room.state.listen('data', (value: string) => {
        try {
          const parsed = JSON.parse(value);
          setTournament(parsed);
        } catch { /* ignore parse errors */ }
      });

      room.onLeave(() => {
        setConnected(false);
        roomRef.current = null;
      });
    } catch (e) {
      console.warn('[TournamentRoom] Failed to connect:', (e as Error).message);
      setConnected(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (roomRef.current) {
      await roomRef.current.leave();
      roomRef.current = null;
    }
    setConnected(false);
  }, []);

  const requestRefresh = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.send('refresh');
    }
  }, []);

  useEffect(() => {
    if (tournamentId) {
      connect(tournamentId);
    } else {
      disconnect();
    }
    return () => { disconnect(); };
  }, [tournamentId]);

  return { tournament, connected, requestRefresh, disconnect };
}
