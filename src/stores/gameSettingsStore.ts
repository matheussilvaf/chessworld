import { create } from 'zustand';
import { supabase } from '../lib/supabase';

interface GameSettingsState {
  defaultZoom: number;
  playerSpeed: number;
  loaded: boolean;
  load: () => Promise<void>;
  subscribe: () => () => void;
}

export const useGameSettingsStore = create<GameSettingsState>((set) => ({
  defaultZoom: 2,
  playerSpeed: 3,
  loaded: false,

  load: async () => {
    const { data } = await supabase
      .from('game_settings')
      .select('default_zoom, player_speed')
      .eq('id', 1)
      .maybeSingle();
    if (data) {
      set({
        defaultZoom: Number(data.default_zoom),
        playerSpeed: Number(data.player_speed),
        loaded: true,
      });
    } else {
      set({ loaded: true });
    }
  },

  subscribe: () => {
    const channel = supabase
      .channel('game_settings_changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'game_settings', filter: 'id=eq.1' },
        (payload) => {
          const row = payload.new as { default_zoom: number; player_speed: number };
          set({
            defaultZoom: Number(row.default_zoom),
            playerSpeed: Number(row.player_speed),
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
}));
