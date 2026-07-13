import { Client, Room } from 'colyseus.js';

const COLYSEUS_URL = import.meta.env.VITE_COLYSEUS_URL || '';

export function isColyseusConfigured(): boolean {
  return COLYSEUS_URL.length > 0;
}

export function getColyseusEndpoint(): string {
  return COLYSEUS_URL;
}

let client: Client | null = null;

function getClient(): Client {
  if (!client) {
    client = new Client(COLYSEUS_URL);
  }
  return client;
}

let worldRoom: Room | null = null;

export function getWorldRoom(): Room | null {
  return worldRoom;
}

export async function joinWorldRoom(options: {
  playerId: string;
  username: string;
  rating: number;
  region: string;
  x: number;
  y: number;
}): Promise<Room> {
  if (!isColyseusConfigured()) {
    throw new Error('VITE_COLYSEUS_URL is not configured');
  }

  worldRoom = await getClient().joinOrCreate('world', options);
  return worldRoom;
}

export async function leaveWorldRoom(): Promise<void> {
  if (worldRoom) {
    await worldRoom.leave();
    worldRoom = null;
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
  worldRoom?.send('movement', data);
}

export function sendBoardJoin(boardId: string, playerName: string) {
  worldRoom?.send('board_join', { boardId, playerName });
}

export function sendBoardCancel(boardId: string) {
  worldRoom?.send('board_cancel', { boardId });
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

export function registerBoards(boards: { id: string; name: string; x: number; y: number }[]) {
  worldRoom?.send('register_boards', { boards });
}
