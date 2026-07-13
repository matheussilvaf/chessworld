import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useGameStore } from '../stores/gameStore';
import { useChessStore } from '../stores/chessStore';
import { useAuthStore } from '../stores/authStore';
import type { Match } from '../types';

export function useRealtimeMatch() {
  const { region } = useGameStore();
  const { user } = useAuthStore();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!user || !region) return;

    // Check for an active match on page load/reconnect
    const checkForActiveMatch = async () => {
      const { data } = await supabase
        .from('matches')
        .select('*')
        .eq('region', region)
        .eq('status', 'playing')
        .or(`white_user_id.eq.${user.id},black_user_id.eq.${user.id}`)
        .maybeSingle();

      if (data) {
        const currentMatch = useGameStore.getState().currentMatch;
        if (!currentMatch || currentMatch.id !== data.id) {
          useGameStore.getState().setCurrentMatch(data);
          useChessStore.getState().initMatch(data, user.id);
        }
      }
    };

    checkForActiveMatch();

    // Postgres changes as backup for broadcast channel
    const matchChannel = supabase
      .channel(`match_pg_${region}_${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'matches',
        filter: `region=eq.${region}`,
      }, (payload) => {
        const matchData = payload.new as Match;
        if (!matchData) return;
        if (matchData.white_user_id === user.id || matchData.black_user_id === user.id) {
          if (matchData.status === 'playing') {
            const currentMatch = useGameStore.getState().currentMatch;
            if (!currentMatch || currentMatch.id !== matchData.id) {
              useGameStore.getState().setCurrentMatch(matchData);
              useChessStore.getState().initMatch(matchData, user.id);
            }
          }
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'matches',
        filter: `region=eq.${region}`,
      }, (payload) => {
        const matchData = payload.new as Match;
        if (!matchData) return;

        const chessState = useChessStore.getState();
        const gameState = useGameStore.getState();
        const currentMatch = gameState.currentMatch;

        if (!currentMatch || currentMatch.id !== matchData.id) return;

        // This serves as a fallback - the broadcast channel handles the instant sync
        if (matchData.status === 'playing') {
          // Only apply if our local FEN is behind (not already synced via broadcast)
          if (chessState.game && chessState.match && matchData.current_fen !== chessState.game.fen()) {
            chessState.syncState(matchData);
          }
        } else {
          if (!chessState.gameOver) {
            chessState.syncGameOver(matchData);
          }
        }
      })
      .subscribe();

    channelRef.current = matchChannel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, region]);
}
