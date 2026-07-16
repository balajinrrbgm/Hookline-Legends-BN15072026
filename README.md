# Hookline Legends

Hookline Legends is a Devvit Web + Phaser daily puzzle game built for the Reddit's Games with a Hook Hackathon.

Players run a time-boxed route challenge each day:

- Complete numbered nodes in sequence.
- Avoid moving hazard waves.
- Spend limited daily attempts wisely.
- Compete on a daily leaderboard.
- Vote the next-day mutator as a community.

This design directly targets the hackathon's retention, community, and polish goals.

## Why this game is "Hook-y"

- Daily board with deterministic seed and rotating mutators.
- Hard run cap (3/day) creates scarcity and return pressure.
- Streak progression rewards repeat behavior.
- Public leaderboard drives social competition.
- Next-day mutator voting lets players influence future gameplay.

## Stack

- Devvit Web
- Phaser 4 (gameplay)
- Hono (server routes)
- Redis via Devvit server SDK (state + leaderboard + votes)
- TypeScript + Vite

## Architecture

See docs/architecture-diagram.md for a full Mermaid diagram.

High-level flow:

1. Inline post (splash) calls /api/init.
2. Expanded game scene calls /api/start-run.
3. Player run telemetry is submitted to /api/finish-run.
4. Backend updates streak, daily play cap, leaderboard.
5. Player vote goes to /api/vote-mutator for next-day rules.

## Project Structure

- src/client/splash.*: Inline feed view (fast summary + CTA)
- src/client/scenes/MainMenu.ts: Lobby with daily state and voting
- src/client/scenes/Game.ts: Phaser route gameplay and run submission
- src/server/routes/api.ts: Game APIs and retention logic
- src/shared/api.ts: Shared request/response types
- docs/: Submission and planning artifacts

## Local Setup

Prerequisites:

- Node.js 22+
- Devvit CLI access + Reddit developer account

Install:

```bash
npm install
```

Validate locally:

```bash
npm run type-check
npm run lint
npm run build
```

Playtest and deploy:

```bash
npm run login
npm run dev
npm run deploy
npm run launch
```

## Core APIs

- GET /api/init
	- Returns player profile, daily seed/mutator, leaderboard, vote state.
- POST /api/start-run
	- Creates a signed run context (runId), enforces daily run cap.
- POST /api/finish-run
	- Validates run, computes final score, updates streak and board.
- POST /api/vote-mutator
	- Records one vote per user per day and updates tally.

## Devvit Compliance Notes

- Built on Devvit Web with /api/* endpoints.
- No external client-side fetches.
- No fs/native package usage.
- Includes a non-template README with setup/usage details.
- Avoids restricted or deceptive mechanics (no gambling/paywall gating).

## Submission Assets

- Phase 1 requirements matrix: docs/phase1-requirements-matrix.md
- Phase 2 concept scoring: docs/phase2-concept-evaluation.md
- Architecture diagram: docs/architecture-diagram.md
- Presentation deck outline: docs/presentation-deck.md
- Demo script: docs/demo-script.md
- Final compliance checklist: docs/final-compliance-checklist.md

## Known Constraints

- The official Devpost page does not publish numeric criterion weights.
- This project uses an internal estimated weighting model for planning only.
- Final review timing is controlled by Reddit app review and Devpost judging windows.
