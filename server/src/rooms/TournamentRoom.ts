import { Room, Client } from '@colyseus/core';
import { Schema, defineTypes } from '@colyseus/schema';
import * as service from '../tournament/service.js';
import { createClient } from '@supabase/supabase-js';

export class TournamentState extends Schema {
  tournamentId: string = '';
  data: string = '{}';
  lastUpdate: number = 0;
}

defineTypes(TournamentState, {
  tournamentId: 'string',
  data: 'string',
  lastUpdate: 'number',
});

interface JoinOptions {
  tournamentId: string;
  accessToken: string;
}

export class TournamentRoom extends Room<TournamentState> {
  private tournamentId: string = '';
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  async onCreate(_options: any) {
    this.setState(new TournamentState());
    this.autoDispose = true;
    this.maxClients = 50;

    this.onMessage('refresh', async (_client) => {
      await this.broadcastTournamentState();
    });
  }

  async onAuth(_client: Client, options: JoinOptions): Promise<boolean> {
    if (!options.accessToken || !options.tournamentId) {
      return false;
    }
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return false;

    try {
      const supabase = createClient(url, key);
      const { data, error } = await supabase.auth.getUser(options.accessToken);
      if (error || !data.user) return false;
      return true;
    } catch {
      return false;
    }
  }

  async onJoin(_client: Client, options: JoinOptions) {
    if (!this.tournamentId) {
      this.tournamentId = options.tournamentId;
      this.state.tournamentId = options.tournamentId;
      await this.broadcastTournamentState();

      this.refreshInterval = setInterval(async () => {
        await this.broadcastTournamentState();
      }, 5000);
    }
  }

  onLeave(_client: Client) {}

  onDispose() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  private async broadcastTournamentState() {
    if (!this.tournamentId) return;
    const t = await service.getTournament(this.tournamentId);
    if (t) {
      this.state.data = JSON.stringify(t);
      this.state.lastUpdate = Date.now();
    }
  }
}
