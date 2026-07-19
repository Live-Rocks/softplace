# SoftPlace v0.2

SoftPlace is a private 18+ AI emotional companionship beta. It is a temporary emotional holding space, not psychotherapy, diagnosis, an AI romantic partner, adult chat, or a public community.

## Implemented

- Expo React Native + TypeScript mobile app.
- Node.js + Express API server.
- Supabase Email/password Auth and Postgres persistence.
- One continuous conversation per user with cursor-paginated history.
- OpenAI Responses API with `store: false` and a hashed `safety_identifier`.
- Light mode defaults to `gpt-4o-mini`; the persistent deep-mode switch uses `gpt-5.4-mini`.
- User-confirmed memories, image input, usage limits, provider transparency, and crisis mode.
- The model receives only the most recent 20 messages plus confirmed memories.
- Reply length adapts by mode: concise but complete in light mode, with more room to explore in deep mode.
- Image replies identify concrete visible details first, then connect them back to the user's experience.

## Setup

Requires Node.js 20 or newer.

```bash
npm install
cp apps/server/.env.example apps/server/.env
cp apps/mobile/.env.example apps/mobile/.env
```

Create a Supabase project and run every SQL migration in order:

```text
supabase/migrations/001_softplace_mvp.sql
supabase/migrations/002_single_conversation.sql
supabase/migrations/003_remove_image_usage.sql
supabase/migrations/004_expand_memory_content.sql
```

Set the server environment:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_DEEP_MODEL=gpt-5.4-mini
OPENAI_LIGHT_MODEL=gpt-4o-mini
OPENAI_STORE_RESPONSES=false
OPENAI_DEBUG_IO=false
```

Set the mobile environment. Use the Mac's LAN IP instead of `localhost` when testing on a physical phone:

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:8787
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

The service-role key and OpenAI key must never be placed in the mobile environment.

## Run

```bash
npm run dev:server
npm run dev:mobile
```

For an explicit no-cost local reply mode, set `AI_PROVIDER=local`. Missing OpenAI credentials never silently fall back to local replies.

## Production Server

The production server commands used by Zeabur are:

```bash
npm run build:server
npm run start:server
```

Zeabur reads `zbpack.json` from the repository root, injects `PORT`, and starts only the Express API from this monorepo. Keep all server secrets in Zeabur environment variables rather than committed `.env` files. The health endpoint is `GET /health`.

The current staging API is available at `https://softplace.zeabur.app`; verify a deployment with `GET https://softplace.zeabur.app/health`.

## Safety And Privacy

- Crisis language is intercepted before any model request and points Taiwan users to `1925`, `119`, and `110`.
- Images are processed but not permanently stored; only `image_present` is saved.
- Memories are limited to `preference` and `emotional_context`, require confirmation, and remain editable and deletable.
- Sensitive identifiers, diagnoses, negative personality labels, and self-harm details are rejected as memories.
- Automatic summaries, embeddings, vector stores, and RAG are intentionally out of scope for v0.2.

## Verification

```bash
npm run typecheck
npm test
```

Tests cover requested light/deep modes, quota fallback, image limits, crisis detection, memory filtering, 20-message context, provider reporting, and failed-provider requests not consuming quota.
