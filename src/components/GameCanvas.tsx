import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { createPhaserGame, getWorldScene } from '../game/PhaserGame';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { useChessStore } from '../stores/chessStore';
import { useGameSettingsStore } from '../stores/gameSettingsStore';
import { getWorldRoom, registerBoards, sendMovement } from '../game/network/colyseusClient';
import { useColyseusStore } from '../hooks/useColyseusConnection';
import type { WorldScene } from '../game/scenes/WorldScene';
import type { Room } from 'colyseus.js';

export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneReadyRef = useRef(false);
  const listenersSetRef = useRef(false);
  const { setSelectedBoard } = useGameStore();
  const { user, profile } = useAuthStore();
  const { region } = useGameStore();

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const game = createPhaserGame(containerRef.current);
    gameRef.current = game;

    const setupScene = () => {
      if (!gameRef.current) return;
      const scene = getWorldScene(gameRef.current);

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

  // Load and subscribe to game settings (admin-adjustable zoom/speed)
  useEffect(() => {
    const settingsStore = useGameSettingsStore;
    settingsStore.getState().load();
    const unsubRealtime = settingsStore.getState().subscribe();

    const unsubStore = settingsStore.subscribe((state) => {
      if (!gameRef.current) return;
      const scene = getWorldScene(gameRef.current);
      if (scene) {
        scene.setDefaultZoom(state.defaultZoom);
        scene.setPlayerSpeed(state.playerSpeed);
      }
    });

    return () => {
      unsubRealtime();
      unsubStore();
    };
  }, []);

  useEffect(() => {
    const unsubColyseus = useColyseusStore.subscribe((state, prev) => {
      if (state.connected && !prev.connected) {
        attemptListenerSetup();
      }
    });

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
    if (!room) return;

    if (!room.state) {
      useGameStore.getState().setLastEvent('state null - waiting');
      room.onStateChange.once(() => {
        validateAndAttach(scene, room);
      });
      return;
    }

    validateAndAttach(scene, room);
  }

  function validateAndAttach(scene: WorldScene, room: Room<any>) {
    if (listenersSetRef.current) return;

    const state = room.state;
    const playersOk = state && state.players && typeof state.players.onAdd === 'function';
    const boardsOk = state && state.boards && typeof state.boards.onAdd === 'function';

    if (!playersOk || !boardsOk) {
      console.error('[Colyseus] State contract invalid - players or boards missing onAdd');
      useGameStore.getState().setLastEvent('Colyseus state invalid');
      return;
    }

    attachListeners(scene, room);
  }

  function attachListeners(scene: WorldScene, room: Room<any>) {
    if (listenersSetRef.current) return;
    listenersSetRef.current = true;

    const state = room.state;
    console.log('[Colyseus] Attaching listeners. players:', state.players.size, '| boards:', state.boards.size);

    scene.setMovementSender((data) => {
      sendMovement(data);
    });

    const arenas = scene.getArenas();
    if (arenas.length > 0) {
      const payload = arenas.map((a: any) => ({ id: a.id, name: a.title, x: a.x, y: a.y, width: a.width, height: a.height }));
      registerBoards(payload);
    }

    state.players.onAdd((player: any, sessionId: string) => {
      if (sessionId === room.sessionId) {
        updateOnlineCount(room);
        return;
      }

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

    state.players.onRemove((_player: any, sessionId: string) => {
      scene.handlePlayerLeftBySession(sessionId);
      updateOnlineCount(room);
    });

    state.boards.onAdd((board: any, _boardId: string) => {
      updateBoardVisual(scene, board);
      syncBoardsToStore(room);

      board.onChange(() => {
        updateBoardVisual(scene, board);
        syncBoardsToStore(room);
      });
    });

    state.boards.onRemove((_board: any, _boardId: string) => {
      syncBoardsToStore(room);
    });

    // --- Matches ---
    if (state.matches && typeof state.matches.onAdd === 'function') {
      state.matches.onAdd((match: any, _matchId: string) => {
        match.onChange(() => {
          useChessStore.getState().syncFromColyseus(match);
        });
      });
    }

    room.onMessage('state_contract', (data: any) => {
      console.log('[Colyseus] state_contract:', data);
    });

    room.onMessage('match_started', (data: any) => {
      useGameStore.getState().setMatchStartedInfo(data);
      useGameStore.getState().setLastEvent(`match_started ${data.matchId.slice(0, 8)}`);
    });

    room.onMessage('match_finished', (data: any) => {
      useGameStore.getState().setLastEvent(`match_finished: ${data.reason}`);
    });

    room.onMessage('error', (data: any) => {
      console.warn('[Colyseus] Error:', data.message);
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

    syncBoardsToStore(room);
    updateOnlineCount(room);
    useGameStore.getState().setLastEvent('listeners attached');
    console.log('[Colyseus] All listeners attached');
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

function updateOnlineCount(room: Room<any>) {
  if (!room.state?.players) return;
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

function syncBoardsToStore(room: Room<any>) {
  if (!room.state?.boards) return;
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
      matchId: board.matchId || '',
    });
  });
  useGameStore.getState().setColyseusBoards(boards);
}
