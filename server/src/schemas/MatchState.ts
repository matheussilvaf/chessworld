import { Schema, defineTypes } from '@colyseus/schema';

export class MatchState extends Schema {
  id: string = '';
  boardId: string = '';
  region: string = '';
  whitePlayerId: string = '';
  blackPlayerId: string = '';
  fen: string = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  pgn: string = '';
  status: string = 'playing';
  turn: string = 'w';
}

defineTypes(MatchState, {
  id: 'string',
  boardId: 'string',
  region: 'string',
  whitePlayerId: 'string',
  blackPlayerId: 'string',
  fen: 'string',
  pgn: 'string',
  status: 'string',
  turn: 'string',
});
