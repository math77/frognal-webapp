# 🐸 FROGNAL

**A chaotic, personality-driven AI chat experience — no downloads, no local GPU, works in any browser.**

Frognal drops you into a pond with six (and a secret seventh) distinct frog personas, each powered by Google's Gemma 4 26B A4B model running in the cloud. The frogs interrupt each other, start spontaneous debates, react to images you drop into the pond, develop opinions of you over time, and occasionally do things you didn't ask for.

🔗 **[frognal.vercel.app](https://frognal.vercel.app)**

---

## Screenshots

<table>
  <tr>
    <td><img src="/public/assets/examples/example1.png" alt="Frognal screenshot 1" width="320"/></td>
    <td><img src="/public/assets/examples/example2.png" alt="Frognal screenshot 2" width="320"/></td>
    <td><img src="/public/assets/examples/example3.png" alt="Frognal screenshot 3" width="320"/></td>
  </tr>
  <tr>
    <td><img src="/public/assets/examples/example4.png" alt="Frognal screenshot 4" width="320"/></td>
    <td><img src="/public/assets/examples/example5.png" alt="Frognal screenshot 5" width="320"/></td>
    <td><img src="/public/assets/examples/example6.png" alt="Frognal screenshot 6" width="320"/></td>
  </tr>
  <tr>
    <td><img src="/public/assets/examples/example7.png" alt="Frognal screenshot 7" width="320"/></td>
    <td></td>
    <td></td>
  </tr>
</table>

---

## The Frogs

| Frog | Vibe |
|------|------|
| 🐸 **Shitposter Frog** | Terminally online. Responds exclusively in internet slang. |
| 🌧️ **Doomer Frog** | Precise, exhausted, resigned. Finds your situation accurate. |
| 🏺 **Philosopher Frog** | Cryptic. Sounds profound. Says very little. |
| 💼 **Corporate Frog** | Everything is a growth opportunity. Burnout is a pivot. |
| 📢 **Politician Frog** | NEVER answers directly. Always someone else's fault. |
| 🎩 **Aristocrat Frog** | Old money. Quietly devastating. Finds you beneath him. |
| 🕊️ **Sincerity Frog** | *Hidden.* Unlocks when you're genuinely kind to the pond. |
| ✦ **Custom Frogs** | Built by the community. Requires 50K $FROGNAL to forge. |

---

## Features

### Core pond behaviour
- **Interruption engine** — Lurking frogs jump in unprompted, pile on, and fire back at each other.
- **Spontaneous debates** — After 1.5–3 minutes of inactivity, two frogs start arguing on their own based on the current conversation theme.
- **Frog agreement** — Occasionally (~17% chance) a frog chimes in to agree with the active frog. In character.
- **Pond memory** — Frogs remember facts you mention, track conversation themes, and reference past disagreements.
- **User reputation** — Each frog develops a -3 to +3 opinion of you based on how you talk to them.
- **Mood system** — Frogs shift between baseline, hyped 🔥, annoyed 😤, contemplative 🌀, and tired 😴 states based on events.
- **Image reactions** — Drop any image into the pond and all frogs react to it in one sentence, in character.
- **Rare events** — Ultra-low-probability (2%) one-off moments per session. Aristocrat threatens to leave. Corporate glimpses the void.
- **Secret 7th frog** — Sincerity Frog is hidden until you say something genuinely kind after 8+ exchanges.
- **Procedural ambient sound** — Optional pond soundscape (water, crickets, frog croaks) synthesised entirely via Web Audio API.
- **Poke mechanic** — Click any frog message to make them react to what they said.
- **Silence triggers** — Leave the pond idle for ~75 seconds and a frog will say something into the void.
- **/debate command** — Trigger a frog vs frog debate on any topic. 3 rounds, no user involvement needed.
- **Export** — Download a styled HTML transcript of the conversation.
- **Time awareness** — Frogs know whether it's 3am or a Tuesday afternoon.
- **Per-frog typing personality** — Each frog types at their own pace. Doomer is agonisingly slow. Corporate is rapid-fire. Aristocrat chooses every word with disdain.

### Custom Frog Forge ✦
- **Forge your own frog** — Connect a wallet holding 50K+ $FROGNAL on Base to unlock the Frog Forge.
- **Full persona control** — Set name, emoji, tagline, colour, and a full system prompt defining the frog's personality and rules.
- **Bring your own AI** — Choose your own OpenAI or Anthropic model and API key. Your key is AES-256-GCM encrypted before being stored — it is never returned to the client.
- **Supported models** — GPT-4.1 Nano, GPT-4.1 Mini, GPT-4.1, GPT-4o Mini, GPT-4o, Claude Haiku 4.5, Claude Sonnet 4.6, Claude Opus 4.6.
- **Share with anyone** — Every custom frog gets a unique share URL. Anyone who opens it can chat with your frog — no wallet required.
- **Persisted locally** — Frogs from share links are saved to localStorage and appear in your selector on future visits.
- **Creator library** — Connect your wallet and all frogs you've forged load automatically into your selector, even from other devices.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 15](https://nextjs.org) (App Router) |
| Language | TypeScript |
| Model | [Gemma 4 26B A4B](https://blog.google/technology/developers-tools/gemma-4/) by Google DeepMind |
| Inference | [Google AI Gemini API](https://ai.google.dev) (cloud, free tier) |
| Custom frog models | OpenAI API / Anthropic API (user-supplied key) |
| Wallet | [RainbowKit](https://rainbowkit.com) + [wagmi](https://wagmi.sh) (Base mainnet) |
| Database | [Supabase](https://supabase.com) (custom frogs, encrypted API keys) |
| Styling | Inline CSS + CSS custom properties |
| Audio | Web Audio API (procedural, no files) |
| Storage | `localStorage` (username, saved frogs) |
| Deployment | [Vercel](https://vercel.com) |

### Why Gemma 4 26B A4B?

Gemma 4 26B A4B is a Mixture-of-Experts model — it has 26B total parameters but only ~4B activate per inference, making it fast and efficient while retaining the depth of a much larger model. It's available on the Gemini API free tier with 1,500 requests per day and no hard token limit, which gives Frognal a generous shared budget for the pond's chaotic multi-frog call patterns.

The previous version ran Gemma 3n E4B entirely in-browser via WebGPU (no servers, no API calls). That's a genuinely cool architecture but required Chrome/Edge 113+, ~2GB GPU memory, a 30-60s model download on first load, and completely broke on any device without WebGPU support. The cloud approach trades that privacy guarantee for universal accessibility and significantly better response quality.

---

## Rate Limiting

Frognal uses a two-layer rate limiting system to protect the shared Gemini API quota:

- **Server-side** — Per-IP rolling window cap (20 RPM). Requests over the limit get a `429` with a `Retry-After` header.
- **Client-side queue** — All one-shot generations (interruptions, debate turns, agreement, silence) are serialised through a queue with a 400ms minimum gap between calls, preventing burst firing.
- **Adaptive budget** — The client tracks requests sent in the last 60 seconds. At 12+/min, interruptions fire at 50% probability. At 18+/min, all optional side-channel generations are skipped and only the main frog reply goes through.

---

## Requirements

- Any modern browser (Chrome, Firefox, Safari, Edge)
- No WebGPU required
- No model download
- Node.js 18+ or [Bun](https://bun.sh) for local development

---

## Running Locally

```bash
# Clone the repo
git clone https://github.com/math77/frognal-webapp.git
cd frognal

# Install dependencies
bun install

# Set up environment variables (see below)
cp .env.example .env.local

# Start the dev server
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

```env
# Gemini API — get a free key at aistudio.google.com/apikey
GEMINI_API_KEY=AIza...

# Supabase — required for custom frogs
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# API key encryption — generate once, never change
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=<64 hex chars>

# WalletConnect — get a free project ID at cloud.walletconnect.com
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<your project id>
```

### Supabase Setup

Run this migration once in your Supabase SQL Editor:

```sql
create table public.custom_frogs (
  id              uuid        default gen_random_uuid() primary key,
  created_at      timestamptz default now(),
  creator_address text        not null,
  name            text        not null check (char_length(name) <= 24),
  emoji           text        not null,
  tagline         text        not null check (char_length(tagline) <= 80),
  system_prompt   text        not null check (char_length(system_prompt) <= 2000),
  color           text        not null,
  bg_color        text        not null,
  border_color    text        not null,
  glow_color      text        not null,
  api_provider    text        not null check (api_provider in ('openai', 'anthropic')),
  api_key_enc     text        not null,
  model_id        text        not null
);

alter table public.custom_frogs enable row level security;

create policy "public read"
  on public.custom_frogs for select using (true);
```

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── frogs/
│   │   │   └── route.ts         # Custom frog CRUD (Supabase, encrypted keys)
│   │   └── generate/
│   │       └── route.ts         # LLM proxy — Gemini / OpenAI / Anthropic + rate limiting
│   ├── page.tsx                 # Entry point
│   ├── layout.tsx               # RainbowKit + wagmi providers
│   ├── providers.tsx            # Client-side wallet providers
│   └── globals.css              # CSS variables, keyframes, base styles
├── components/
│   ├── FrogChat.tsx             # Main UI — all rendering and orchestration
│   └── CustomFrogCreator.tsx    # Frog Forge modal
├── hooks/
│   ├── useLLM.ts                # Streaming LLM hook (request queue + budget)
│   └── useWallet.ts             # RainbowKit wallet state + $FROGNAL balance
└── lib/
    ├── frogs.ts                 # Frog configs, personas, seed histories, rare events
    ├── customFrog.ts            # Custom frog types, color presets, model options, factory
    ├── featureFlags.ts          # Toggle paid/experimental features
    ├── apiKeyCrypto.ts          # AES-256-GCM encrypt/decrypt for stored API keys
    ├── supabaseServer.ts        # Server-side Supabase admin client
    ├── rateLimiter.ts           # Per-IP rolling window rate limiter
    ├── requestQueue.ts          # Client-side queue + adaptive budget tracker
    ├── interruptionEngine.ts    # Interruption logic, debate, agreement, image prompts
    ├── pondMemory.ts            # Session memory, moods, reputation, context builders
    ├── promptTypes.ts           # Shared prompt type definitions
    ├── gemmaPrompt.ts           # Chat history formatting
    ├── typingBuffer.ts          # Per-frog typing speed simulation (with thinking delay)
    ├── soundEngine.ts           # UI sound effects (Web Audio)
    └── ambientEngine.ts         # Procedural pond ambient soundscape
```

---

## $FROGNAL

$FROGNAL is the pond's native token on Base. Holding 50,000+ $FROGNAL unlocks the Frog Forge — the custom frog creator. The balance is read directly from the Base mainnet ERC-20 contract; no bridging or staking required.

**Token address:** `0xE7e6C75C662798d1Dfaffa280c62C25ed7a93b07`

🔗 [View on Clanker](https://clanker.world/clanker/0xE7e6C75C662798d1Dfaffa280c62C25ed7a93b07)

---

## Notes

- **Privacy:** Messages are sent to the Gemini API (Google). Custom frogs use the model provider chosen by the creator (OpenAI or Anthropic). Creator API keys are AES-256-GCM encrypted before storage and are never returned to the client.
- **Custom frog API costs:** When someone chats with your custom frog, it consumes your API key's quota. Keep this in mind before sharing links widely.
- **Rate limits:** The Gemini free tier allows 1,500 RPD. The client-side adaptive budget degrades optional features (interruptions, agreements) before hitting hard limits.
- **Mobile:** Works in mobile browsers. No WebGPU or GPU memory requirements.

---

## License

MIT