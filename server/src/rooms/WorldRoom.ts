import { Room, Client } from '@colyseus/core';
import { Chess } from 'chess.js';
import { nanoid } from 'nanoid';
import { WorldState } from '../schemas/WorldState.js';
import { PlayerState } from '../schemas/PlayerState.js';
import { BoardState } from '../schemas/BoardState.js';
import { MatchState } from '../schemas/MatchState.js';
import { VoiceParticipantState } from '../schemas/VoiceParticipantState.js';

interface JoinOptions {
  playerId: string;
  username: string;
  rating: number;
  region: string;
  x: number;
  y: number;
}

const activeGames = new Map<string, Chess>();

export class WorldRoom extends Room<WorldState> {
  private readonly TICK_RATE = 20;

  onCreate(options: any) {
    this.setState(new WorldState());
    this.setSimulationInterval(() => this.tick(), 1000 / this.TICK_RATE);
    this.maxClients = 100;

    console.log(`[WorldRoom] Created for region: ${options.region || 'unknown'} | roomId: ${this.roomId}`);

    this.onMessage('move_to', (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.x = data.x;
      player.y = data.y;
      player.targetX = data.targetX;
      player.targetY = data.targetY;
      player.direction = data.direction;
      player.isMoving = data.isMoving;
    });

    this.onMessage('register_boards', (client, data) => {
      const { boards } = data as { boards: { id: string; name: string; x: number; y: number; width?: number; height?: number }[] };
      let registered = 0;
      for (const b of boards) {
        if (!this.state.boards.has(b.id)) {
          const board = new BoardState();
          board.id = b.id;
          board.name = b.name;
          board.x = b.x;
          board.y = b.y;
          board.width = b.width || 80;
          board.height = b.height || 80;
          board.status = 'idle';
          this.state.boards.set(b.id, board);
          registered++;
        }
      }
      if (registered > 0) {
        console.log(`[WorldRoom] Boards registered: ${registered} (total: ${this.state.boards.size})`);
      }
    });

    this.onMessage('create_challenge', (client, data) => {
      const { boardId, timeCategory, baseMinutes, incrementSeconds, timeLabel } = data as {
        boardId: string; timeCategory: string; baseMinutes: number; incrementSeconds: number; timeLabel: string;
      };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const board = this.state.boards.get(boardId);
      if (!board || board.status !== 'idle') {
        client.send('error', { message: 'Board not available' });
        return;
      }

      board.status = 'waiting';
      board.waitingPlayerId = player.id;
      board.waitingPlayerName = player.username;
      board.timeCategory = timeCategory;
      board.baseMinutes = baseMinutes;
      board.incrementSeconds = incrementSeconds;
      board.timeLabel = timeLabel;
      player.currentBoardId = boardId;
    });

    this.onMessage('accept_challenge', (client, data) => {
      const { boardId } = data as { boardId: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const board = this.state.boards.get(boardId);
      if (!board || board.status !== 'waiting') {
        client.send('error', { message: 'No challenge to accept' });
        return;
      }

      if (board.waitingPlayerId === player.id) {
        client.send('error', { message: 'Cannot accept your own challenge' });
        return;
      }

      this.startMatch(board, player, client);
    });

    this.onMessage('cancel_waiting', (client, data) => {
      const { boardId } = data as { boardId: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const board = this.state.boards.get(boardId);
      if (!board || board.waitingPlayerId !== player.id) return;

      this.resetBoard(board);
      player.currentBoardId = '';
    });

    this.onMessage('chess_move', (client, data) => {
      const { matchId, from, to, promotion } = data as { matchId: string; from: string; to: string; promotion?: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const match = this.state.matches.get(matchId);
      if (!match || match.status !== 'playing') return;

      const game = activeGames.get(matchId);
      if (!game) return;

      const isWhite = match.whitePlayerId === player.id;
      const isBlack = match.blackPlayerId === player.id;
      if (!isWhite && !isBlack) return;
      if ((match.turn === 'w' && !isWhite) || (match.turn === 'b' && !isBlack)) {
        client.send('error', { message: 'Not your turn' });
        return;
      }

      const moveResult = game.move({ from, to, promotion: promotion || 'q' });
      if (!moveResult) {
        client.send('error', { message: 'Invalid move' });
        return;
      }

      const now = Date.now();
      const elapsed = now - match.lastMoveAt;

      if (match.turn === 'w') {
        match.whiteTimeMs = Math.max(0, match.whiteTimeMs - elapsed + match.incrementMs);
      } else {
        match.blackTimeMs = Math.max(0, match.blackTimeMs - elapsed + match.incrementMs);
      }

      match.fen = game.fen();
      match.pgn = game.pgn();
      match.turn = game.turn();
      match.lastMoveAt = now;
      match.lastMoveSan = moveResult.san;

      if (game.isGameOver()) {
        this.endMatch(matchId, game);
      }
    });

    this.onMessage('chess_resign', (client, data) => {
      const { matchId } = data as { matchId: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const match = this.state.matches.get(matchId);
      if (!match || match.status !== 'playing') return;

      const isWhite = match.whitePlayerId === player.id;
      const isBlack = match.blackPlayerId === player.id;
      if (!isWhite && !isBlack) return;

      match.status = 'finished';
      match.result = 'resign';
      match.winnerId = isWhite ? match.blackPlayerId : match.whitePlayerId;
      activeGames.delete(matchId);

      this.cleanupMatchBoard(match);
    });

    this.onMessage('chat', (client, data) => {
      const { message } = data as { message: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      this.broadcast('chat', {
        id: nanoid(),
        playerId: player.id,
        username: player.username,
        message,
        createdAt: new Date().toISOString(),
      });
    });

    this.onMessage('voice_joined', (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (this.state.voiceParticipants.has(client.sessionId)) return;

      const vp = new VoiceParticipantState();
      vp.sessionId = client.sessionId;
      vp.playerId = player.id;
      vp.username = player.username;
      vp.region = player.region;
      vp.joinedAt = Date.now();
      vp.muted = false;
      this.state.voiceParticipants.set(client.sessionId, vp);
      console.log(`[WorldRoom] Voice joined: ${player.username} | total voice: ${this.state.voiceParticipants.size}`);
    });

    this.onMessage('voice_left', (client) => {
      this.state.voiceParticipants.delete(client.sessionId);
    });

    this.onMessage('voice_muted_changed', (client, data) => {
      const { muted } = data as { muted: boolean };
      const vp = this.state.voiceParticipants.get(client.sessionId);
      if (vp) vp.muted = muted;
    });
  }

  onJoin(client: Client, options: JoinOptions) {
    const player = new PlayerState();
    player.id = options.playerId || client.sessionId;
    player.sessionId = client.sessionId;
    player.username = options.username || 'Anonymous';
    player.rating = options.rating || 1200;
    player.region = options.region || 'default';
    player.x = options.x || 800;
    player.y = options.y || 640;
    player.targetX = player.x;
    player.targetY = player.y;
    player.direction = 'down';
    player.isMoving = false;

    this.state.players.set(client.sessionId, player);
    console.log(`[WorldRoom] Player joined: ${player.username} (${client.sessionId}) | total: ${this.state.players.size}`);
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      console.log(`[WorldRoom] Player leaving: ${player.username} (${client.sessionId}) | consented: ${consented}`);

      this.state.boards.forEach((board) => {
        if (board.waitingPlayerId === player.id) {
          this.resetBoard(board);
        }
      });

      this.state.matches.forEach((match, matchId) => {
        if (match.status === 'playing') {
          const isWhite = match.whitePlayerId === player.id;
          const isBlack = match.blackPlayerId === player.id;
          if (isWhite || isBlack) {
            match.status = 'finished';
            match.result = 'abandon';
            match.winnerId = isWhite ? match.blackPlayerId : match.whitePlayerId;
            activeGames.delete(matchId);
            this.cleanupMatchBoard(match);
          }
        }
      });

      this.state.voiceParticipants.delete(client.sessionId);
      this.state.players.delete(client.sessionId);
      console.log(`[WorldRoom] Player removed: ${player.username} | remaining: ${this.state.players.size}`);
    }
  }

  onDispose() {
    activeGames.clear();
  }

  private tick() {
    const now = Date.now();
    this.state.matches.forEach((match, matchId) => {
      if (match.status !== 'playing') return;

      const elapsed = now - match.lastMoveAt;
      if (match.turn === 'w') {
        if (match.whiteTimeMs - elapsed <= 0) {
          match.whiteTimeMs = 0;
          match.status = 'finished';
          match.result = 'timeout';
          match.winnerId = match.blackPlayerId;
          activeGames.delete(matchId);
          this.cleanupMatchBoard(match);
        }
      } else {
        if (match.blackTimeMs - elapsed <= 0) {
          match.blackTimeMs = 0;
          match.status = 'finished';
          match.result = 'timeout';
          match.winnerId = match.whitePlayerId;
          activeGames.delete(matchId);
          this.cleanupMatchBoard(match);
        }
      }
    });
  }

  private resetBoard(board: BoardState) {
    board.status = 'idle';
    board.waitingPlayerId = '';
    board.waitingPlayerName = '';
    board.timeCategory = '';
    board.baseMinutes = 0;
    board.incrementSeconds = 0;
    board.timeLabel = '';
    board.whitePlayerId = '';
    board.blackPlayerId = '';
    board.matchId = '';
  }

  private cleanupMatchBoard(match: MatchState) {
    const board = this.state.boards.get(match.boardId);
    if (board) {
      this.resetBoard(board);
    }
  }

  private startMatch(board: BoardState, joiningPlayer: PlayerState, joiningClient: Client) {
    const matchId = nanoid();
    const chess = new Chess();
    const now = Date.now();
    const baseTimeMs = board.baseMinutes * 60 * 1000;
    const incrementMs = board.incrementSeconds * 1000;

    const whiteSessionId = this.findSessionByPlayerId(board.waitingPlayerId);
    let whitePlayerName = 'Player';
    if (whiteSessionId) {
      const whitePlayer = this.state.players.get(whiteSessionId);
      if (whitePlayer) whitePlayerName = whitePlayer.username;
    }

    const match = new MatchState();
    match.id = matchId;
    match.boardId = board.id;
    match.region = joiningPlayer.region;
    match.whitePlayerId = board.waitingPlayerId;
    match.blackPlayerId = joiningPlayer.id;
    match.whitePlayerName = whitePlayerName;
    match.blackPlayerName = joiningPlayer.username;
    match.fen = chess.fen();
    match.pgn = '';
    match.status = 'playing';
    match.turn = 'w';
    match.whiteTimeMs = baseTimeMs;
    match.blackTimeMs = baseTimeMs;
    match.incrementMs = incrementMs;
    match.lastMoveAt = now;
    match.winnerId = '';
    match.result = '';

    activeGames.set(matchId, chess);
    this.state.matches.set(matchId, match);

    board.status = 'playing';
    board.whitePlayerId = board.waitingPlayerId;
    board.blackPlayerId = joiningPlayer.id;
    board.matchId = matchId;
    board.waitingPlayerId = '';
    board.waitingPlayerName = '';

    joiningPlayer.currentBoardId = board.id;

    if (whiteSessionId) {
      const whiteClient = this.clients.find(c => c.sessionId === whiteSessionId);
      whiteClient?.send('match_started', { matchId, boardId: board.id, color: 'w' });
    }
    joiningClient.send('match_started', { matchId, boardId: board.id, color: 'b' });

    console.log(`[WorldRoom] Match started: ${matchId} (${whitePlayerName} vs ${joiningPlayer.username}) on ${board.name}`);
  }

  private endMatch(matchId: string, game: Chess) {
    const match = this.state.matches.get(matchId);
    if (!match) return;

    match.status = 'finished';
    activeGames.delete(matchId);

    if (game.isCheckmate()) {
      match.result = 'checkmate';
      match.winnerId = match.turn === 'w' ? match.blackPlayerId : match.whitePlayerId;
    } else if (game.isStalemate()) {
      match.result = 'stalemate';
    } else if (game.isThreefoldRepetition()) {
      match.result = 'repetition';
    } else if (game.isInsufficientMaterial()) {
      match.result = 'insufficient';
    } else {
      match.result = 'draw';
    }

    this.cleanupMatchBoard(match);
  }

  private findSessionByPlayerId(playerId: string): string | undefined {
    let found: string | undefined;
    this.state.players.forEach((p, sessionId) => {
      if (p.id === playerId) found = sessionId;
    });
    return found;
  }
}
