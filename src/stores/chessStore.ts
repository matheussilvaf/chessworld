import { create } from 'zustand';
import { Chess } from 'chess.js';
import { supabase } from '../lib/supabase';
import { broadcastBoardStatus } from '../hooks/useRealtimeBoards';
import type { Match, MatchMove } from '../types';

async function broadcastBoardFree(boardId: string, region: string) {
  const { data } = await supabase.from('boards').select('name').eq('id', boardId).maybeSingle();
  if (data?.name) {
    broadcastBoardStatus(region, data.name, 'free');
  }
}

interface ChessState {
  match: Match | null;
  game: Chess | null;
  moves: MatchMove[];
  playerColor: 'w' | 'b' | null;
  selectedSquare: string | null;
  validMoves: string[];
  isMyTurn: boolean;
  gameOver: boolean;
  result: string | null;
  isSpectating: boolean;
  whiteTimeMs: number;
  blackTimeMs: number;
  lastMoveAt: number;
  timerRunning: boolean;
  broadcastChannel: ReturnType<typeof supabase.channel> | null;

  initMatch: (match: Match, userId: string) => void;
  initSpectate: (match: Match) => void;
  selectSquare: (square: string) => void;
  makeMove: (from: string, to: string, userId: string, promotion?: string) => Promise<boolean>;
  abandonMatch: (userId: string) => Promise<void>;
  timeoutLoss: (userId: string) => Promise<void>;
  addMove: (move: MatchMove) => void;
  syncState: (match: Match) => void;
  syncGameOver: (match: Match) => void;
  syncFen: (fen: string, turn: string) => void;
  tickTimer: () => void;
  reset: () => void;
}

export const useChessStore = create<ChessState>((set, get) => ({
  match: null,
  game: null,
  moves: [],
  playerColor: null,
  selectedSquare: null,
  validMoves: [],
  isMyTurn: false,
  gameOver: false,
  result: null,
  isSpectating: false,
  whiteTimeMs: 600000,
  blackTimeMs: 600000,
  lastMoveAt: Date.now(),
  timerRunning: false,
  broadcastChannel: null,

  initMatch: (match, userId) => {
    const game = new Chess(match.current_fen);
    const playerColor = match.white_user_id === userId ? 'w' : 'b';
    const isMyTurn = match.turn === playerColor;
    const gameOver = match.status !== 'playing';
    const serverLastMove = match.last_move_at ? new Date(match.last_move_at).getTime() : Date.now();

    // Cleanup old broadcast channel
    const oldChannel = get().broadcastChannel;
    if (oldChannel) supabase.removeChannel(oldChannel);

    // Create broadcast channel for this match (instant WebSocket sync)
    const channel = supabase.channel(`chess_match_${match.id}`, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'move' }, (payload) => {
      const data = payload.payload as Match;
      const state = get();
      if (state.gameOver) return;
      state.syncState(data);
    });

    channel.on('broadcast', { event: 'game_over' }, (payload) => {
      const data = payload.payload as Match;
      get().syncGameOver(data);
    });

    channel.subscribe();

    set({
      match,
      game,
      playerColor,
      isMyTurn,
      gameOver,
      result: match.result,
      moves: [],
      selectedSquare: null,
      validMoves: [],
      isSpectating: false,
      whiteTimeMs: match.white_time_ms,
      blackTimeMs: match.black_time_ms,
      lastMoveAt: serverLastMove,
      timerRunning: !gameOver,
      broadcastChannel: channel,
    });
  },

  initSpectate: (match) => {
    const game = new Chess(match.current_fen);
    const serverLastMove = match.last_move_at ? new Date(match.last_move_at).getTime() : Date.now();

    const oldChannel = get().broadcastChannel;
    if (oldChannel) supabase.removeChannel(oldChannel);

    const channel = supabase.channel(`chess_match_${match.id}`, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'move' }, (payload) => {
      const data = payload.payload as Match;
      const state = get();
      if (state.gameOver) return;
      state.syncState(data);
    });

    channel.on('broadcast', { event: 'game_over' }, (payload) => {
      const data = payload.payload as Match;
      get().syncGameOver(data);
    });

    channel.subscribe();

    set({
      match,
      game,
      playerColor: 'w',
      isMyTurn: false,
      gameOver: match.status !== 'playing',
      result: match.result,
      moves: [],
      selectedSquare: null,
      validMoves: [],
      isSpectating: true,
      whiteTimeMs: match.white_time_ms,
      blackTimeMs: match.black_time_ms,
      lastMoveAt: serverLastMove,
      timerRunning: match.status === 'playing',
      broadcastChannel: channel,
    });
  },

  selectSquare: (square) => {
    const { game, playerColor, isMyTurn, selectedSquare, gameOver, isSpectating } = get();
    if (!game || !playerColor || !isMyTurn || gameOver || isSpectating) return;

    const piece = game.get(square as any);

    if (selectedSquare) {
      set({ selectedSquare: null, validMoves: [] });
      return;
    }

    if (piece && piece.color === playerColor) {
      const moves = game.moves({ square: square as any, verbose: true });
      set({ selectedSquare: square, validMoves: moves.map(m => m.to) });
    }
  },

  makeMove: async (from, to, userId, promotion) => {
    const { game, match, playerColor, whiteTimeMs, blackTimeMs, lastMoveAt, broadcastChannel } = get();
    if (!game || !match || !playerColor) return false;

    const moveResult = game.move({ from: from as any, to: to as any, promotion: promotion as any || 'q' });
    if (!moveResult) return false;

    const now = Date.now();
    const elapsed = now - lastMoveAt;
    const incrementMs = (match.increment_seconds || 0) * 1000;

    let newWhiteTime = whiteTimeMs;
    let newBlackTime = blackTimeMs;
    if (playerColor === 'w') {
      newWhiteTime = Math.max(0, whiteTimeMs - elapsed + incrementMs);
    } else {
      newBlackTime = Math.max(0, blackTimeMs - elapsed + incrementMs);
    }

    const newFen = game.fen();
    const moveNumber = Math.ceil(game.moveNumber());
    let status = 'playing';
    let winnerId: string | null = null;
    let result: string | null = null;

    if (game.isCheckmate()) {
      status = playerColor === 'w' ? 'white_wins' : 'black_wins';
      winnerId = userId;
      result = 'checkmate';
    } else if (game.isDraw()) {
      status = 'draw';
      result = game.isStalemate() ? 'stalemate' : 'draw';
    }

    const nowIso = new Date().toISOString();

    const updateData: Record<string, any> = {
      current_fen: newFen,
      turn: game.turn(),
      pgn: game.pgn(),
      white_time_ms: newWhiteTime,
      black_time_ms: newBlackTime,
      last_move_at: nowIso,
    };

    if (status !== 'playing') {
      updateData.status = status;
      updateData.winner_user_id = winnerId;
      updateData.result = result;
      updateData.finished_at = nowIso;
    }

    const updatedMatch: Match = { ...match, ...updateData };

    // Immediately update local state
    set({
      match: updatedMatch,
      isMyTurn: false,
      gameOver: status !== 'playing',
      result,
      selectedSquare: null,
      validMoves: [],
      whiteTimeMs: newWhiteTime,
      blackTimeMs: newBlackTime,
      lastMoveAt: now,
      timerRunning: status === 'playing',
    });

    // Broadcast to opponent/spectators instantly via WebSocket
    if (broadcastChannel) {
      const event = status !== 'playing' ? 'game_over' : 'move';
      broadcastChannel.send({ type: 'broadcast', event, payload: updatedMatch });
    }

    // Persist to DB (async, non-blocking for UI)
    supabase.from('match_moves').insert({
      match_id: match.id,
      move_number: moveNumber,
      user_id: userId,
      from_square: from,
      to_square: to,
      san: moveResult.san,
      fen_after: newFen,
    });

    await supabase.from('matches').update(updateData).eq('id', match.id);

    if (status !== 'playing') {
      await handleMatchEnd(match, status, winnerId);
      await supabase.from('boards').update({ status: 'free', waiting_user_id: null, current_match_id: null }).eq('id', match.board_id);
      broadcastBoardFree(match.board_id, match.region);
    }

    return true;
  },

  abandonMatch: async (_userId) => {
    const { match, playerColor, broadcastChannel } = get();
    if (!match) return;

    const winnerId = playerColor === 'w' ? match.black_user_id : match.white_user_id;
    const status = playerColor === 'w' ? 'black_wins' : 'white_wins';

    const updatedMatch: Match = { ...match, status, winner_user_id: winnerId, result: 'resigned' };

    set({ gameOver: true, result: 'resigned', timerRunning: false, match: updatedMatch });

    // Broadcast game over instantly
    if (broadcastChannel) {
      broadcastChannel.send({ type: 'broadcast', event: 'game_over', payload: updatedMatch });
    }

    await supabase.from('matches').update({
      status,
      winner_user_id: winnerId,
      result: 'resigned',
      finished_at: new Date().toISOString(),
    }).eq('id', match.id);

    await supabase.from('boards').update({ status: 'free', waiting_user_id: null, current_match_id: null }).eq('id', match.board_id);
    broadcastBoardFree(match.board_id, match.region);
    await handleMatchEnd(match, status, winnerId);
  },

  timeoutLoss: async (_userId) => {
    const { match, playerColor, broadcastChannel, whiteTimeMs, blackTimeMs } = get();
    if (!match || get().gameOver) return;

    const winnerId = playerColor === 'w' ? match.black_user_id : match.white_user_id;
    const status = playerColor === 'w' ? 'black_wins' : 'white_wins';

    const updatedMatch: Match = {
      ...match,
      status,
      winner_user_id: winnerId,
      result: 'timeout',
      white_time_ms: playerColor === 'w' ? 0 : whiteTimeMs,
      black_time_ms: playerColor === 'b' ? 0 : blackTimeMs,
    };

    set({ gameOver: true, result: 'timeout', timerRunning: false, match: updatedMatch });

    if (broadcastChannel) {
      broadcastChannel.send({ type: 'broadcast', event: 'game_over', payload: updatedMatch });
    }

    await supabase.from('matches').update({
      status,
      winner_user_id: winnerId,
      result: 'timeout',
      finished_at: new Date().toISOString(),
      white_time_ms: playerColor === 'w' ? 0 : whiteTimeMs,
      black_time_ms: playerColor === 'b' ? 0 : blackTimeMs,
    }).eq('id', match.id);

    await supabase.from('boards').update({ status: 'free', waiting_user_id: null, current_match_id: null }).eq('id', match.board_id);
    broadcastBoardFree(match.board_id, match.region);
    await handleMatchEnd(match, status, winnerId);
  },

  addMove: (move) => {
    set((s) => ({ moves: [...s.moves, move] }));
  },

  syncState: (matchData) => {
    const { game, playerColor } = get();
    if (!game) return;

    game.load(matchData.current_fen);
    const isMyTurn = !get().isSpectating && matchData.turn === playerColor;
    const serverLastMove = matchData.last_move_at ? new Date(matchData.last_move_at).getTime() : Date.now();

    set({
      match: matchData,
      isMyTurn,
      selectedSquare: null,
      validMoves: [],
      whiteTimeMs: matchData.white_time_ms,
      blackTimeMs: matchData.black_time_ms,
      lastMoveAt: serverLastMove,
    });
  },

  syncGameOver: (matchData) => {
    const { game } = get();
    if (!game) return;
    if (matchData.current_fen) {
      game.load(matchData.current_fen);
    }

    set({
      match: matchData,
      gameOver: true,
      result: matchData.result,
      isMyTurn: false,
      timerRunning: false,
      whiteTimeMs: matchData.white_time_ms,
      blackTimeMs: matchData.black_time_ms,
      selectedSquare: null,
      validMoves: [],
    });
  },

  syncFen: (fen, turn) => {
    const { game, playerColor } = get();
    if (!game) return;
    game.load(fen);
    set({ isMyTurn: turn === playerColor, selectedSquare: null, validMoves: [] });
  },

  tickTimer: () => {
    const { timerRunning, gameOver, match, lastMoveAt, playerColor, isSpectating } = get();
    if (!timerRunning || gameOver || !match) return;

    const now = Date.now();
    const elapsed = now - lastMoveAt;
    const activeSide = match.turn;

    // Compute displayed time: server remaining minus elapsed since last move
    let displayWhite = match.white_time_ms;
    let displayBlack = match.black_time_ms;

    if (activeSide === 'w') {
      displayWhite = Math.max(0, match.white_time_ms - elapsed);
    } else {
      displayBlack = Math.max(0, match.black_time_ms - elapsed);
    }

    set({ whiteTimeMs: displayWhite, blackTimeMs: displayBlack });

    // Check for timeout - only the active player reports their own timeout
    if (!isSpectating && activeSide === playerColor) {
      if ((activeSide === 'w' && displayWhite <= 0) || (activeSide === 'b' && displayBlack <= 0)) {
        set({ timerRunning: false });
      }
    }
  },

  reset: () => {
    const oldChannel = get().broadcastChannel;
    if (oldChannel) supabase.removeChannel(oldChannel);

    set({
      match: null, game: null, moves: [], playerColor: null,
      selectedSquare: null, validMoves: [], isMyTurn: false, gameOver: false, result: null, isSpectating: false,
      whiteTimeMs: 600000, blackTimeMs: 600000, lastMoveAt: Date.now(), timerRunning: false, broadcastChannel: null,
    });
  },
}));

async function handleMatchEnd(match: Match, status: string, winnerId: string | null) {
  if (winnerId) {
    const loserId = winnerId === match.white_user_id ? match.black_user_id : match.white_user_id;
    await supabase.rpc('increment_profile_stats', { p_user_id: winnerId, p_is_win: true });
    await supabase.rpc('increment_profile_stats', { p_user_id: loserId, p_is_win: false });
  } else if (status === 'draw') {
    for (const uid of [match.white_user_id, match.black_user_id]) {
      const { data } = await supabase.from('profiles').select('draws, games_played').eq('user_id', uid).maybeSingle();
      if (data) {
        await supabase.from('profiles').update({
          draws: data.draws + 1,
          games_played: data.games_played + 1,
        }).eq('user_id', uid);
      }
    }
  }
}
