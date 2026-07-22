# Ava v0.3 rollout

## 1. Database

Run `supabase/migrations/007_ava_async_companion.sql` in the Supabase SQL editor before deploying the new server.

## 2. Zeabur environment

Add these variables to the server service:

```text
AVA_FEATURE_ENABLED=true
AVA_BETA_USER_IDS=<comma-separated Supabase user UUIDs>
AVA_DAILY_LIMIT=30
OPENAI_LIFE_MODEL=gpt-5.4-mini
COMPANION_WORKER_SECRET=<a long random value>
```

Leave `AVA_BETA_USER_IDS` empty only when Ava should be available to every authenticated account.

## 3. Worker schedule

Create a Supabase Cron job that runs once per minute and sends an HTTP `POST` request to:

```text
https://softplace.zeabur.app/internal/companion/tick
```

Include this header:

```text
x-companion-worker-secret: <COMPANION_WORKER_SECRET>
```

The endpoint claims due jobs atomically. Calling it more than once does not generate the same leased job twice.

## 4. Android push completion

The server, database, push-token API, and Expo push sender are implemented. The mobile registration step needs npm registry access and an EAS project:

```bash
cd apps/mobile
npx expo install expo-notifications expo-device expo-constants expo-dev-client
npx eas-cli@latest init
```

Then add the `expo-notifications` config plugin, register the Expo push token after login, and build the `development` profile from `apps/mobile/eas.json`. Until this step is complete, Ava messages still arrive through the in-app 12-second polling loop.

## 5. Smoke test

1. Open Ava and send a message while the status says `有空`.
2. Confirm the user message appears immediately and `Ava 晚點回你` is shown.
3. Trigger the worker after `due_at`, then wait up to 12 seconds in the Ava tab.
4. Confirm the assistant message appears and daily usage increases by one.
5. Test `在忙`, quiet hours, proactive `off/low/normal`, memory edit/delete, relationship deletion, and a crisis phrase.
