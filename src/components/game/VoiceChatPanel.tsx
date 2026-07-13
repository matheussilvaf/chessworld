import { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useAuthStore } from '../../stores/authStore';
import { Mic, MicOff, PhoneOff, X, Volume2 } from 'lucide-react';
import { voiceClient, type VoiceStatus } from '../../game/voice/livekitVoiceClient';
import { getWorldRoom } from '../../game/network/colyseusClient';

interface VoiceParticipant {
  sessionId: string;
  playerId: string;
  username: string;
  muted: boolean;
  joinedAt: number;
}

export function VoiceChatPanel() {
  const { showVoiceChat, toggleVoiceChat, region } = useGameStore();
  const { user, profile } = useAuthStore();
  const [status, setStatus] = useState<VoiceStatus>(voiceClient.status);
  const [error, setError] = useState<string | null>(voiceClient.error);
  const [muted, setMuted] = useState(false);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);

  useEffect(() => {
    const unsub = voiceClient.onStatusChange((s, err) => {
      setStatus(s);
      setError(err || null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const room = getWorldRoom();
    if (!room?.state?.voiceParticipants) return;

    const syncParticipants = () => {
      const list: VoiceParticipant[] = [];
      room.state.voiceParticipants.forEach((vp: any) => {
        list.push({
          sessionId: vp.sessionId,
          playerId: vp.playerId,
          username: vp.username,
          muted: vp.muted,
          joinedAt: vp.joinedAt,
        });
      });
      list.sort((a, b) => a.joinedAt - b.joinedAt);
      setParticipants(list);
    };

    syncParticipants();

    if (typeof room.state.voiceParticipants.onAdd === 'function') {
      room.state.voiceParticipants.onAdd((vp: any) => {
        vp.onChange(() => syncParticipants());
        syncParticipants();
      });
      room.state.voiceParticipants.onRemove(() => syncParticipants());
    }

    const interval = setInterval(syncParticipants, 2000);
    return () => clearInterval(interval);
  }, [showVoiceChat]);

  const handleJoin = useCallback(async () => {
    if (!user || !profile || !region) return;
    await voiceClient.join(region, user.id, profile.username);
    setMuted(false);
  }, [user, profile, region]);

  const handleLeave = useCallback(async () => {
    await voiceClient.leave();
    setMuted(false);
  }, []);

  const toggleMute = useCallback(async () => {
    const newMuted = !muted;
    await voiceClient.setMuted(newMuted);
    setMuted(newMuted);
  }, [muted]);

  if (!showVoiceChat) return null;

  const connected = status === 'connected';
  const connecting = status === 'connecting';

  return (
    <div className="absolute right-4 top-1/2 -translate-y-1/2 z-30 w-72">
      <div className="bg-slate-900/95 backdrop-blur-sm rounded-xl border border-slate-700/60 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-emerald-400" />
            <span className="text-white font-semibold text-sm">World Voice</span>
            <span className="text-slate-400 text-xs">({participants.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <StatusDot status={status} />
            <button onClick={toggleVoiceChat} className="text-slate-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20">
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}

        {/* Participants list */}
        <div className="p-3 space-y-1 max-h-52 overflow-y-auto">
          {participants.length === 0 && (
            <p className="text-slate-500 text-xs text-center py-4">No one in voice chat yet</p>
          )}
          {participants.map((p) => (
            <div key={p.sessionId} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/50 transition-colors">
              <div className="relative">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-white">{p.username[0]?.toUpperCase()}</span>
                </div>
                {!p.muted && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border border-slate-900" />
                )}
              </div>
              <span className="text-white text-xs font-medium flex-1 truncate">{p.username}</span>
              {p.muted ? (
                <MicOff className="w-3.5 h-3.5 text-red-400" />
              ) : (
                <Mic className="w-3.5 h-3.5 text-emerald-400" />
              )}
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="p-3 border-t border-slate-700/50 flex items-center gap-2">
          {!connected && !connecting ? (
            <button
              onClick={handleJoin}
              className="flex-1 py-2.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/30 transition-colors border border-emerald-500/30"
            >
              Join Voice
            </button>
          ) : connecting ? (
            <div className="flex-1 py-2.5 rounded-lg bg-amber-500/10 text-amber-400 text-xs font-semibold text-center border border-amber-500/20">
              Connecting...
            </div>
          ) : (
            <>
              <button
                onClick={toggleMute}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                  muted
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                    : 'bg-slate-700 text-white hover:bg-slate-600'
                }`}
                title={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button
                onClick={handleLeave}
                className="flex-1 py-2 rounded-lg bg-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/30 transition-colors border border-red-500/30 flex items-center justify-center gap-1.5"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                Leave Voice
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: VoiceStatus }) {
  const config = {
    disconnected: 'bg-slate-500',
    connecting: 'bg-amber-400 animate-pulse',
    connected: 'bg-emerald-400',
    error: 'bg-red-400',
  };

  return <div className={`w-2 h-2 rounded-full ${config[status]}`} />;
}
