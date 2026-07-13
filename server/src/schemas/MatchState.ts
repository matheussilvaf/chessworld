import { Schema, defineTypes } from '@colyseus/schema';

export class MatchState extends Schema {
  id!: string;
  boardId!: string;
  region!: string;
  whitePlayerId!: string;
  blackPlayerId!: string;
  fen!: string;
  pgn!: string;
  status!: string;
  turn!: string;

  constructor() {
    super();
    this.id = '';
    this.boardId = '';
    this.region = '';
    this.whitePlayerId = '';
    this.blackPlayerId = '';
    this.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    this.pgn = '';
    this.status = 'playing';
    this.turn = 'w';
  }
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
