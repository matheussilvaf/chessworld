import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { createPhaserGame, getWorldScene } from '../game/PhaserGame';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { getWorldRoom, registerBoards, sendMovement } from '../game/network/colyseusClient';
import { useColyseusStore } from '../hooks/useColyseusConnection';
import type { WorldScene } from '../game/scenes/WorldScene';

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
      if (!gameRef.current) return;
      const scene = getWorldScene(gameRef.current);

      // Safe check: scene exists and its internal scene manager is active
      if (!scene) {
        setTimeout(setupScene, 200);
        return;
      }

      try {
        if (!scene.scene || !scene.scene.isActive()) {
          setTimeout(setupScene, 200);
          return;
        }
      } catch {
        setTimeout(setupScene, 200);
        return;
      }

      sceneReadyRef.current = true;
      console.log('[GameCanvas] Scene ready');

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

      // Try to attach Colyseus listeners if already connected
      tryAttachListeners(scene);
    };

    setTimeout(setupScene, 500);

    return () => {
      listenersSetRef.current = false;
      sceneReadyRef.current = false;
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  // Watch for Colyseus connection to attach listeners
  useEffect(() => {
    const unsubColyseus = useColyseusStore.subscribe((state, prev) => {
      if (state.connected && !prev.connected) {
        attemptListenerSetup();
      }
    });

    // If already connected when this effect runs
    if (useColyseusStore.getState().connected) {
      attemptListenerSetup();
    }

    return () => unsubColyseus();
  }, []);

  function attemptListenerSetup() {
    if (!sceneReadyRef.current || !gameRef.current || listenersSetRef.current) return;
    const scene = getWorldScene(gameRef.current);
    if (scene) {
      tryAttachListeners(scene);
    }
  }

  function tryAttachListeners(scene: WorldScene) {
    if (listenersSetRef.current) return;

    const room = getWorldRoom();
    if (!room || !room.state) return;

    attachListeners(scene, room);
  }

  function attachListeners(scene: WorldScene, room: any) {
    if (listenersSetRef.current) return;
    listenersSetRef.current = true;

    console.log('[Colyseus] Attaching listeners. roomId:', room.roomId, 'sessionId:', room.sessionId);
    console.log('[Colyseus] State players count:', room.state.players.size, 'boards count:', room.state.boards.size);

    // Set movement sender
    scene.setMovementSender((data) => {
      sendMovement(data);
    });

    // Register boards from map
    const arenas = scene.getArenas();
    if (arenas.length > 0) {
      registerBoards(arenas.map(a => ({ id: a.id, name: a.title, x: a.x, y: a.y, width: a.width, height: a.height })));
      console.log(`[Boards] boards registered: ${arenas.length}`);
    }

    // --- Players ---
    console.log('[Players] players collection ready');

    room.state.players.onAdd((player: any, sessionId: string) => {
      if (sessionId === room.sessionId) return;
      console.log(`[Players] remote player added: ${player.username} (${sessionId})`);

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
      console.log(`[Players] remote player removed: ${sessionId}`);
      scene.handlePlayerLeftBySession(sessionId);
      updateOnlineCount(room);
    });

    // --- Boards ---
    console.log('[Boards] boards collection ready');

    room.state.boards.onAdd((board: any, boardId: string) => {
      console.log(`[Boards] board added: ${boardId} status=${board.status}`);
      updateBoardVisual(scene, board);
      useGameStore.getState().setColyseusBoards(getBoardsSnapshot(room));

      board.onChange(() => {
        console.log(`[Boards] board changed: ${boardId} ${board.status}`);
        updateBoardVisual(scene, board);
        useGameStore.getState().setColyseusBoards(getBoardsSnapshot(room));
      });
    });

    room.state.boards.onRemove((_board: any, boardId: string) => {
      console.log(`[Boards] board removed: ${boardId}`);
      useGameStore.getState().setColyseusBoards(getBoardsSnapshot(room));
    });

    // --- Messages ---
    room.onMessage('match_started', (data: any) => {
      console.log(`[Colyseus] match_started: matchId=${data.matchId} boardId=${data.boardId} color=${data.color}`);
      useGameStore.getState().setMatchStartedInfo(data);
      useGameStore.getState().setLastEvent(`match_started ${data.matchId.slice(0, 8)}`);
    });

    room.onMessage('match_finished', (data: any) => {
      console.log(`[Colyseus] match_finished: ${data.matchId} reason=${data.reason}`);
      useGameStore.getState().setLastEvent(`match_finished: ${data.reason}`);
    });

    room.onMessage('error', (data: any) => {
      console.warn(`[Colyseus] Error: ${data.message}`);
    });

    room.onMessage('chat', (data: any) => {
      useGameStore.getState().addChatMessage({
        id: data.id,
        region: '',
        user_id: data.playerId,
        username: data.username,
        message: data.message,
        created_at: data.createdAt,
      });
    });

    // Initial state sync
    useGameStore.getState().setColyseusBoards(getBoardsSnapshot(room));
    updateOnlineCount(room);
    useGameStore.getState().setLastEvent('listeners attached');
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
  useGameStore.getState().setOnlinePlayers(Math.max(0, count - 1));
}

function updateBoardVisual(scene: WorldScene, board: any) {
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
