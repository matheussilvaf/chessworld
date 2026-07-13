import { Room, Client } from '@colyseus/core';
import { Chess } from 'chess.js';
import { nanoid } from 'nanoid';
import { WorldState } from '../schemas/WorldState.js';
import { PlayerState } from '../schemas/PlayerState.js';
import { BoardState } from '../schemas/BoardState.js';
import { MatchState } from '../schemas/MatchState.js';

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
  private tickInterval!: ReturnType<typeof setInterval>;
  private readonly TICK_RATE = 20;

  onCreate() {
    this.setState(new WorldState());
    this.setSimulationInterval(() => this.tick(), 1000 / this.TICK_RATE);
    this.maxClients = 100;

    this.onMessage('movement', (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.x = data.x;
      player.y = data.y;
      player.targetX = data.targetX;
      player.targetY = data.targetY;
      player.direction = data.direction;
      player.isMoving = data.isMoving;
    });

    this.onMessage('register_boards', (_client, data) => {
      const { boards } = data as { boards: { id: string; name: string; x: number; y: number }[] };
      for (const b of boards) {
        if (!this.state.boards.has(b.id)) {
          const board = new BoardState();
          board.id = b.id;
          board.name = b.name;
          board.x = b.x;
          board.y = b.y;
          board.status = 'idle';
          this.state.boards.set(b.id, board);
        }
      }
      console.log(`[WorldRoom] Registered ${boards.length} boards`);
    });

    this.onMessage('board_join', (client, data) => {
      const { boardId, playerName } = data as { boardId: string; playerName: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const board = this.state.boards.get(boardId);
      if (!board) {
        client.send('error', { message: 'Board not found' });
        return;
      }

      if (board.status === 'idle') {
        board.status = 'waiting';
        board.waitingPlayerId = player.id;
        board.waitingPlayerName = playerName;
        this.broadcast('board_update', { boardId, status: 'waiting', waitingPlayerId: player.id, waitingPlayerName: playerName });
        console.log(`[WorldRoom] ${playerName} waiting at board ${boardId}`);
      } else if (board.status === 'waiting') {
        if (board.waitingPlayerId === player.id) {
          client.send('error', { message: 'Already waiting here' });
          return;
        }
        this.startMatch(board, player, client);
      } else {
        client.send('error', { message: 'Board in match' });
      }
    });

    this.onMessage('board_cancel', (client, data) => {
      const { boardId } = data as { boardId: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const board = this.state.boards.get(boardId);
      if (!board || board.waitingPlayerId !== player.id) return;

      board.status = 'idle';
      board.waitingPlayerId = '';
      board.waitingPlayerName = '';
      this.broadcast('board_update', { boardId, status: 'idle' });
    });

    this.onMessage('chess_move', (client, data) => {
      const { matchId, from, to, promotion } = data as { matchId: string; from: string; to: string; promotion?: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const match = this.state.matches.get(matchId);
      if (!match || match.status !== 'playing') {
        client.send('error', { message: 'Match not found or finished' });
        return;
      }

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

      match.fen = game.fen();
      match.pgn = game.pgn();
      match.turn = game.turn();

      if (game.isGameOver()) {
        let winnerId = '';
        let reason = 'draw';
        if (game.isCheckmate()) {
          winnerId = match.turn === 'w' ? match.blackPlayerId : match.whitePlayerId;
          reason = 'checkmate';
        } else if (game.isStalemate()) {
          reason = 'stalemate';
        } else if (game.isThreefoldRepetition()) {
          reason = 'repetition';
        } else if (game.isInsufficientMaterial()) {
          reason = 'insufficient_material';
        }
        this.finishMatch(matchId, winnerId, reason);
      }
    });

    this.onMessage('chess_resign', (client, data) => {
      const { matchId } = data as { matchId: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const match = this.state.matches.get(matchId);
      if (!match || match.status !== 'playing') return;

      const winnerId = player.id === match.whitePlayerId ? match.blackPlayerId : match.whitePlayerId;
      this.finishMatch(matchId, winnerId, 'resign');
    });

    this.onMessage('chess_draw_offer', (client, data) => {
      const { matchId } = data as { matchId: string };
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const match = this.state.matches.get(matchId);
      if (!match || match.status !== 'playing') return;

      const opponentSessionId = this.findSessionByPlayerId(
        player.id === match.whitePlayerId ? match.blackPlayerId : match.whitePlayerId
      );
      if (opponentSessionId) {
        const opponent = this.clients.find(c => c.sessionId === opponentSessionId);
        opponent?.send('draw_offered', { matchId, offeredBy: player.id });
      }
    });

    this.onMessage('chess_draw_accept', (_client, data) => {
      const { matchId } = data as { matchId: string };
      this.finishMatch(matchId, '', 'draw_agreement');
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

    console.log('[WorldRoom] Created');
  }

  onJoin(client: Client, options: JoinOptions) {
    const player = new PlayerState();
    player.id = options.playerId;
    player.sessionId = client.sessionId;
    player.username = options.username;
    player.rating = options.rating;
    player.region = options.region;
    player.x = options.x;
    player.y = options.y;
    player.targetX = options.x;
    player.targetY = options.y;
    player.direction = 'down';
    player.isMoving = false;

    this.state.players.set(client.sessionId, player);
    console.log(`[WorldRoom] ${options.username} joined (${this.state.players.size} players)`);
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      // Clean up boards where this player was waiting
      this.state.boards.forEach((board, boardId) => {
        if (board.waitingPlayerId === player.id) {
          board.status = 'idle';
          board.waitingPlayerId = '';
          board.waitingPlayerName = '';
          this.broadcast('board_update', { boardId, status: 'idle' });
        }
      });

      console.log(`[WorldRoom] ${player.username} left`);
      this.state.players.delete(client.sessionId);
    }
  }

  onDispose() {
    console.log('[WorldRoom] Disposed');
    activeGames.clear();
  }

  private tick() {
    // State is automatically synced by Colyseus schema
    // Additional tick logic can go here if needed
  }

  private startMatch(board: BoardState, joiningPlayer: PlayerState, joiningClient: Client) {
    const matchId = nanoid();
    const chess = new Chess();

    const match = new MatchState();
    match.id = matchId;
    match.boardId = board.id;
    match.region = joiningPlayer.region;
    match.whitePlayerId = board.waitingPlayerId;
    match.blackPlayerId = joiningPlayer.id;
    match.fen = chess.fen();
    match.pgn = '';
    match.status = 'playing';
    match.turn = 'w';

    activeGames.set(matchId, chess);
    this.state.matches.set(matchId, match);

    board.status = 'playing';
    board.whitePlayerId = board.waitingPlayerId;
    board.blackPlayerId = joiningPlayer.id;
    board.matchId = matchId;
    board.waitingPlayerId = '';
    board.waitingPlayerName = '';

    // Notify both players
    const whiteSessionId = this.findSessionByPlayerId(match.whitePlayerId);
    if (whiteSessionId) {
      const whiteClient = this.clients.find(c => c.sessionId === whiteSessionId);
      whiteClient?.send('match_started', { matchId, boardId: board.id, color: 'w' });
    }
    joiningClient.send('match_started', { matchId, boardId: board.id, color: 'b' });

    this.broadcast('board_update', { boardId: board.id, status: 'playing' });
    console.log(`[WorldRoom] Match ${matchId} started`);
  }

  private finishMatch(matchId: string, winnerId: string, reason: string) {
    const match = this.state.matches.get(matchId);
    if (!match) return;

    match.status = 'finished';
    activeGames.delete(matchId);

    // Reset board
    const board = this.state.boards.get(match.boardId);
    if (board) {
      board.status = 'idle';
      board.whitePlayerId = '';
      board.blackPlayerId = '';
      board.matchId = '';
      this.broadcast('board_update', { boardId: board.id, status: 'idle' });
    }

    this.broadcast('match_finished', { matchId, winnerId, reason });

    // Clean up match after a delay
    setTimeout(() => {
      this.state.matches.delete(matchId);
    }, 5000);

    console.log(`[WorldRoom] Match ${matchId} finished: ${reason} (winner: ${winnerId || 'none'})`);
  }

  private findSessionByPlayerId(playerId: string): string | undefined {
    let found: string | undefined;
    this.state.players.forEach((p, sessionId) => {
      if (p.id === playerId) found = sessionId;
    });
    return found;
  }
}
