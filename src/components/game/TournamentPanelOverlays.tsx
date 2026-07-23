import { useEffect, useState, useRef } from 'react';
import { useTournamentRoom } from '../../hooks/useTournamentRoom';
import { useTournamentAutoSeat } from '../../hooks/useTournamentAutoSeat';
import { TournamentRegistryPanel } from '../tournament/TournamentRegistryPanel';
import { TournamentStandingsPanel } from '../tournament/TournamentStandingsPanel';
import { useAuthStore } from '../../stores/authStore';

interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function TournamentPanelOverlays() {
  const { user } = useAuthStore();
  const { state, connected, connect, register, unregister, reportResult } = useTournamentRoom();
  const [panelRects, setPanelRects] = useState<{ registry?: PanelRect; standings?: PanelRect } | null>(null);
  const [inReception, setInReception] = useState(false);
  const prevDoorOpen = useRef(false);
  const prevModules = useRef<string>('');

  useEffect(() => {
    let frameId: number;
    const poll = () => {
      const rects = (window as any).__tournamentPanelRects;
      if (rects && (rects.registry || rects.standings)) {
        setPanelRects({ ...rects });
        setInReception(true);
      } else {
        setPanelRects(null);
        setInReception(false);
      }
      frameId = requestAnimationFrame(poll);
    };
    frameId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    if (inReception && user && !connected) {
      connect();
    }
  }, [inReception, user, connected, connect]);

  // React to tournament state changes - load/unload arena modules
  useEffect(() => {
    if (!inReception || !connected) return;
    const scene = (window as any).__worldScene;
    if (!scene) return;

    // Door state
    const shouldOpenDoor = state.doorOpen;
    if (shouldOpenDoor !== prevDoorOpen.current) {
      prevDoorOpen.current = shouldOpenDoor;
      if (typeof scene.setDoorState === 'function') {
        scene.setDoorState(shouldOpenDoor);
      }
    }

    // Arena modules
    const modulesKey = JSON.stringify(state.modules);
    if (modulesKey !== prevModules.current && state.modules.length > 0) {
      prevModules.current = modulesKey;
      if (typeof scene.loadArenaModules === 'function') {
        scene.loadArenaModules(state.modules, state.tables);
      }
    }

    // Remove modules when tournament ends
    if (state.status === 'idle' || state.status === 'registration_open') {
      if (prevModules.current !== '[]' && prevModules.current !== '') {
        prevModules.current = '[]';
        if (typeof scene.removeArenaModules === 'function') {
          scene.removeArenaModules();
        }
      }
    }
  }, [state.doorOpen, state.modules, state.status, inReception, connected]);

  // Auto-seat when pairing arrives
  useTournamentAutoSeat(state, connected, reportResult);

  if (!panelRects || !connected) return null;
  if (state.status === 'idle' && !state.startsAt) return null;

  const registryRect = panelRects.registry;
  const standingsRect = panelRects.standings;

  return (
    <>
      {registryRect && registryRect.width > 30 && (
        <div
          className="fixed z-[600] overflow-hidden rounded-lg border border-slate-700/80 bg-slate-900/95 backdrop-blur-sm shadow-xl shadow-black/40"
          style={{
            left: registryRect.x,
            top: registryRect.y,
            width: registryRect.width,
            height: registryRect.height,
          }}
        >
          <TournamentRegistryPanel
            state={state}
            userId={user?.id || null}
            onRegister={register}
            onUnregister={unregister}
          />
        </div>
      )}
      {standingsRect && standingsRect.width > 30 && (
        <div
          className="fixed z-[600] overflow-hidden rounded-lg border border-slate-700/80 bg-slate-900/95 backdrop-blur-sm shadow-xl shadow-black/40"
          style={{
            left: standingsRect.x,
            top: standingsRect.y,
            width: standingsRect.width,
            height: standingsRect.height,
          }}
        >
          <TournamentStandingsPanel state={state} />
        </div>
      )}
    </>
  );
}
