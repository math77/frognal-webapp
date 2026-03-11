# 🐸 FROGNAL

**A chaotic, personality-driven AI chat experience that runs entirely in your browser — no servers, no API calls, no data leaving your device.**

Frognal drops you into a pond with six (and a secret seventh) distinct frog personas, each powered by Google's Gemma 3n E4B model running locally via WebGPU. The frogs interrupt each other, start spontaneous debates, react to images you drop into the pond, develop opinions of you over time, and occasionally do things you didn't ask for.

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

---

## Features

- **On-device inference** — Gemma 3n E4B runs fully in your browser via WebGPU. No API keys, no server, no usage costs.
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

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 14](https://nextjs.org) (App Router) |
| Language | TypeScript |
| Model | [Gemma 3n E4B](https://ai.google.dev/gemma) by Google DeepMind |
| Inference | [MediaPipe LLM Inference API](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference) (WebGPU) |
| Model hosting | Cloudflare R2 |
| Styling | Inline CSS + CSS custom properties |
| Audio | Web Audio API (procedural, no files) |
| Storage | `localStorage` (username persistence only) |
| Deployment | [Vercel](https://vercel.com) |

### Why Gemma 3n E4B?

Gemma 3n uses a novel **per-layer embedding (PLE)** architecture that allows the 4B-parameter model to run efficiently on consumer hardware. The E4B variant is optimised for edge deployment — it supports text, image, and audio inputs and fits comfortably within browser WebGPU memory limits. First load downloads the model (~1.5GB); subsequent visits load from browser cache.

Also because I am currently poor and cannot pay for AI APIs

---

## Requirements

- A browser with **WebGPU support** (Chrome 113+, Edge 113+)
- ~2GB of available GPU/shared memory
- Node.js 18+ or [Bun](https://bun.sh)

> Firefox and Safari do not currently support WebGPU and will not work.

---

## Running Locally

```bash
# Clone the repo
git clone https://github.com/math77/frognal-webapp.git
cd frognal

# Install dependencies
bun install
# or: npm install

# Start the dev server
bun dev
# or: npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On first load the model downloads from Cloudflare R2 (~1.5GB). This takes 15–60 seconds depending on your connection. Subsequent loads are instant from browser cache.

### Environment

No `.env` file needed for local development. The model URL is configured in `src/hooks/useLLM.ts`.

If you want to self-host the model, upload the `.bin` file to any static host (R2, S3, etc.) and update the `MODEL_PATH` constant.

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx           # Entry point
│   └── globals.css        # CSS variables, keyframes, base styles
├── components/
│   └── FrogChat.tsx       # Main UI — all rendering and orchestration
├── hooks/
│   └── useLLM.ts          # MediaPipe WebGPU inference hook
└── lib/
    ├── frogs.ts            # Frog configs, personas, seed histories, rare events
    ├── gemmaPrompt.ts      # Gemma chat template formatting
    ├── interruptionEngine.ts  # Interruption logic, debate, agreement, image prompts
    ├── pondMemory.ts       # Session memory, moods, reputation, context builders
    ├── typingBuffer.ts     # Per-frog typing speed simulation
    ├── soundEngine.ts      # UI sound effects (Web Audio)
    └── ambientEngine.ts    # Procedural pond ambient soundscape
```

---

## Notes

- **Privacy**: All inference happens on your device. No messages, images, or personal data are ever sent to any server.
- **WebGPU**: The model runs on your GPU via WebGPU. On devices without a discrete GPU it falls back to CPU via XNNPACK (slower but functional — the `INFO: Created TensorFlow Lite XNNPACK delegate for CPU` console message is expected and harmless).
- **Mobile**: Not currently optimised for mobile browsers, most of which don't support WebGPU.

---

## License

MIT