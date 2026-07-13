import { Schema, defineTypes } from '@colyseus/schema';

export class PlayerState extends Schema {
  id: string = '';
  sessionId: string = '';
  username: string = '';
  rating: number = 0;
  region: string = '';
  x: number = 0;
  y: number = 0;
  targetX: number = 0;
  targetY: number = 0;
  direction: string = 'down';
  isMoving: boolean = false;
  currentBoardId: string = '';
}

defineTypes(PlayerState, {
  id: 'string',
  sessionId: 'string',
  username: 'string',
  rating: 'number',
  region: 'string',
  x: 'number',
  y: 'number',
  targetX: 'number',
  targetY: 'number',
  direction: 'string',
  isMoving: 'boolean',
  currentBoardId: 'string',
});
