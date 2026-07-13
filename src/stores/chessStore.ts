import { create } from 'zustand';
import { Chess } from 'chess.js';
import { sendChessMove, sendResign, getWorldRoom } from '../game/network/colyseusClient';

interface ChessState {
  matchId: string | null;
  boardId: string | null;
  game: Chess | null;
  playerColor: 'w' | 'b' | null;
  selectedSquare: string | null;
  validMoves: string[];
  isMyTurn: boolean;
  gameOver: boolean;
  result: string | null;
  winnerId: string | null;
  isSpectating: boolean;
  whiteTimeMs: number;
  blackTimeMs: number;
  lastMoveAt: number;
  incrementMs: number;
  turn: string;
  whitePlayerName: string;
  blackPlayerName: string;
  whitePlayerId: string;
  blackPlayerId: string;
  showBoard: boolean;

  openMatch: (matchId: string, color: 'w' | 'b', userId: string) => void;
  openSpectate: (matchId: string) => void;
  syncFromColyseus: (matchData: any) => void;
  selectSquare: (square: string) => void;
  makeMove: (from: string, to: string, promotion?: string) => void;
  resign: () => void;
  closeBoard: () => void;
  reopenBoard: () => void;
  tickTimer: () => void;
  reset: () => void;
}

export const useChessStore = create<ChessState>((set, get) => ({
  matchId: null,
  boardId: null,
  game: null,
  playerColor: null,
  selectedSquare: null,
  validMoves: [],
  isMyTurn: false,
  gameOver: false,
  result: null,
  winnerId: null,
  isSpectating: false,
  whiteTimeMs: 600000,
  blackTimeMs: 600000,
  lastMoveAt: Date.now(),
  incrementMs: 0,
  turn: 'w',
  whitePlayerName: '',
  blackPlayerName: '',
  whitePlayerId: '',
  blackPlayerId: '',
  showBoard: false,

  openMatch: (matchId, color, _userId) => {
    const room = getWorldRoom();
    if (!room?.state?.matches) return;

    let matchData: any = null;
    room.state.matches.forEach((m: any, id: string) => {
      if (id === matchId) matchData = m;
    });

    if (!matchData) return;

    const game = new Chess(matchData.fen || undefined);

    set({
      matchId,
      boardId: matchData.boardId,
      game,
      playerColor: color,
      isMyTurn: matchData.turn === color,
      gameOver: matchData.status !== 'playing',
      result: matchData.result || null,
      winnerId: matchData.winnerId || null,
      isSpectating: false,
      whiteTimeMs: matchData.whiteTimeMs,
      blackTimeMs: matchData.blackTimeMs,
      lastMoveAt: matchData.lastMoveAt,
      incrementMs: matchData.incrementMs || 0,
      turn: matchData.turn,
      whitePlayerName: matchData.whitePlayerName || 'White',
      blackPlayerName: matchData.blackPlayerName || 'Black',
      whitePlayerId: matchData.whitePlayerId,
      blackPlayerId: matchData.blackPlayerId,
      selectedSquare: null,
      validMoves: [],
      showBoard: true,
    });
  },

  openSpectate: (matchId) => {
    const room = getWorldRoom();
    if (!room?.state?.matches) return;

    let matchData: any = null;
    room.state.matches.forEach((m: any, id: string) => {
      if (id === matchId) matchData = m;
    });

    if (!matchData) return;

    const game = new Chess(matchData.fen || undefined);

    set({
      matchId,
      boardId: matchData.boardId,
      game,
      playerColor: 'w',
      isMyTurn: false,
      gameOver: matchData.status !== 'playing',
      result: matchData.result || null,
      winnerId: matchData.winnerId || null,
      isSpectating: true,
      whiteTimeMs: matchData.whiteTimeMs,
      blackTimeMs: matchData.blackTimeMs,
      lastMoveAt: matchData.lastMoveAt,
      incrementMs: matchData.incrementMs || 0,
      turn: matchData.turn,
      whitePlayerName: matchData.whitePlayerName || 'White',
      blackPlayerName: matchData.blackPlayerName || 'Black',
      whitePlayerId: matchData.whitePlayerId,
      blackPlayerId: matchData.blackPlayerId,
      selectedSquare: null,
      validMoves: [],
      showBoard: true,
    });
  },

  syncFromColyseus: (matchData) => {
    const { matchId, game, playerColor, isSpectating } = get();
    if (!matchId || !game) return;
    if (matchData.id !== matchId) return;

    game.load(matchData.fen);

    const gameOver = matchData.status !== 'playing';
    const isMyTurn = !isSpectating && !gameOver && matchData.turn === playerColor;

    set({
      isMyTurn,
      gameOver,
      result: matchData.result || null,
      winnerId: matchData.winnerId || null,
      whiteTimeMs: matchData.whiteTimeMs,
      blackTimeMs: matchData.blackTimeMs,
      lastMoveAt: matchData.lastMoveAt,
      turn: matchData.turn,
      selectedSquare: null,
      validMoves: [],
    });
  },

  selectSquare: (square) => {
    const { game, playerColor, isMyTurn, selectedSquare, gameOver, isSpectating } = get();
    if (!game || !playerColor || !isMyTurn || gameOver || isSpectating) return;

    if (selectedSquare) {
      set({ selectedSquare: null, validMoves: [] });
      return;
    }

    const piece = game.get(square as any);
    if (piece && piece.color === playerColor) {
      const moves = game.moves({ square: square as any, verbose: true });
      set({ selectedSquare: square, validMoves: moves.map(m => m.to) });
    }
  },

  makeMove: (from, to, promotion) => {
    const { matchId, game, playerColor } = get();
    if (!matchId || !game || !playerColor) return;

    const piece = game.get(from as any);
    const actualPromotion = promotion || (piece?.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : undefined);

    sendChessMove(matchId, from, to, actualPromotion);

    set({ selectedSquare: null, validMoves: [] });
  },

  resign: () => {
    const { matchId } = get();
    if (!matchId) return;
    sendResign(matchId);
  },

  closeBoard: () => {
    set({ showBoard: false });
  },

  reopenBoard: () => {
    const { matchId } = get();
    if (matchId) {
      set({ showBoard: true });
    }
  },

  tickTimer: () => {
    // No-op: display time is computed in the component from server values
  },

  reset: () => {
    set({
      matchId: null, boardId: null, game: null, playerColor: null,
      selectedSquare: null, validMoves: [], isMyTurn: false, gameOver: false,
      result: null, winnerId: null, isSpectating: false, showBoard: false,
      whiteTimeMs: 600000, blackTimeMs: 600000, lastMoveAt: Date.now(),
      incrementMs: 0, turn: 'w', whitePlayerName: '', blackPlayerName: '',
      whitePlayerId: '', blackPlayerId: '',
    });
  },
}));
