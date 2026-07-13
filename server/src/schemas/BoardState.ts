import { Schema, defineTypes } from '@colyseus/schema';

export class BoardState extends Schema {
  id: string = '';
  name: string = '';
  region: string = '';
  x: number = 0;
  y: number = 0;
  width: number = 80;
  height: number = 80;
  status: string = 'idle';
  waitingPlayerId: string = '';
  waitingPlayerName: string = '';
  whitePlayerId: string = '';
  blackPlayerId: string = '';
  matchId: string = '';
}

defineTypes(BoardState, {
  id: 'string',
  name: 'string',
  region: 'string',
  x: 'number',
  y: 'number',
  width: 'number',
  height: 'number',
  status: 'string',
  waitingPlayerId: 'string',
  waitingPlayerName: 'string',
  whitePlayerId: 'string',
  blackPlayerId: 'string',
  matchId: 'string',
});
