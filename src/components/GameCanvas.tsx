import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { createPhaserGame, getWorldScene } from '../game/PhaserGame';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { getWorldRoom, registerBoards, sendMovement } from '../game/network/colyseusClient';
import { useColyseusStore } from '../hooks/useColyseusConnection';

export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneReadyRef = useRef(false);
  const listenersSetRef = useRef(false);
  const { setSelectedBoard, setBoardLocked } = useGameStore();
  const { user, profile } = useAuthStore();
  const { region } = useGameStore();

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const game = createPhaserGame(containerRef.current);
    gameRef.current = game;

    const setupScene = () => {
      const scene = getWorldScene(game);
      if (!scene || !scene.scene.isActive()) {
        setTimeout(setupScene, 200);
        return;
      }

      sceneReadyRef.current = true;

      if (user && region) {
        scene.setLocalPlayer(user.id, region);
      }

      scene.onBoardClick = (arenaId: string, arenaTitle: string) => {
        if (!user || !profile || !region) return;
        const state = useGameStore.getState();
        if (state.selectedBoard || state.boardLocked) return;

        setSelectedBoard({
          id: arenaId,
          name: arenaTitle,
          region,
          x: 0,
          y: 0,
          status: 'free',
          waiting_user_id: null,
          current_match_id: null,
          time_minutes: null,
          increment_seconds: null,
          created_at: '',
          updated_at: '',
        } as any);
      };

      scene.onPositionUpdate = () => {};

      setupColyseusListeners(scene);
    };

    setTimeout(setupScene, 500);

    return () => {
      listenersSetRef.current = false;
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
        sceneReadyRef.current = false;
      }
    };
  }, []);

  // Watch for Colyseus connection and attach listeners
  useEffect(() => {
    if (!sceneReadyRef.current || !gameRef.current) return;

    const unsubColyseus = useColyseusStore.subscribe((state, prev) => {
      if (state.connected && !prev.connected && gameRef.current) {
        const scene = getWorldScene(gameRef.current);
        if (scene) setupColyseusListeners(scene);
      }
    });

    // If already connected
    if (useColyseusStore.getState().connected && gameRef.current) {
      const scene = getWorldScene(gameRef.current);
      if (scene) setupColyseusListeners(scene);
    }

    return () => unsubColyseus();
  }, []);

  function setupColyseusListeners(scene: ReturnType<typeof getWorldScene>) {
    if (!scene || listenersSetRef.current) return;

    const room = getWorldRoom();
    if (!room) return;

    listenersSetRef.current = true;
    console.log('[Colyseus] Setting up state listeners');

    // Register boards from map
    const arenas = scene.getArenas();
    if (arenas.length > 0) {
      registerBoards(arenas.map(a => ({ id: a.id, name: a.title, x: a.x, y: a.y, width: a.width, height: a.height })));
      console.log(`[Colyseus] Registered ${arenas.length} boards`);
    }

    // Override the movement emitter to use Colyseus
    scene.setMovementSender((data) => {
      sendMovement(data);
    });

    // Listen to player state changes
    room.state.players.onAdd((player: any, sessionId: string) => {
      if (sessionId === room.sessionId) return;
      console.log(`[RemotePlayers] Player added: ${player.username} (${sessionId})`);

      scene.handlePlayerJoined({
        id: player.id,
        socketId: sessionId,
        username: player.username,
        rating: player.rating,
        region: player.region,
        x: player.x,
        y: player.y,
        targetX: player.targetX,
        targetY: player.targetY,
        direction: player.direction,
        isMoving: player.isMoving,
      });

      player.onChange(() => {
        if (sessionId === room.sessionId) return;
        scene.updateRemotePlayerState(sessionId, {
          x: player.x,
          y: player.y,
          targetX: player.targetX,
          targetY: player.targetY,
          direction: player.direction,
          isMoving: player.isMoving,
        });
      });

      updateOnlineCount(room);
    });

    room.state.players.onRemove((_player: any, sessionId: string) => {
      console.log(`[RemotePlayers] Player removed: ${sessionId}`);
      scene.handlePlayerLeftBySession(sessionId);
      updateOnlineCount(room);
    });

    // Listen to board state changes
    room.state.boards.onAdd((board: any, boardId: string) => {
      console.log(`[Boards] Board synced: ${boardId} status=${board.status}`);
      updateBoardVisual(scene, board);

      board.onChange(() => {
        console.log(`[Boards] Board updated: ${boardId} status=${board.status}`);
        updateBoardVisual(scene, board);
        useGameStore.getState().setColyseusBoards(getBoardsSnapshot(room));
      });
    });

    room.state.boards.onRemove((_board: any, boardId: string) => {
      console.log(`[Boards] Board removed: ${boardId}`);
    });

    // Listen for messages
    room.onMessage('match_started', (data) => {
      console.log(`[Colyseus] match_started: matchId=${data.matchId} boardId=${data.boardId} color=${data.color}`);
      useGameStore.getState().setMatchStartedInfo(data);
    });

    room.onMessage('match_finished', (data) => {
      console.log(`[Colyseus] match_finished: ${data.matchId} reason=${data.reason}`);
    });

    room.onMessage('error', (data) => {
      console.warn(`[Colyseus] Error: ${data.message}`);
    });

    room.onMessage('chat', (data) => {
      useGameStore.getState().addChatMessage({
        id: data.id,
        region: '',
        user_id: data.playerId,
        username: data.username,
        message: data.message,
        created_at: data.createdAt,
      });
    });

    // Initial state
    useGameStore.getState().setColyseusBoards(getBoardsSnapshot(room));
    updateOnlineCount(room);
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

function updateOnlineCount(room: any) {
  const count = room.state.players.size;
  useGameStore.getState().setOnlinePlayers(count - 1);
}

function updateBoardVisual(scene: any, board: any) {
  if (board.status === 'waiting') {
    scene.updateBoardStatus(board.id, 'waiting', {
      playerName: board.waitingPlayerName,
      timeLabel: board.timeLabel,
    });
  } else if (board.status === 'playing') {
    scene.updateBoardStatus(board.id, 'in_match');
  } else {
    scene.updateBoardStatus(board.id, 'idle');
  }
}

function getBoardsSnapshot(room: any): any[] {
  const boards: any[] = [];
  room.state.boards.forEach((board: any, id: string) => {
    boards.push({
      id,
      name: board.name,
      status: board.status,
      waitingPlayerId: board.waitingPlayerId,
      waitingPlayerName: board.waitingPlayerName,
      timeCategory: board.timeCategory,
      baseMinutes: board.baseMinutes,
      incrementSeconds: board.incrementSeconds,
      timeLabel: board.timeLabel,
    });
  });
  return boards;
}
