import { Client, Room } from 'colyseus.js';
import { getColyseusWsUrl, isColyseusConfigured as checkConfigured } from '../../config/colyseus';

export function isColyseusConfigured(): boolean {
  return checkConfigured();
}

export function getColyseusEndpoint(): string {
  return getColyseusWsUrl();
}

let client: Client | null = null;

function getClient(): Client {
  if (!client) {
    client = new Client(getColyseusWsUrl());
  }
  return client;
}

let worldRoom: Room<any> | null = null;
let joinInProgress: Promise<Room<any>> | null = null;

export function getWorldRoom(): Room<any> | null {
  return worldRoom;
}

export async function joinWorldRoom(options: {
  playerId: string;
  username: string;
  rating: number;
  region: string;
  x: number;
  y: number;
}): Promise<Room<any>> {
  if (!isColyseusConfigured()) {
    throw new Error('VITE_COLYSEUS_URL is not configured');
  }

  if (worldRoom) {
    console.log('[Colyseus] Already connected, reusing existing room');
    return worldRoom;
  }

  if (joinInProgress) {
    console.log('[Colyseus] Join already in progress, waiting...');
    return joinInProgress;
  }

  console.log(`[Colyseus] joining world region: ${options.region}`);

  joinInProgress = getClient().joinOrCreate('world', options);

  try {
    const room = await joinInProgress;
    worldRoom = room;
    console.log(`[Colyseus] roomId: ${room.roomId}`);
    console.log(`[Colyseus] sessionId: ${room.sessionId}`);
    return room;
  } finally {
    joinInProgress = null;
  }
}

export async function leaveWorldRoom(): Promise<void> {
  joinInProgress = null;

  if (worldRoom) {
    const room = worldRoom;
    worldRoom = null;
    console.log(`[Colyseus] Leaving room: ${room.roomId}`);
    try {
      await room.leave(true);
      console.log('[Colyseus] Left room successfully');
    } catch (e) {
      console.warn('[Colyseus] Error during leave (ignored):', e);
    }
  }
}

export function sendMovement(data: {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: string;
  isMoving: boolean;
}) {
  worldRoom?.send('move_to', data);
}

export function sendCreateChallenge(data: {
  boardId: string;
  timeCategory: string;
  baseMinutes: number;
  incrementSeconds: number;
  timeLabel: string;
  side?: 'w' | 'b' | 'random';
}) {
  worldRoom?.send('create_challenge', data);
}

export function sendAcceptChallenge(boardId: string) {
  worldRoom?.send('accept_challenge', { boardId });
}

export function sendBoardCancel(boardId: string) {
  worldRoom?.send('cancel_waiting', { boardId });
}

export function sendChessMove(matchId: string, from: string, to: string, promotion?: string) {
  worldRoom?.send('chess_move', { matchId, from, to, promotion });
}

export function sendResign(matchId: string) {
  worldRoom?.send('chess_resign', { matchId });
}

export function sendDrawOffer(matchId: string) {
  worldRoom?.send('chess_draw_offer', { matchId });
}

export function sendDrawAccept(matchId: string) {
  worldRoom?.send('chess_draw_accept', { matchId });
}

export function sendChat(message: string) {
  worldRoom?.send('chat', { message });
}

export function sendSitSpectator(boardId: string, seatKey: string) {
  worldRoom?.send('sit_spectator', { boardId, seatKey });
}

export function sendLeaveSeat(boardId: string) {
  worldRoom?.send('leave_seat', { boardId });
}

export function registerBoards(boards: { id: string; name: string; x: number; y: number; width?: number; height?: number }[]) {
  worldRoom?.send('register_boards', { boards });
}
