import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useAuthStore } from '../../stores/authStore';
import { Mic, MicOff, PhoneOff, X } from 'lucide-react';
import { socket } from '../../game/network/socketClient';

interface VoiceParticipant {
  id: string;
  username: string;
  isMuted: boolean;
}

export function VoiceChatPanel() {
  const { showVoiceChat, toggleVoiceChat } = useGameStore();
  const { user, profile } = useAuthStore();
  const [connected, setConnected] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const handleVoiceState = (data: { participants: VoiceParticipant[] }) => {
      setParticipants(data.participants);
    };

    socket.on('voice_state' as any, handleVoiceState);
    return () => {
      socket.off('voice_state' as any, handleVoiceState);
    };
  }, []);

  const handleJoin = async () => {
    if (!user || !profile) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setConnected(true);
      setMicEnabled(true);
      socket.emit('voice_join' as any, { playerId: user.id, region: useGameStore.getState().region });
      setParticipants(prev => [...prev, { id: user.id, username: profile.username, isMuted: false }]);
    } catch {
      setConnected(false);
    }
  };

  const handleLeave = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setConnected(false);
    setMicEnabled(false);
    setParticipants(prev => prev.filter(p => p.id !== user?.id));
    socket.emit('voice_leave' as any, { playerId: user?.id });
  };

  const toggleMic = () => {
    if (!streamRef.current) return;
    const audioTrack = streamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setMicEnabled(audioTrack.enabled);
    }
  };

  if (!showVoiceChat) return null;

  return (
    <div className="absolute right-4 top-1/2 -translate-y-1/2 z-30 w-64">
      <div className="bg-slate-900/95 backdrop-blur-sm rounded-xl border border-slate-700/60 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-white font-semibold text-sm">
              Voice Chat
            </span>
            <span className="text-slate-400 text-xs">({participants.length})</span>
          </div>
          <button onClick={toggleVoiceChat} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Participants list */}
        <div className="p-3 space-y-1 max-h-48 overflow-y-auto">
          {participants.length === 0 && (
            <p className="text-slate-500 text-xs text-center py-3">No one in voice chat yet</p>
          )}
          {participants.map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/50">
              <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center">
                <span className="text-[10px] font-bold text-white">{p.username[0]?.toUpperCase()}</span>
              </div>
              <span className="text-white text-xs font-medium flex-1 truncate">{p.username}</span>
              {p.isMuted && <MicOff className="w-3 h-3 text-red-400" />}
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="p-3 border-t border-slate-700/50 flex items-center gap-2">
          {!connected ? (
            <button
              onClick={handleJoin}
              className="flex-1 py-2.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/30 transition-colors border border-emerald-500/30"
            >
              Join Voice
            </button>
          ) : (
            <>
              <button
                onClick={toggleMic}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                  micEnabled
                    ? 'bg-slate-700 text-white hover:bg-slate-600'
                    : 'bg-red-500/20 text-red-400 border border-red-500/30'
                }`}
              >
                {micEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </button>
              <button
                onClick={handleLeave}
                className="flex-1 py-2 rounded-lg bg-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/30 transition-colors border border-red-500/30 flex items-center justify-center gap-1.5"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                Leave
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
