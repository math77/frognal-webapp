'use client';

/**
 * CustomFrogCreator.tsx
 * Modal for forging a custom frog. Gated by 50K $FROGNAL balance.
 * Sends everything (including API key) to /api/frogs, which encrypts the key
 * and writes to Supabase. The key never lives in client state after save.
 */

import { CSSProperties, useState, useCallback } from 'react';
import { COLOR_PRESETS, MODEL_OPTIONS, type ColorPreset } from '@/lib/customFrog';
import type { FrogConfig } from '@/lib/frogs';
import type { Address }    from 'viem';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormState {
  name:         string;
  emoji:        string;
  tagline:      string;
  systemPrompt: string;
  color:        ColorPreset;
  apiProvider:  'openai' | 'anthropic';
  apiKey:       string;
  modelId:      string;
}

interface Props {
  creatorAddress: Address;
  onFrogCreated:  (frog: FrogConfig, shareUrl: string) => void;
  onClose:        () => void;
}

const DEFAULT_MODEL = MODEL_OPTIONS[0];

const PROMPT_PLACEHOLDER =
  `You are [Name], a [personality] frog living in a browser pond.\n\n` +
  `Your voice: [tone, catchphrases, speech patterns]\n\n` +
  `RULES:\n- Responses MUST be 2–3 sentences MAX.\n- [Personality-specific rules]\n- NEVER break character.`;

// ─── Component ────────────────────────────────────────────────────────────────

export function CustomFrogCreator({ creatorAddress, onFrogCreated, onClose }: Props) {
  const [form, setForm] = useState<FormState>({
    name: '', emoji: '🐸', tagline: '', systemPrompt: '',
    color: COLOR_PRESETS[0],
    apiProvider: DEFAULT_MODEL.provider,
    apiKey: '',
    modelId: DEFAULT_MODEL.modelId,
  });

  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [showKey,   setShowKey]   = useState(false);
  const [step,      setStep]      = useState<'form' | 'success'>('form');
  const [shareUrl,  setShareUrl]  = useState('');
  const [copied, setCopied] = useState(false);
  const [createdFrog, setCreatedFrog] = useState<FrogConfig | null>(null);

  const canSave =
    form.name.trim().length > 0 &&
    form.emoji.trim().length > 0 &&
    form.tagline.trim().length > 0 &&
    form.systemPrompt.trim().length >= 20 &&
    form.apiKey.trim().length > 10;

  const filteredModels = MODEL_OPTIONS.filter(m => m.provider === form.apiProvider);
  const c = form.color;

  // ── Update provider → reset model to first valid ──────────────────────────

  const setProvider = (provider: 'openai' | 'anthropic') => {
    const first = MODEL_OPTIONS.find(m => m.provider === provider)!;
    setForm(f => ({ ...f, apiProvider: provider, modelId: first.modelId }));
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/frogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_address: creatorAddress,
          name:            form.name.trim(),
          emoji:           form.emoji.trim(),
          tagline:         form.tagline.trim(),
          system_prompt:   form.systemPrompt.trim(),
          color:           form.color.color,
          bg_color:        form.color.bgColor,
          border_color:    form.color.borderColor,
          glow_color:      form.color.glowColor,
          api_provider:    form.apiProvider,
          api_key:         form.apiKey.trim(),
          model_id:        form.modelId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      //setShareUrl(data.shareUrl);
      //setStep('success');
      //onFrogCreated(data.frog as FrogConfig, data.shareUrl as string);

      setShareUrl(data.shareUrl);
      setCreatedFrog(data.frog as FrogConfig);
      setStep('success');

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }, [canSave, creatorAddress, form, onFrogCreated]);

  // ── Key placeholder by provider ───────────────────────────────────────────

  const keyPlaceholder =
    form.apiProvider === 'openai' ? 'sk-...' : 'sk-ant-api03-...';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={overlay}>
      <div style={{ ...modal, borderColor: c.borderColor, boxShadow: `0 0 60px ${c.glowColor}` }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 11, color: c.color, letterSpacing: '0.1em' }}>✦ FROG FORGE ✦</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-dim)', marginTop: 4 }}>
              create your custom frog · share with anyone
            </div>
          </div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        {/* ── Success ── */}
        {step === 'success' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '8px 0' }}>

            {/* Frog identity */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 56 }}>{form.emoji}</div>
              <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 11, color: c.color, marginTop: 14, letterSpacing: '0.08em' }}>
                {form.name} is alive
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--text-dim)', marginTop: 6 }}>
                {form.tagline}
              </div>
              <div style={{ display: 'inline-block', marginTop: 10, padding: '3px 12px', borderRadius: 4, background: c.bgColor, border: `1px solid ${c.borderColor}`, fontFamily: 'var(--font-mono)', fontSize: 13, color: c.color, opacity: 0.7 }}>
                {form.apiProvider} · {MODEL_OPTIONS.find(m => m.modelId === form.modelId)?.label ?? form.modelId}
              </div>
            </div>

            {/* Share link */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${c.borderColor}`, borderRadius: 8, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.07em' }}>
                share link — anyone with this URL can chat with {form.name}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: c.color, wordBreak: 'break-all', lineHeight: 1.5 }}>
                {shareUrl}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                style={{ alignSelf: 'flex-start', padding: '7px 18px', borderRadius: 6, background: copied ? c.bgColor : 'rgba(255,255,255,0.05)', border: `1px solid ${copied ? c.color : 'rgba(255,255,255,0.15)'}`, color: copied ? c.color : '#c8e6c8', fontFamily: 'var(--font-mono)', fontSize: 15, cursor: 'pointer', transition: 'all 0.15s' }}>
                {copied ? '✓ copied!' : '⎘ copy link'}
              </button>
            </div>

            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--text-dim)', textAlign: 'center' }}>
              the frog has been loaded into your pond
            </div>

            <button onClick={() => {
              if (createdFrog) onFrogCreated(createdFrog, shareUrl);
              onClose();}}
              style={{ padding: '12px 0', borderRadius: 6, border: `1px solid ${c.borderColor}`, background: c.bgColor, color: c.color, fontFamily: 'var(--font-mono)', fontSize: 18, cursor: 'pointer', letterSpacing: '0.04em' }}
            >
              close forge
            </button>
          </div>
        ) : (
        // ── Form ──
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto', maxHeight: 'calc(90vh - 130px)', paddingRight: 4 }}>

          {/* Live preview */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: c.bgColor, border: `1px solid ${c.borderColor}`, borderRadius: 8 }}>
            <div style={{ fontSize: 24 }}>{form.emoji || '🐸'}</div>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: c.color }}>{form.name || 'Unnamed Frog'}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: c.color, opacity: 0.55 }}>{form.tagline || 'no tagline'}</div>
            </div>
            <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-pixel)', fontSize: 8, color: c.color, opacity: 0.5 }}>preview</div>
          </div>

          {/* Name + Emoji */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <FieldLabel text={`Name  ${form.name.length}/24`} />
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.slice(0, 24) }))}
                placeholder="Philosopher Frog" style={{ ...inp, borderColor: c.borderColor, caretColor: c.color }} />
            </div>
            <div style={{ width: 80 }}>
              <FieldLabel text="Emoji" />
              <input value={form.emoji} onChange={e => setForm(f => ({ ...f, emoji: e.target.value.slice(0, 2) }))}
                placeholder="🐸" style={{ ...inp, borderColor: c.borderColor, caretColor: c.color, textAlign: 'center', fontSize: 22 }} />
            </div>
          </div>

          {/* Tagline */}
          <div>
            <FieldLabel text={`Tagline  ${form.tagline.length}/80`} />
            <input value={form.tagline} onChange={e => setForm(f => ({ ...f, tagline: e.target.value.slice(0, 80) }))}
              placeholder="terminally confused" style={{ ...inp, borderColor: c.borderColor, caretColor: c.color }} />
          </div>

          {/* Color */}
          <div>
            <FieldLabel text="Color" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {COLOR_PRESETS.map(preset => (
                <button key={preset.id} title={preset.label}
                  onClick={() => setForm(f => ({ ...f, color: preset }))}
                  style={{ width: 34, height: 34, borderRadius: 6, background: preset.bgColor, cursor: 'pointer', transition: 'all 0.15s',
                    border: `2px solid ${form.color.id === preset.id ? preset.color : preset.borderColor}`,
                    boxShadow: form.color.id === preset.id ? `0 0 10px ${preset.glowColor}` : 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: preset.color }} />
                </button>
              ))}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)', marginTop: 5 }}>{form.color.label}</div>
          </div>

          {/* System prompt */}
          <div>
            <FieldLabel text={`System Prompt  ${form.systemPrompt.length}/2000`} />
            <textarea value={form.systemPrompt}
              onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value.slice(0, 2000) }))}
              placeholder={PROMPT_PLACEHOLDER} rows={9}
              style={{ ...inp, borderColor: c.borderColor, caretColor: c.color, resize: 'vertical', lineHeight: 1.5, fontSize: 15 }} />
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              tip: include a RULES block. keep responses to 2–3 sentences max.
            </div>
          </div>

          {/* Provider selector */}
          <div>
            <FieldLabel text="AI Provider" />
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {(['openai', 'anthropic'] as const).map(p => (
                <button key={p} onClick={() => setProvider(p)}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'var(--font-mono)', fontSize: 16,
                    background: form.apiProvider === p ? c.bgColor : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${form.apiProvider === p ? c.borderColor : 'rgba(255,255,255,0.08)'}`,
                    color: form.apiProvider === p ? c.color : 'var(--text-muted)',
                  }}>
                  {p === 'openai' ? 'OpenAI' : 'Anthropic'}
                </button>
              ))}
            </div>
          </div>

          {/* Model selector */}
          <div>
            <FieldLabel text="Model" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {filteredModels.map(m => (
                <button key={m.modelId} onClick={() => setForm(f => ({ ...f, modelId: m.modelId }))}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 13px', borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
                    background: form.modelId === m.modelId ? c.bgColor : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${form.modelId === m.modelId ? c.borderColor : 'rgba(255,255,255,0.08)'}`,
                  }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: form.modelId === m.modelId ? c.color : 'var(--text-dim)' }}>{m.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: form.modelId === m.modelId ? c.color : 'var(--text-muted)', opacity: 0.6 }}>{m.note}</span>
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div>
            <FieldLabel text={`${form.apiProvider === 'openai' ? 'OpenAI' : 'Anthropic'} API Key`} />
            <div style={{ position: 'relative' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                placeholder={keyPlaceholder}
                autoComplete="off"
                style={{ ...inp, borderColor: c.borderColor, caretColor: c.color, paddingRight: 52 }}
              />
              <button onClick={() => setShowKey(v => !v)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)' }}>
                {showKey ? 'hide' : 'show'}
              </button>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>
              encrypted at rest · never returned to client · used only when your frog is called
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: '#ff6666', padding: '8px 12px', background: 'rgba(255,80,80,0.06)', border: '1px solid rgba(255,80,80,0.2)', borderRadius: 6 }}>
              {error}
            </div>
          )}

          {/* Save */}
          <button onClick={handleSave} disabled={!canSave || saving}
            style={{ ...btn(c), opacity: canSave && !saving ? 1 : 0.35, cursor: canSave && !saving ? 'pointer' : 'not-allowed' }}>
            {saving ? 'forging...' : 'forge frog →'}
          </button>

        </div>
        )}
      </div>
    </div>
  );
}

// ─── Micro-components ─────────────────────────────────────────────────────────

function FieldLabel({ text }: { text: string }) {
  return (
    <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: 'var(--text-dim)', letterSpacing: '0.06em', marginBottom: 6 }}>
      {text}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 70,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.88)',
};

const modal: CSSProperties = {
  background: 'var(--pond-deep)', border: '1px solid', borderRadius: 12,
  padding: '24px 28px', width: 'min(580px, calc(100vw - 24px))',
  maxHeight: '92vh', display: 'flex', flexDirection: 'column',
};

const closeBtn: CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--text-muted)',
  fontSize: 18, cursor: 'pointer', padding: 4, lineHeight: 1, flexShrink: 0,
};

const inp: CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid',
  borderRadius: 6, padding: '10px 13px', fontFamily: 'var(--font-mono)',
  fontSize: 18, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
};

const btn = (c: ColorPreset): CSSProperties => ({
  width: '100%', padding: '12px 0', borderRadius: 6, border: `1px solid ${c.borderColor}`,
  background: c.bgColor, color: c.color, fontFamily: 'var(--font-mono)',
  fontSize: 18, cursor: 'pointer', transition: 'all 0.15s', letterSpacing: '0.04em',
});
