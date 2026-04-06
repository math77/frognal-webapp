'use client';

import {
  CSSProperties, DragEvent, KeyboardEvent,
  useCallback, useEffect, useRef, useState,
} from 'react';
import { BASE_FROG_ORDER, FROGS, checkSincerityUnlock, type FrogConfig, type FrogId } from '@/lib/frogs';
import {
  planInterruption, buildInterruptionPrompt, buildLastWordPrompt,
  buildSilencePrompt, buildPokePrompt, shouldFireLastWord, pickSilenceFrog,
  checkDebateCommand, pickDebateFrogs, buildDebateOpeningPrompt, buildDebateResponsePrompt,
  checkRareEvent, buildImageReactionPrompt, DEBATE_ROUNDS,
  shouldFireAgreement, pickAgreementFrog, buildAgreementPrompt,
} from '@/lib/interruptionEngine';
import {
  createPondMemory, updateMemory, buildContextSuffix, buildInterruptionContext,
  recordDisagreement, shiftMood, updateReputation,
  MOOD_EMOJI, type PondMemory, type Mood,
} from '@/lib/pondMemory';
import { createTypingBuffer } from '@/lib/typingBuffer';
import { requestBudget } from '@/lib/requestQueue';
import { sounds } from '@/lib/soundEngine';
import { ambient } from '@/lib/ambientEngine';
import { useLLM } from '@/hooks/useLLM';
import type { OneShotPrompt } from '@/lib/promptTypes';

import { useWallet } from '@/hooks/useWallet';
import { buildCustomFrogConfig } from '@/lib/customFrog';
import { FEATURES } from '@/lib/featureFlags';
import { CustomFrogCreator } from '@/components/CustomFrogCreator';

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageRole =
  | 'user' | 'frog' | 'splash' | 'interruption' | 'lastword'
  | 'silence' | 'poke' | 'debate_label' | 'debate_turn' | 'rare_event'
  | 'image_drop' | 'image_reaction' | 'agreement';

interface DisplayMessage {
  id: string;
  role: MessageRole;
  content: string;
  frogId?: FrogId;
  isStreaming?: boolean;
  imageDataUrl?: string;
}

// ─── Image resize utility ────────────────────────────────────────────────────

const MAX_IMAGE_SIZE = 512;

function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > MAX_IMAGE_SIZE || height > MAX_IMAGE_SIZE) {
        const ratio = Math.min(MAX_IMAGE_SIZE / width, MAX_IMAGE_SIZE / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas context unavailable')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };

    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('image load failed')); };
    img.src = objectUrl;
  });
}

// ─── Config ───────────────────────────────────────────────────────────────────

const SILENCE_TIMEOUT_MS = 75_000;
const BUBBLE_CONFIGS = Array.from({ length: 14 }, (_, i) => ({
  id: i, left: 2 + (i * 7.1) % 94, size: 8 + (i * 3.7) % 22,
  duration: 5 + (i * 1.3) % 9, delay: (i * 0.8) % 7,
}));
const BURST_CONFIGS = Array.from({ length: 10 }, (_, i) => ({
  id: i, left: 10 + (i * 9.3) % 80, size: 12 + (i * 5.1) % 28, delay: i * 0.12,
}));

// ─── Sub-components ───────────────────────────────────────────────────────────

function BubbleBackground({ frog, burst }: { frog: FrogConfig; burst: boolean }) {
  const speedMap = { sluggish: 1.8, normal: 1.0, fast: 0.6, erratic: 1.0 };
  const mult = speedMap[frog.vibe.bubbleSpeed];
  return (
    <div style={s.bubbleContainer} aria-hidden="true">
      {BUBBLE_CONFIGS.map((b) => {
        const dur = frog.vibe.bubbleSpeed === 'erratic'
          ? (b.duration * mult * (0.5 + (b.id * 0.17) % 1)).toFixed(1)
          : (b.duration * mult).toFixed(1);
        return <div key={b.id} style={{ position: 'absolute', bottom: -60, left: `${b.left}%`, width: b.size, height: b.size, borderRadius: '50%', background: frog.vibe.bubbleGradient, border: `1px solid ${frog.vibe.bubbleBorder}`, animation: `bubble-rise ${dur}s ease-in ${b.delay}s infinite`, pointerEvents: 'none' }} />;
      })}
      {burst && BURST_CONFIGS.map((b) => (
        <div key={`burst-${b.id}`} style={{ position: 'absolute', bottom: -20, left: `${b.left}%`, width: b.size, height: b.size, borderRadius: '50%', background: frog.vibe.bubbleGradient, border: `1px solid ${frog.vibe.bubbleBorder}`, animation: `bubble-burst 1.2s ease-out ${b.delay}s forwards`, pointerEvents: 'none' }} />
      ))}
    </div>
  );
}

function ErrorScreen({ error }: { error: string }) {
  return (
    <div style={s.loadingScreen}>
      <div style={s.loadingContent}>
        <div style={{ fontSize: 48 }}>💀</div>
        <div style={{ ...s.loadingTitle, color: '#ff4444' }}>FATAL POND ERROR</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: '#ff6666', maxWidth: 480, textAlign: 'center', lineHeight: 1.5, marginTop: 16 }}>{error}</div>
      </div>
    </div>
  );
}

function TypingDots({ color }: { color: string }) {
  return (
    <div style={{ display: 'flex', gap: 5 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: color, animation: `bounce-dot 1.1s ease-in-out ${i * 0.18}s infinite` }} />
      ))}
    </div>
  );
}

function StreamingCursor({ color }: { color: string }) {
  return <span style={{ display: 'inline-block', width: 10, height: '1em', background: color, marginLeft: 3, verticalAlign: 'middle', animation: 'blink-cursor 0.7s step-end infinite' }} />;
}

function CopyButton({ text, color }: { text: string; color: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }} style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.35)', border: `1px solid ${color}44`, borderRadius: 4, padding: '2px 7px', fontFamily: 'var(--font-mono)', fontSize: 11, color: copied ? color : 'rgba(255,255,255,0.35)', cursor: 'pointer', transition: 'all 0.15s', letterSpacing: '0.05em' }}>
      {copied ? 'copied!' : '⎘'}
    </button>
  );
}

function UnlockBanner({ frog }: { frog: FrogConfig }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 8, background: `${frog.bgColor}`, border: `1px solid ${frog.borderColor}`, boxShadow: `0 0 28px ${frog.glowColor}`, animation: 'msg-in 0.4s ease-out', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: frog.color, letterSpacing: '0.08em', marginBottom: 6 }}>
        ✦ hidden frog unlocked ✦
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, color: frog.color }}>
        {frog.emoji} {frog.name} has emerged from the depths
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: frog.color, opacity: 0.6, marginTop: 4 }}>
        {frog.tagline}
      </div>
    </div>
  );
}

function MessageBubble({ msg, onPoke, isBlocked, userName }: { msg: DisplayMessage; onPoke: (m: DisplayMessage) => void; isBlocked: boolean; userName: string }) {
  const frog = msg.frogId ? FROGS[msg.frogId] : null;
  const [hovered, setHovered] = useState(false);
  const avatarLabel = userName ? userName[0].toUpperCase() : 'U';

  const isClickable = !isBlocked && ['frog', 'interruption', 'lastword'].includes(msg.role) && !msg.isStreaming && msg.content.length > 0;
  const showCopy = hovered && !msg.isStreaming && msg.content.length > 0 && ['frog', 'interruption', 'lastword', 'poke', 'silence'].includes(msg.role);

  if (msg.role === 'debate_label') {
    return (
      <div style={{ textAlign: 'center', padding: '10px 0', animation: 'msg-in 0.3s ease-out' }}>
        <div style={{ display: 'inline-block', padding: '5px 16px', borderRadius: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.07em' }}>
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.role === 'rare_event' && frog) {
    return (
      <div style={{ animation: 'msg-in 0.4s ease-out', paddingLeft: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <span style={{ fontSize: 11, color: frog.color, opacity: 0.5 }}>◈</span>
          <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: frog.color, opacity: 0.4, letterSpacing: '0.04em' }}>rare event</span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: frog.color, opacity: 0.75, lineHeight: 1.4, paddingLeft: 16, fontStyle: 'italic', borderLeft: `2px dashed ${frog.borderColor}`, paddingTop: 4, paddingBottom: 4 }}>
          {frog.emoji} {msg.content}
        </div>
      </div>
    );
  }

  if (msg.role === 'agreement' && frog) {
    return (
      <div style={{ animation: 'msg-in 0.25s ease-out', paddingLeft: 12 }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <span style={{ fontSize: 11, color: frog.color, opacity: 0.65 }}>✦</span>
          <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: frog.color, opacity: 0.5, letterSpacing: '0.04em' }}>{frog.name} agrees</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ ...s.avatarBadge, width: 30, height: 30, fontSize: 15, background: frog.bgColor, border: `1px solid ${frog.borderColor}`, boxShadow: `0 0 8px ${frog.glowColor.replace('0.45', '0.25')}` }}>
            {frog.emoji}
          </div>
          <div style={{ position: 'relative', maxWidth: '65%', padding: '8px 13px', borderRadius: '2px 10px 10px 10px', background: frog.bgColor, border: `1px solid ${frog.borderColor}`, boxShadow: `0 0 10px ${frog.glowColor.replace('0.45', '0.14')}`, fontFamily: 'var(--font-mono)', fontSize: 18, lineHeight: 1.4, color: frog.color, opacity: 0.9, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
            {msg.content}
            {msg.isStreaming && <StreamingCursor color={frog.color} />}
            {showCopy && <CopyButton text={msg.content} color={frog.color} />}
          </div>
        </div>
      </div>
    );
  }

  if (msg.role === 'image_drop') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'flex-start', animation: 'msg-in 0.25s ease-out' }}>
        <div style={{ maxWidth: '68%', padding: 6, borderRadius: '12px 12px 2px 12px', background: 'var(--user-bg)', border: '1px solid var(--user-border)' }}>
          {msg.imageDataUrl && (
            <img src={msg.imageDataUrl} alt="dropped" style={{ display: 'block', maxWidth: '100%', maxHeight: 280, borderRadius: 6, objectFit: 'contain' }} />
          )}
          <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--text-muted)', textAlign: 'right', marginTop: 5, letterSpacing: '0.05em' }}>
            dropped into the pond
          </div>
        </div>
        <div style={s.userAvatar}>{avatarLabel}</div>
      </div>
    );
  }

  if (msg.role === 'image_reaction' && frog) {
    return (
      <div style={{ animation: 'msg-in 0.25s ease-out', paddingLeft: 12 }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <span style={{ fontSize: 11, color: frog.color, opacity: 0.65 }}>👁</span>
          <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: frog.color, opacity: 0.5, letterSpacing: '0.04em' }}>{frog.name}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ ...s.avatarBadge, width: 30, height: 30, fontSize: 15, background: frog.bgColor, border: `1px solid ${frog.borderColor}`, boxShadow: `0 0 8px ${frog.glowColor.replace('0.45', '0.25')}` }}>
            {frog.emoji}
          </div>
          <div style={{ position: 'relative', maxWidth: '65%', padding: '8px 13px', borderRadius: '2px 10px 10px 10px', background: frog.bgColor, border: `1px solid ${frog.borderColor}`, boxShadow: `0 0 10px ${frog.glowColor.replace('0.45', '0.14')}`, fontFamily: 'var(--font-mono)', fontSize: 18, lineHeight: 1.4, color: frog.color, opacity: 0.92, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
            {msg.content}
            {msg.isStreaming && <StreamingCursor color={frog.color} />}
            {showCopy && <CopyButton text={msg.content} color={frog.color} />}
          </div>
        </div>
      </div>
    );
  }

  if (msg.role === 'splash' || msg.role === 'silence') {
    const isSilence = msg.role === 'silence';
    return (
      <div style={{ ...s.splashLine, color: frog?.color ?? 'var(--text-dim)', borderColor: frog?.borderColor ?? 'rgba(255,255,255,0.1)', borderLeftStyle: isSilence ? 'dashed' : 'solid', opacity: isSilence ? 0.6 : 0.7 }}>
        <span style={{ marginRight: 8, opacity: 0.55 }}>{isSilence ? '~' : '»'}</span>
        {isSilence && frog && <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, marginRight: 8, opacity: 0.5, letterSpacing: '0.04em' }}>{frog.name} breaks the silence</span>}
        {msg.content}
      </div>
    );
  }

  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'flex-start', animation: 'msg-in 0.25s ease-out' }}>
        <div style={{ maxWidth: '68%', padding: '10px 14px', borderRadius: '12px 12px 2px 12px', background: 'var(--user-bg)', border: '1px solid var(--user-border)', fontFamily: 'var(--font-mono)', fontSize: 20, lineHeight: 1.45, color: 'var(--user-text)', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{msg.content}</div>
        <div style={s.userAvatar}>{avatarLabel}</div>
      </div>
    );
  }

  const getRoleLabel = () => {
    if (msg.role === 'interruption') return { icon: '⚡', label: `${frog?.name} jumped in` };
    if (msg.role === 'lastword')     return { icon: '↩', label: `${frog?.name} fires back` };
    if (msg.role === 'poke')         return { icon: '👆', label: `${frog?.name} reacts` };
    if (msg.role === 'debate_turn')  return { icon: '🗣', label: `${frog?.name}` };
    return null;
  };

  const roleLabel = getRoleLabel();
  const isIndented = ['interruption', 'poke'].includes(msg.role);
  const avatarSize = isIndented ? 30 : 36;
  const fontSize = isIndented ? 18 : msg.role === 'lastword' ? 19 : 20;

  if (frog) {
    return (
      <div style={{ animation: 'msg-in 0.25s ease-out', paddingLeft: isIndented ? 12 : 0 }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        {roleLabel && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <span style={{ fontSize: 11, color: frog.color, opacity: 0.65 }}>{roleLabel.icon}</span>
            <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: frog.color, opacity: 0.5, letterSpacing: '0.04em' }}>{roleLabel.label}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: isIndented ? 8 : 10, alignItems: 'flex-start' }}>
          <div style={{ ...s.avatarBadge, width: avatarSize, height: avatarSize, fontSize: isIndented ? 15 : 20, background: frog.bgColor, border: `1px solid ${frog.borderColor}`, boxShadow: `0 0 ${isIndented ? 8 : 10}px ${frog.glowColor.replace('0.45', '0.35')}` }}>
            {frog.emoji}
          </div>
          <div
            onClick={() => isClickable && onPoke(msg)}
            title={isClickable ? 'click to poke' : undefined}
            style={{ position: 'relative', maxWidth: isIndented ? '62%' : '72%', padding: '10px 14px', borderRadius: '2px 12px 12px 12px', background: frog.bgColor, border: `1px solid ${frog.borderColor}`, boxShadow: `0 0 ${isIndented ? 10 : 16}px ${frog.glowColor.replace('0.45', isIndented ? '0.12' : '0.2')}`, fontFamily: 'var(--font-mono)', fontSize, lineHeight: 1.45, color: frog.color, wordBreak: 'break-word', whiteSpace: 'pre-wrap', cursor: isClickable ? 'pointer' : 'default', opacity: isIndented ? 0.92 : 1, transition: 'opacity 0.15s' }}
            onMouseEnter={(e) => { if (isClickable) (e.currentTarget as HTMLElement).style.opacity = '0.75'; }}
            onMouseLeave={(e) => { if (isClickable) (e.currentTarget as HTMLElement).style.opacity = isIndented ? '0.92' : '1'; }}
          >
            {msg.content}
            {msg.isStreaming && <StreamingCursor color={frog.color} />}
            {showCopy && <CopyButton text={msg.content} color={frog.color} />}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportConversation(messages: DisplayMessage[]): void {
  const rows = messages
    .filter((m) => m.role !== 'splash' && m.content.length > 0 && m.role !== 'debate_label')
    .map((m) => {
      const frog = m.frogId ? FROGS[m.frogId] : null;
      const color = frog?.color ?? '#888';
      const name = m.role === 'user' ? 'You' : m.role === 'rare_event' ? `${frog?.name} ◈` : m.role === 'silence' ? `${frog?.name} ~` : m.role === 'interruption' ? `${frog?.name} ⚡` : m.role === 'lastword' ? `${frog?.name} ↩` : m.role === 'debate_turn' ? `${frog?.name} 🗣` : frog?.name ?? '?';
      return `<div style="margin-bottom:18px;padding-left:${['interruption','poke'].includes(m.role)?'24px':'0'}"><div style="font-family:monospace;font-size:11px;color:${color}88;margin-bottom:4px;letter-spacing:0.05em;text-transform:uppercase">${name}</div><div style="font-family:'VT323',monospace;font-size:20px;color:${color};line-height:1.4;white-space:pre-wrap;max-width:680px;padding:10px 14px;border-radius:4px;background:${color}11;border:1px solid ${color}33">${m.content.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div></div>`;
    }).join('\n');

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Frognal</title><link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet"><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#060a06;color:#c8e6c8;font-family:'VT323',monospace;min-height:100vh;padding:48px clamp(16px,5vw,80px)}h1{font-family:'Press Start 2P',monospace;font-size:clamp(14px,3vw,22px);color:#c8e6c8;margin-bottom:8px;letter-spacing:.05em}h1 span{color:#39ff14}.meta{font-family:'VT323',monospace;font-size:14px;color:#3a523a;letter-spacing:.08em;text-transform:uppercase;margin-bottom:48px;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,.06)}</style></head><body><h1>FROG<span>NAL</span></h1><div class="meta">conversation export · ${new Date().toLocaleDateString()}</div>${rows}</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `openfrog-${Date.now()}.html`; a.click();
  URL.revokeObjectURL(url);
}

// ─── Persist frogs on localStorage ───────────────────────────────────────────────────────────────────

const SAVED_FROGS_KEY = 'frognal_saved_frogs';

function getSavedFrogs(): FrogConfig[] {
  try {
    const raw = localStorage.getItem(SAVED_FROGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveFrogToStorage(frog: FrogConfig) {
  try {
    const existing = getSavedFrogs();
    const alreadySaved = existing.some(f => f.id === frog.id);
    if (alreadySaved) return;
    localStorage.setItem(SAVED_FROGS_KEY, JSON.stringify([...existing, frog]));
  } catch {}
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FrogChat() {
  const [activeFrogId, setActiveFrogId] = useState<FrogId>('shitposter');
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isAmbient, setIsAmbient] = useState(false);
  const [streakCount, setStreakCount] = useState(0);
  const [moodState, setMoodState] = useState<Record<FrogId, Mood>>(
    () => Object.fromEntries(
      ([...BASE_FROG_ORDER, 'sincerity'] as FrogId[]).map((id) => [id, 'baseline' as Mood])
    ) as Record<FrogId, Mood>
  );
  const [sincerityUnlocked, setSincerityUnlocked] = useState(false);
  const [flashFrogId, setFlashFrogId] = useState<FrogId | null>(null);
  const [burstActive, setBurstActive] = useState(false);

  const [userName, setUserName] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('frognal_username') ?? '';
    return '';
  });
  const [showNameModal, setShowNameModal] = useState<boolean>(() => {
    if (typeof window !== 'undefined') return !localStorage.getItem('frognal_username');
    return false;
  });
  const [nameInput, setNameInput] = useState('');

  const streakCountRef = useRef(0);
  const totalExchangesRef = useRef(0);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spontaneousDebateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pondMemoryRef = useRef<PondMemory>(createPondMemory());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const [customFrog,  setCustomFrog]  = useState<FrogConfig | null>(null);
  const [showForge,   setShowForge]   = useState(false);
  const [creatorFrogs, setCreatorFrogs] = useState<FrogConfig[]>(() =>
    typeof window !== 'undefined' ? getSavedFrogs() : []
  );


  const wallet = useWallet();

  const allFrogs: Record<string, FrogConfig> = {
    ...FROGS,
    ...(customFrog ? { [customFrog.id]: customFrog } : {}),
    ...Object.fromEntries(creatorFrogs.map(f => [f.id, f])),
  };

  const activeFrog = allFrogs[activeFrogId] ?? FROGS['shitposter'];
  const { status, error, generate, generateOneShot, generateImageReaction, clearHistory } = useLLM(activeFrog);
  const isBlocked = status === 'generating' || status === 'interrupting';


  const unlockedFrogs: FrogId[] = sincerityUnlocked ? ['sincerity'] : [];

  const displayFrogOrder: FrogId[] = [
    ...BASE_FROG_ORDER,
    ...(sincerityUnlocked ? ['sincerity' as FrogId] : []),
    ...Array.from(new Set([
      ...(customFrog ? [customFrog.id as FrogId] : []),
      ...creatorFrogs.map(f => f.id as FrogId),
    ])),
  ];


  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [displayMessages]);

  // Show the initial splash immediately on mount (no model loading needed)
  useEffect(() => {
    setDisplayMessages([{ id: 'splash-init', role: 'splash', content: activeFrog.splashLine, frogId: activeFrogId }]);
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!FEATURES.CUSTOM_FROG_CREATOR) return;
    const params = new URLSearchParams(window.location.search);
    const frogId = params.get('frog');
    if (!frogId) return;
    fetch(`/api/frogs?id=${encodeURIComponent(frogId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.frog) {
          const cfg = data.frog as FrogConfig;
          setCustomFrog(cfg);
          saveFrogToStorage(cfg);
          setCreatorFrogs(prev =>
            prev.some(f => f.id === cfg.id) ? prev : [...prev, cfg]
          );
          setActiveFrogId(cfg.id as FrogId);
          clearHistory();
          setDisplayMessages(prev => [...prev, {
            id: `splash-shared-${Date.now()}`, role: 'splash' as const,
            content: `✦ shared frog · ${cfg.splashLine}`, frogId: cfg.id as FrogId,
          }]);
        }
      })
     .catch(console.error);
  }, []); // eslint-disable-line

  // Load all frogs created by the connected wallet
  useEffect(() => {
    if (!wallet.address || !FEATURES.CUSTOM_FROG_CREATOR) return;
    fetch(`/api/frogs?address=${encodeURIComponent(wallet.address.toLowerCase())}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.frogs)) setCreatorFrogs(data.frogs);
      })
      .catch(console.error);
  }, [wallet.address]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const applyMoodShift = useCallback((frogId: FrogId, event: Parameters<typeof shiftMood>[2]) => {
    const newMood = shiftMood(pondMemoryRef.current, frogId, event);
    setMoodState((prev) => ({ ...prev, [frogId]: newMood }));
    return newMood;
  }, []);

  const triggerBurst = useCallback(() => {
    setBurstActive(true);
    setTimeout(() => setBurstActive(false), 1400);
  }, []);

  const triggerFlash = useCallback((frogId: FrogId) => {
    setFlashFrogId(frogId);
    setTimeout(() => setFlashFrogId(null), 900);
  }, []);

  // ── Silence timer ────────────────────────────────────────────────────────────

  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(async () => {
      if (status !== 'ready') return;
      const silenceFrogId = pickSilenceFrog(unlockedFrogs);
      const silenceFrog = FROGS[silenceFrogId];
      const memCtx = buildInterruptionContext(pondMemoryRef.current, silenceFrogId, userName || undefined);
      const prompt = buildSilencePrompt(silenceFrog, memCtx);
      const msgId = `silence-${silenceFrogId}-${Date.now()}`;

      sounds.silence();
      applyMoodShift(silenceFrogId, 'silence_spoke');

      setDisplayMessages((prev) => [...prev, { id: msgId, role: 'silence', content: '', frogId: silenceFrogId, isStreaming: true }]);

      const { queue, finished } = createTypingBuffer(silenceFrog.typingProfile, (chunk) => {
        setDisplayMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, content: m.content + chunk } : m));
      });
      await generateOneShot(prompt, queue);
      await finished;
      setDisplayMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, isStreaming: false } : m));
      resetSilenceTimer();
    }, SILENCE_TIMEOUT_MS);
  }, [generateOneShot, status, applyMoodShift, unlockedFrogs]);

  useEffect(() => {
    if (status === 'ready') resetSilenceTimer();
    return () => { if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current); };
  }, [status, resetSilenceTimer]);

  // ── Stream one-shot ───────────────────────────────────────────────────────────

  const streamOneShot = useCallback(async (msgId: string, prompt: OneShotPrompt, frogId: FrogId): Promise<string> => {
    const frog = FROGS[frogId];
    let fullText = '';
    const { queue, finished } = createTypingBuffer(frog.typingProfile, (chunk) => {
      fullText += chunk;
      setDisplayMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, content: m.content + chunk } : m));
    });
    await generateOneShot(prompt, queue);
    await finished;
    setDisplayMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, isStreaming: false } : m));
    return fullText;
  }, [generateOneShot]);

  // ── Spontaneous debate timer ──────────────────────────────────────────────────

  const resetSpontaneousDebateTimer = useCallback(() => {
    if (spontaneousDebateTimerRef.current) clearTimeout(spontaneousDebateTimerRef.current);
    const delay = (90 + Math.random() * 90) * 1000;
    spontaneousDebateTimerRef.current = setTimeout(async () => {
      if (status !== 'ready') return;
      const [frogAId, frogBId] = pickDebateFrogs(pondMemoryRef.current.theme, unlockedFrogs);
      const frogA = FROGS[frogAId];
      const frogB = FROGS[frogBId];
      const topic = pondMemoryRef.current.theme !== 'general'
        ? pondMemoryRef.current.theme
        : 'the nature of the pond';

      triggerBurst();
      sounds.switchFrog();

      setDisplayMessages((prev) => [...prev, {
        id: `spont-label-${Date.now()}`, role: 'debate_label',
        content: `⚔ the frogs start arguing · ${frogA.name} vs ${frogB.name}`,
      }]);

      let lastAResponse = '';
      let lastBResponse = '';

      for (let round = 1; round <= DEBATE_ROUNDS; round++) {
        const memCtxA = buildInterruptionContext(pondMemoryRef.current, frogAId, userName || undefined);
        const promptA = round === 1
          ? buildDebateOpeningPrompt(frogA, topic, frogB.name, memCtxA)
          : buildDebateResponsePrompt(frogA, topic, frogB.name, lastBResponse, round, memCtxA);
        const msgAId = `spont-${frogAId}-r${round}-${Date.now()}`;
        setDisplayMessages((prev) => [...prev, { id: msgAId, role: 'debate_turn', content: '', frogId: frogAId, isStreaming: true }]);
        lastAResponse = await streamOneShot(msgAId, promptA, frogAId);

        await new Promise((r) => setTimeout(r, 280));

        const memCtxB = buildInterruptionContext(pondMemoryRef.current, frogBId, userName || undefined);
        const promptB = buildDebateResponsePrompt(frogB, topic, frogA.name, lastAResponse, round, memCtxB);
        const msgBId = `spont-${frogBId}-r${round}-${Date.now()}`;
        setDisplayMessages((prev) => [...prev, { id: msgBId, role: 'debate_turn', content: '', frogId: frogBId, isStreaming: true }]);
        lastBResponse = await streamOneShot(msgBId, promptB, frogBId);

        if (round < DEBATE_ROUNDS) await new Promise((r) => setTimeout(r, 280));
      }

      recordDisagreement(pondMemoryRef.current, frogAId, lastAResponse, frogBId, lastBResponse);

      setDisplayMessages((prev) => [...prev, {
        id: `spont-end-${Date.now()}`, role: 'debate_label',
        content: `the pond settles. for now.`,
      }]);

      resetSpontaneousDebateTimer();
    }, delay);
  }, [status, unlockedFrogs, streamOneShot, triggerBurst, userName]);

  useEffect(() => {
    if (status === 'ready') resetSpontaneousDebateTimer();
    return () => { if (spontaneousDebateTimerRef.current) clearTimeout(spontaneousDebateTimerRef.current); };
  }, [status, resetSpontaneousDebateTimer]);

  // ── Username save ─────────────────────────────────────────────────────────────

  const saveUserName = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    localStorage.setItem('frognal_username', trimmed);
    setUserName(trimmed);
    setShowNameModal(false);
  }, []);

  // ── Frog switch ───────────────────────────────────────────────────────────────

  const switchFrog = useCallback((newFrogId: FrogId) => {
    if (newFrogId === activeFrogId || isBlocked) return;
    sounds.switchFrog(); triggerBurst();
    setActiveFrogId(newFrogId); clearHistory();
    streakCountRef.current = 0; setStreakCount(0);
    resetSilenceTimer();
    resetSpontaneousDebateTimer();

    const switchedFrog = allFrogs[newFrogId] ?? FROGS[newFrogId as keyof typeof FROGS];
    setDisplayMessages((prev) => [...prev, { id: `splash-${newFrogId}-${Date.now()}`, role: 'splash', content: switchedFrog.splashLine, frogId: newFrogId }]);

  }, [activeFrogId, clearHistory, isBlocked, resetSilenceTimer, resetSpontaneousDebateTimer, triggerBurst, allFrogs]);

  // ── Poke ──────────────────────────────────────────────────────────────────────

  const handlePoke = useCallback(async (msg: DisplayMessage) => {
    if (!msg.frogId || isBlocked) return;
    sounds.poke(); resetSilenceTimer();
    applyMoodShift(msg.frogId, 'was_poked');
    const frog = FROGS[msg.frogId];
    const memCtx = buildInterruptionContext(pondMemoryRef.current, msg.frogId, userName || undefined);
    const prompt = buildPokePrompt(frog, msg.content, memCtx);
    const msgId = `poke-${msg.frogId}-${Date.now()}`;
    setDisplayMessages((prev) => [...prev, { id: msgId, role: 'poke', content: '', frogId: msg.frogId, isStreaming: true }]);
    await streamOneShot(msgId, prompt, msg.frogId);
  }, [isBlocked, resetSilenceTimer, streamOneShot, applyMoodShift]);

  // ── Interruption orchestrator ────────────────────────────────────────────────

  const runInterruptions = useCallback(async (
    currentActiveFrogId: FrogId, lastUserMsg: string, lastFrogMsg: string,
  ) => {
    const plan = planInterruption(currentActiveFrogId, streakCountRef.current, lastUserMsg, unlockedFrogs);
    if (!plan.shouldInterrupt || !plan.interruptingFrogId) return;

    if (plan.isEasterEgg) { sounds.easterEgg(); triggerFlash(plan.interruptingFrogId); }
    else sounds.pop();
    triggerBurst();

    const interruptorIds: FrogId[] = [plan.interruptingFrogId, ...(plan.shouldPileOn && plan.pileOnFrogId ? [plan.pileOnFrogId] : [])];
    let lastInterruptorId = plan.interruptingFrogId;
    let lastInterruptorResponse = '';

    for (const frogId of interruptorIds) {
      applyMoodShift(frogId, 'did_interrupt');
      applyMoodShift(currentActiveFrogId, 'was_interrupted');
      const frog = FROGS[frogId];
      const activeFrogName = FROGS[currentActiveFrogId].name;
      const memCtx = buildInterruptionContext(pondMemoryRef.current, frogId, userName || undefined);
      const prompt = buildInterruptionPrompt(frog, lastUserMsg, activeFrogName, lastFrogMsg, plan.isEasterEgg, memCtx);
      const msgId = `interruption-${frogId}-${Date.now()}`;
      setDisplayMessages((prev) => [...prev, { id: msgId, role: 'interruption', content: '', frogId, isStreaming: true }]);
      lastInterruptorResponse = await streamOneShot(msgId, prompt, frogId);
      lastInterruptorId = frogId;
      if (interruptorIds.length > 1) { await new Promise((r) => setTimeout(r, 350)); sounds.pop(); }
    }

    recordDisagreement(pondMemoryRef.current, lastInterruptorId, lastInterruptorResponse, currentActiveFrogId, lastFrogMsg);

    if (shouldFireLastWord()) {
      const activeFrogObj = FROGS[currentActiveFrogId];
      const memCtx = buildInterruptionContext(pondMemoryRef.current, currentActiveFrogId, userName || undefined);
      const lastWordPrompt = buildLastWordPrompt(activeFrogObj, FROGS[lastInterruptorId].name, lastInterruptorResponse, memCtx);
      const lastWordMsgId = `lastword-${currentActiveFrogId}-${Date.now()}`;
      setDisplayMessages((prev) => [...prev, { id: lastWordMsgId, role: 'lastword', content: '', frogId: currentActiveFrogId, isStreaming: true }]);
      await streamOneShot(lastWordMsgId, lastWordPrompt, currentActiveFrogId);
    }
  }, [streamOneShot, applyMoodShift, triggerBurst, triggerFlash, unlockedFrogs, userName]);

  // ── Agreement check ───────────────────────────────────────────────────────────

  const runAgreement = useCallback(async (
    currentActiveFrogId: FrogId,
    lastFrogMsg: string,
  ) => {
    if (!shouldFireAgreement()) return;
    const agreeingFrogId = pickAgreementFrog(currentActiveFrogId, unlockedFrogs);
    if (!agreeingFrogId) return;

    const agreeingFrog = FROGS[agreeingFrogId];
    const activeFrogName = FROGS[currentActiveFrogId].name;
    const memCtx = buildInterruptionContext(pondMemoryRef.current, agreeingFrogId, userName || undefined);
    const prompt = buildAgreementPrompt(agreeingFrog, activeFrogName, lastFrogMsg, memCtx);
    const msgId = `agreement-${agreeingFrogId}-${Date.now()}`;

    await new Promise((r) => setTimeout(r, 400));
    sounds.pop();
    applyMoodShift(agreeingFrogId, 'did_interrupt');

    setDisplayMessages((prev) => [...prev, {
      id: msgId, role: 'agreement', content: '', frogId: agreeingFrogId, isStreaming: true,
    }]);
    await streamOneShot(msgId, prompt, agreeingFrogId);
  }, [streamOneShot, applyMoodShift, unlockedFrogs, userName]);

  // ── Debate mode ───────────────────────────────────────────────────────────────

  const runDebate = useCallback(async (topic: string) => {
    const [frogAId, frogBId] = pickDebateFrogs(topic, unlockedFrogs);
    const frogA = FROGS[frogAId];
    const frogB = FROGS[frogBId];

    triggerBurst();
    sounds.switchFrog();

    setDisplayMessages((prev) => [...prev,
      { id: `debate-label-${Date.now()}`, role: 'debate_label', content: `⚔ debate: ${topic} · ${frogA.name} vs ${frogB.name}` },
    ]);

    let lastAResponse = '';
    let lastBResponse = '';

    for (let round = 1; round <= DEBATE_ROUNDS; round++) {
      const memCtxA = buildInterruptionContext(pondMemoryRef.current, frogAId, userName || undefined);
      const promptA = round === 1
        ? buildDebateOpeningPrompt(frogA, topic, frogB.name, memCtxA)
        : buildDebateResponsePrompt(frogA, topic, frogB.name, lastBResponse, round, memCtxA);
      const msgAId = `debate-${frogAId}-r${round}-${Date.now()}`;
      setDisplayMessages((prev) => [...prev, { id: msgAId, role: 'debate_turn', content: '', frogId: frogAId, isStreaming: true }]);
      lastAResponse = await streamOneShot(msgAId, promptA, frogAId);

      await new Promise((r) => setTimeout(r, 280));

      const memCtxB = buildInterruptionContext(pondMemoryRef.current, frogBId, userName || undefined);
      const promptB = buildDebateResponsePrompt(frogB, topic, frogA.name, lastAResponse, round, memCtxB);
      const msgBId = `debate-${frogBId}-r${round}-${Date.now()}`;
      setDisplayMessages((prev) => [...prev, { id: msgBId, role: 'debate_turn', content: '', frogId: frogBId, isStreaming: true }]);
      lastBResponse = await streamOneShot(msgBId, promptB, frogBId);

      if (round < DEBATE_ROUNDS) await new Promise((r) => setTimeout(r, 280));
    }

    recordDisagreement(pondMemoryRef.current, frogAId, lastAResponse, frogBId, lastBResponse);

    setDisplayMessages((prev) => [...prev,
      { id: `debate-end-${Date.now()}`, role: 'debate_label', content: `debate concluded · no winners in the pond` },
    ]);
  }, [streamOneShot, triggerBurst, unlockedFrogs]);

  // ── Sincerity unlock ──────────────────────────────────────────────────────────

  const triggerSincerityUnlock = useCallback(() => {
    setSincerityUnlocked(true);
    sounds.easterEgg();
    triggerBurst();
    const sincerityFrog = FROGS['sincerity'];

    setDisplayMessages((prev) => [
      ...prev,
      { id: `unlock-banner-${Date.now()}`, role: 'splash', content: '', frogId: 'sincerity' },
      { id: `unlock-splash-${Date.now()}`, role: 'splash', content: sincerityFrog.splashLine, frogId: 'sincerity' },
    ]);
  }, [triggerBurst]);

  // ── Image drop handler ────────────────────────────────────────────────────────

  const handleImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/') || isBlocked) return;

    resetSilenceTimer();

    let dataUrl: string;
    try {
      dataUrl = await resizeImage(file);
    } catch (err) {
      console.error('[FrogChat] image resize error:', err);
      return;
    }

    setDisplayMessages((prev) => [...prev, {
      id: `image-drop-${Date.now()}`, role: 'image_drop',
      content: '', imageDataUrl: dataUrl,
    }]);

    sounds.switchFrog();
    triggerBurst();

    const frogsToReact: FrogId[] = [...BASE_FROG_ORDER, ...(sincerityUnlocked ? ['sincerity' as FrogId] : [])];

    for (const frogId of frogsToReact) {
      const frog = FROGS[frogId];
      const memCtx = buildInterruptionContext(pondMemoryRef.current, frogId, userName || undefined);
      const prompt = buildImageReactionPrompt(frog, dataUrl, memCtx);
      const msgId = `image-reaction-${frogId}-${Date.now()}`;

      setDisplayMessages((prev) => [...prev, {
        id: msgId, role: 'image_reaction', content: '', frogId, isStreaming: true,
      }]);

      const { queue, finished } = createTypingBuffer(frog.typingProfile, (chunk) => {
        setDisplayMessages((prev) =>
          prev.map((m) => m.id === msgId ? { ...m, content: m.content + chunk } : m)
        );
      });

      await generateImageReaction(prompt, queue);
      await finished;

      setDisplayMessages((prev) =>
        prev.map((m) => m.id === msgId ? { ...m, isStreaming: false } : m)
      );

      await new Promise((r) => setTimeout(r, 220));
    }
  }, [isBlocked, resetSilenceTimer, triggerBurst, generateImageReaction, sincerityUnlocked]);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  }, [handleImageFile]);

  // ── Send message ──────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || status !== 'ready') return;
    setInputValue('');
    resetSilenceTimer();

    const debateTopic = checkDebateCommand(text);
    if (debateTopic) {
      setDisplayMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: 'user', content: text }]);
      await runDebate(debateTopic);
      return;
    }

    if (checkSincerityUnlock(text, totalExchangesRef.current, sincerityUnlocked)) {
      triggerSincerityUnlock();
    }

    setDisplayMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: 'user', content: text }]);

    const frogMsgId = `frog-${activeFrogId}-${Date.now()}`;
    setDisplayMessages((prev) => [...prev, { id: frogMsgId, role: 'frog', content: '', frogId: activeFrogId, isStreaming: true }]);

    try {
      let fullFrogResponse = '';
      const { queue, finished } = createTypingBuffer(activeFrog.typingProfile, (chunk) => {
        fullFrogResponse += chunk;
        setDisplayMessages((prev) => prev.map((m) => m.id === frogMsgId ? { ...m, content: m.content + chunk } : m));
      });

      const contextSuffix = buildContextSuffix(pondMemoryRef.current, activeFrogId, userName || undefined);
      await generate(text, queue, contextSuffix);
      await finished;

      setDisplayMessages((prev) => prev.map((m) => m.id === frogMsgId ? { ...m, isStreaming: false } : m));

      updateMemory(pondMemoryRef.current, text, fullFrogResponse);
      updateReputation(pondMemoryRef.current, activeFrogId, text);

      totalExchangesRef.current += 1;
      streakCountRef.current += 1;
      setStreakCount(streakCountRef.current);

      const rareEvent = checkRareEvent(activeFrogId, pondMemoryRef.current);
      if (rareEvent) {
        await new Promise((r) => setTimeout(r, 600));
        setDisplayMessages((prev) => [...prev, { id: `rare-${activeFrogId}-${Date.now()}`, role: 'rare_event', content: rareEvent.message, frogId: activeFrogId }]);
      }

      // Soft limit: reduce interruption chance by skipping if budget is tight
      if (!requestBudget.isExhausted) {
        // At soft limit, only run interruptions 50% of the time
        const skip = requestBudget.isTight && Math.random() < 0.5;
        if (!skip) await runInterruptions(activeFrogId, text, fullFrogResponse);
      }
      
      if (!requestBudget.isTight) {
        await runAgreement(activeFrogId, fullFrogResponse);
      }

    } catch (err) {
      console.error('[FrogChat] error:', err);
      setDisplayMessages((prev) => prev.map((m) => m.id === frogMsgId ? { ...m, content: '...the frog glitched. the pond is broken.', isStreaming: false } : m));
    }
  }, [inputValue, status, activeFrogId, activeFrog, generate, runInterruptions, runAgreement, resetSilenceTimer, runDebate, sincerityUnlocked, triggerSincerityUnlock]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Render guards ──────────────────────────────────────────────────────────────

  if (status === 'error' && error) return <ErrorScreen error={error} />;

  const statusLabel = status === 'generating' ? `${activeFrog.name} is typing...` : status === 'interrupting' ? 'something stirs in the pond...' : 'ready';

  // ─── Main UI ──────────────────────────────────────────────────────────────────

  return (
    <div style={s.root} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>

      <input
        ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }}
      />

      {isDragging && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `rgba(0,0,0,0.72)`, border: `2px dashed ${activeFrog.color}`, pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 56 }}>🐸</div>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 10, color: activeFrog.color, letterSpacing: '0.08em', marginTop: 14 }}>
              drop it in the pond
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--text-dim)', marginTop: 6 }}>
              all frogs will react
            </div>
          </div>
        </div>
      )}

      <BubbleBackground frog={activeFrog} burst={burstActive} />

      {showNameModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)' }}>
          <div style={{ background: 'var(--pond-deep)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '32px 28px', width: 320, display: 'flex', flexDirection: 'column', gap: 18, boxShadow: '0 0 40px rgba(57,255,20,0.08)' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 10, color: '#39ff14', letterSpacing: '0.08em', marginBottom: 8 }}>
                welcome to the pond
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                what should the frogs call you?
              </div>
            </div>
            <input
              autoFocus
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveUserName(nameInput); }}
              placeholder="your name..."
              maxLength={24}
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '10px 13px', fontFamily: 'var(--font-mono)', fontSize: 20, color: 'var(--text-primary)', outline: 'none', caretColor: '#39ff14' }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => saveUserName(nameInput)}
                disabled={!nameInput.trim()}
                style={{ flex: 1, padding: '9px 0', borderRadius: 6, background: nameInput.trim() ? 'rgba(57,255,20,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${nameInput.trim() ? 'rgba(57,255,20,0.3)' : 'rgba(255,255,255,0.07)'}`, color: nameInput.trim() ? '#39ff14' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 17, cursor: nameInput.trim() ? 'pointer' : 'not-allowed', transition: 'all 0.15s' }}
              >
                enter the pond
              </button>
              <button
                onClick={() => saveUserName('stranger')}
                style={{ padding: '9px 14px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 15, cursor: 'pointer' }}
                title="skip"
              >
                skip
              </button>
            </div>
          </div>
        </div>
      )}

      {showForge && wallet.isEligible && wallet.address && (
        <CustomFrogCreator
          creatorAddress={wallet.address}
          onFrogCreated={(frog, shareUrl) => {
            setCustomFrog(frog);
            setShowForge(false);
            setActiveFrogId(frog.id as FrogId);
            clearHistory();
            setDisplayMessages(prev => [...prev, {
              id: `splash-custom-${Date.now()}`, role: 'splash' as const,
              content: `✦ ${frog.name} enters the pond.`, frogId: frog.id as FrogId,
            }]);
          }}
          onClose={() => setShowForge(false)}
        />
      )}

      <div aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.22) 3px, rgba(0,0,0,0.22) 4px)', backgroundSize: '100% 4px', animation: 'scanlines 0.5s steps(1) infinite', mixBlendMode: 'multiply', opacity: activeFrog.vibe.scanlineOpacity, transition: 'opacity 0.6s ease' }} />
      <div aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1, opacity: activeFrog.vibe.grainOpacity, transition: 'opacity 0.6s ease', backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`, backgroundRepeat: 'repeat', backgroundSize: '200px 200px' }} />
      <div aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, background: activeFrog.vibe.ambientGradient, transition: 'background 0.7s ease' }} />

      <div style={s.layout}>
        {/* Header */}
        <header style={s.header}>
          <div>
            <h1 style={s.logo}>FROG<span style={{ color: activeFrog.color, transition: 'color 0.4s ease' }}>NAL</span></h1>
            <div style={s.logoSub}>chaotic mascot ai · gemini 2.5 flash · cloud</div>
          </div>
          <a
            href="https://clanker.world/clanker/0xE7e6C75C662798d1Dfaffa280c62C25ed7a93b07"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '6px 14px', borderRadius: 999,
              background: 'rgba(57,255,20,0.08)',
              border: '1px solid rgba(57,255,20,0.35)',
              fontFamily: 'var(--font-pixel)', fontSize: 10,
              color: '#39ff14', letterSpacing: '0.07em',
              textDecoration: 'none',
              boxShadow: '0 0 14px rgba(57,255,20,0.2), 0 0 28px rgba(57,255,20,0.08)',
              animation: 'coin-pulse 2.4s ease-in-out infinite',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 16 }}>🐸</span>
            $FROGNAL
          </a>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Wallet button — always visible when CUSTOM_FROG_CREATOR is on */}
            {FEATURES.CUSTOM_FROG_CREATOR && (
              <button
                onClick={wallet.isConnected ? wallet.disconnect : wallet.openConnect}
                title={wallet.isConnected
                  ? `${wallet.formattedBalance} $FROGNAL · click to disconnect`
                  : 'Connect wallet to forge frogs'}
                style={{ ...s.iconButton,
                  color: wallet.isConnected
                    ? wallet.isEligible ? '#39ff14' : '#c8e6c8'
                    : '#c8e6c8',
                  borderColor: wallet.isConnected && wallet.isEligible
                    ? 'rgba(57,255,20,0.5)' : 'rgba(255,255,255,0.25)',
                  background: 'rgba(255,255,255,0.06)',
                  fontSize: 13, gap: 5, display: 'flex', alignItems: 'center',
                  padding: '0 10px', width: 'auto',
                }}>
                {wallet.isConnected
                  ? `${wallet.address?.slice(0,6)}…${wallet.address?.slice(-4)}`
                  : '⬡'}
              </button>
            )}

            <button onClick={() => exportConversation(displayMessages)} title="export" disabled={displayMessages.filter(m => m.role !== 'splash').length === 0} style={{ ...s.iconButton, color: 'var(--text-dim)', borderColor: 'rgba(255,255,255,0.07)', opacity: displayMessages.filter(m => m.role !== 'splash').length === 0 ? 0.3 : 1, cursor: displayMessages.filter(m => m.role !== 'splash').length === 0 ? 'not-allowed' : 'pointer' }}>↓</button>
            <button onClick={() => { const muted = ambient.toggle(); setIsAmbient(!muted); }} title={isAmbient ? 'stop pond sounds' : 'start pond sounds'} style={{ ...s.iconButton, color: isAmbient ? activeFrog.color : 'var(--text-muted)', borderColor: isAmbient ? activeFrog.borderColor : 'rgba(255,255,255,0.07)', boxShadow: isAmbient ? `0 0 10px ${activeFrog.glowColor.replace('0.45','0.3')}` : 'none', transition: 'all 0.3s' }}>🌿</button>
            <button onClick={() => { const nowMuted = sounds.toggle(); setIsMuted(nowMuted); }} title={isMuted ? 'unmute' : 'mute'} style={{ ...s.iconButton, color: isMuted ? 'var(--text-muted)' : activeFrog.color, borderColor: isMuted ? 'rgba(255,255,255,0.07)' : activeFrog.borderColor }}>{isMuted ? '🔇' : '🔊'}</button>
            <div style={s.statusPill}>
              <div style={{ ...s.statusDot, background: activeFrog.color, boxShadow: `0 0 8px ${activeFrog.glowColor}`, animation: isBlocked ? 'pulse-glow 0.6s ease-in-out infinite' : 'none', transition: 'background 0.4s ease' }} />
              <span style={{ color: 'var(--text-dim)', fontSize: 14, fontFamily: 'var(--font-mono)' }}>{statusLabel}</span>
            </div>
          </div>
        </header>

        {/* Frog selector */}
        <div style={s.frogSelector}>
          
          {/* Forge button */}
          {FEATURES.CUSTOM_FROG_CREATOR && (
            <button
              title={
               !wallet.isConnected ? 'Connect wallet to forge' :
               !wallet.isEligible  ? `Need 50K $FROGNAL · you have ${wallet.formattedBalance}` :
               'Open Frog Forge'
             }
             onClick={() => {
               if (!wallet.isConnected) { wallet.openConnect(); return; }
               if (wallet.isEligible)   setShowForge(true);
             }}
              disabled={isBlocked}
              style={{ ...s.frogPill,
                background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${wallet.isEligible ? 'rgba(57,255,20,0.5)' : 'rgba(255,255,255,0.25)'}`,
                color:  wallet.isEligible ? '#39ff14' : '#c8e6c8',
                opacity: isBlocked ? 0.3 : 1,
                cursor: isBlocked ? 'not-allowed' : 'pointer',
                letterSpacing: '0.04em',
              }}>
              <span style={{ fontSize: 14 }}>⚒</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>
                {wallet.isConnected && !wallet.isEligible
                 ? `${wallet.formattedBalance} / 50K`
                 : 'forge'}
              </span>
            </button>
          )}

          {displayFrogOrder.map((frogId) => {
            const frog = allFrogs[frogId] ?? FROGS[frogId as keyof typeof FROGS];
            if (!frog) return null;
            const isActive = frogId === activeFrogId;
            const isFlashing = frogId === flashFrogId;
            const mood = moodState[frogId];
            const moodEmoji = MOOD_EMOJI[mood];
            const isNewlyUnlocked = frogId === 'sincerity' && sincerityUnlocked;

            return (
              <button key={frogId} onClick={() => switchFrog(frogId)} disabled={isBlocked} title={frog.tagline}
                style={{ ...s.frogPill, background: isActive ? frog.bgColor : 'rgba(255,255,255,0.03)', border: `1px solid ${isActive ? frog.borderColor : isFlashing ? frog.borderColor : 'rgba(255,255,255,0.07)'}`, color: isActive ? frog.color : 'var(--text-muted)', boxShadow: isFlashing ? `0 0 28px ${frog.glowColor}, 0 0 8px ${frog.glowColor}` : isActive ? `0 0 18px ${frog.glowColor.replace('0.45', '0.22')}` : 'none', transform: isActive ? 'translateY(-2px)' : isFlashing ? 'translateY(-3px) scale(1.04)' : 'none', cursor: isBlocked ? 'not-allowed' : 'pointer', opacity: isBlocked && !isActive ? 0.4 : 1, transition: 'all 0.2s ease', animation: isFlashing ? 'pill-flash 0.9s ease-out' : isNewlyUnlocked ? 'msg-in 0.5s ease-out' : 'none' }}>
                <span style={{ fontSize: 16 }}>{frog.emoji}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15 }}>{frog.name}</span>
                {String(frogId).startsWith('custom_') && (
                  <span style={{
                    fontFamily: 'var(--font-pixel)', fontSize: 7,
                    padding: '2px 5px', borderRadius: 3,
                    background: `${frog.color}22`,
                    border: `1px solid ${frog.color}55`,
                    color: frog.color, opacity: 0.8,
                    letterSpacing: '0.04em',
                  }}>
                    custom
                  </span>
                )}
                {moodEmoji && <span style={{ fontSize: 12, marginLeft: 2 }} title={mood}>{moodEmoji}</span>}
                {!isActive && !isBlocked && <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: frog.color, opacity: 0.45, marginLeft: 4, flexShrink: 0, animation: `pulse-glow ${Math.max(0.5, 2.2 - streakCount * 0.18).toFixed(2)}s ease-in-out infinite` }} title="lurking..." />}
              </button>
            );
          })}

          {!sincerityUnlocked && (
            <div title="???" style={{ ...s.frogPill, background: 'rgba(255,255,255,0.01)', border: '1px dashed rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.1)', cursor: 'default', userSelect: 'none', fontFamily: 'var(--font-mono)', fontSize: 14, letterSpacing: '0.1em' }}>
              • • •
            </div>
          )}
        </div>

        {/* Pond */}
        <div style={s.pond}>
          <div style={s.messagesInner}>
            {displayMessages.map((msg) => {
              if (msg.role === 'splash' && msg.frogId === 'sincerity' && msg.content === '' && sincerityUnlocked) {
                return <UnlockBanner key={msg.id} frog={FROGS['sincerity']} />;
              }
              return <MessageBubble key={msg.id} msg={msg} onPoke={handlePoke} isBlocked={isBlocked} userName={userName} />;
            })}

            {isBlocked && (() => {
              const last = displayMessages[displayMessages.length - 1];
              if (last && ['frog','interruption','lastword','silence','poke','debate_turn','image_reaction','agreement'].includes(last.role) && last.content === '') {
                const frog = last.frogId ? FROGS[last.frogId] : activeFrog;
                return <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}><span style={{ fontSize: 18 }}>{frog.emoji}</span><TypingDots color={frog.color} /></div>;
              }
              return null;
            })()}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div style={s.inputBar}>
          <div style={{ ...s.inputWrapper, borderColor: inputValue ? activeFrog.borderColor : isDragging ? activeFrog.borderColor : 'rgba(255,255,255,0.09)', boxShadow: inputValue ? `0 0 14px ${activeFrog.glowColor.replace('0.45', '0.12')}` : 'none' }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isBlocked}
              title="drop an image into the pond"
              style={{ width: 36, height: 36, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0, background: 'transparent', border: 'none', cursor: isBlocked ? 'not-allowed' : 'pointer', opacity: isBlocked ? 0.3 : 0.5, transition: 'opacity 0.15s', color: 'var(--text-primary)' }}
              onMouseEnter={(e) => { if (!isBlocked) (e.currentTarget as HTMLElement).style.opacity = '1'; }}
              onMouseLeave={(e) => { if (!isBlocked) (e.currentTarget as HTMLElement).style.opacity = '0.5'; }}
            >
              🖼
            </button>

            <textarea value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="throw something into the pond... or /debate [topic]"
              disabled={isBlocked} rows={1}
              style={{ ...s.textarea, color: inputValue ? activeFrog.color : 'var(--text-dim)', caretColor: activeFrog.color, cursor: isBlocked ? 'not-allowed' : 'text' }} />
            <button onClick={handleSend} disabled={!inputValue.trim() || isBlocked}
              style={{ ...s.sendButton, background: !inputValue.trim() || isBlocked ? 'rgba(255,255,255,0.04)' : activeFrog.bgColor, border: `1px solid ${!inputValue.trim() || isBlocked ? 'rgba(255,255,255,0.08)' : activeFrog.borderColor}`, color: !inputValue.trim() || isBlocked ? 'var(--text-muted)' : activeFrog.color, boxShadow: !inputValue.trim() || isBlocked ? 'none' : `0 0 10px ${activeFrog.glowColor.replace('0.45', '0.28')}`, cursor: !inputValue.trim() || isBlocked ? 'not-allowed' : 'pointer' }}>
              {status === 'generating' ? '◌' : status === 'interrupting' ? '⚡' : '▶'}
            </button>
          </div>
          <div style={s.inputHint}>
            enter · 🖼 or drag image · /debate [topic] · click to poke ·{' '}
            <span style={{ color: activeFrog.color, opacity: 0.55, transition: 'color 0.4s' }}>{activeFrog.name}</span>
            {' '}listening · ↓ export
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  root: { position: 'fixed', inset: 0, background: 'var(--pond-black)', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  bubbleContainer: { position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 },
  layout: { position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 880, margin: '0 auto', width: '100%', padding: '0 var(--gutter)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 0 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 },
  logo: { fontFamily: 'var(--font-pixel)', fontSize: 'clamp(14px, 2.8vw, 22px)', letterSpacing: '0.05em', color: 'var(--text-primary)', textShadow: '0 0 20px rgba(57,255,20,0.2)', lineHeight: 1 },
  logoSub: { fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 5 },
  iconButton: { background: 'rgba(255,255,255,0.03)', border: '1px solid', borderRadius: 6, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, cursor: 'pointer', flexShrink: 0, transition: 'all 0.2s' },
  statusPill: { display: 'flex', alignItems: 'center', gap: 7, padding: '5px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 999 },
  statusDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  frogSelector: { display: 'flex', gap: 7, padding: '12px 0 10px', flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none' },
  frogPill: { display: 'flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 6, whiteSpace: 'nowrap', flexShrink: 0 },
  pond: { flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '6px 0' },
  messagesInner: { display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 8 },
  splashLine: { fontFamily: 'var(--font-mono)', fontSize: 16, padding: '7px 12px', borderRadius: 4, borderLeft: '2px solid', background: 'rgba(255,255,255,0.02)', letterSpacing: '0.02em', animation: 'msg-in 0.3s ease-out' },
  avatarBadge: { width: 36, height: 36, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0, marginTop: 2 },
  userAvatar: { width: 36, height: 36, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontFamily: 'var(--font-pixel)', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0, marginTop: 2 },
  inputBar: { flexShrink: 0, padding: '12px 0 18px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 6 },
  inputWrapper: { display: 'flex', gap: 10, alignItems: 'flex-end', background: 'rgba(255,255,255,0.03)', border: '1px solid', borderRadius: 8, padding: '10px 12px', transition: 'border-color 0.2s, box-shadow 0.2s' },
  textarea: { flex: 1, background: 'transparent', border: 'none', outline: 'none', resize: 'none', fontFamily: 'var(--font-mono)', fontSize: 20, lineHeight: 1.4, overflowY: 'hidden', minHeight: 28, maxHeight: 120 },
  sendButton: { width: 40, height: 40, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0, transition: 'all 0.15s ease' },
  inputHint: { fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.04em', textAlign: 'center', textTransform: 'uppercase' },
  loadingScreen: { position: 'fixed', inset: 0, background: 'var(--pond-black)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  loadingContent: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 32 },
  loadingTitle: { fontFamily: 'var(--font-pixel)', fontSize: 'clamp(16px, 4vw, 28px)', color: 'var(--text-primary)', letterSpacing: '0.1em' },
};