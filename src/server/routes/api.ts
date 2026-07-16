import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import type {
  DailyState,
  ErrorResponse,
  FinishRunRequest,
  FinishRunResponse,
  InitResponse,
  LeaderboardEntry,
  MutatorOption,
  MutatorOptionId,
  MutatorVoteTally,
  PlayerProfile,
  StartRunResponse,
  VoteMutatorRequest,
  VoteMutatorResponse,
} from '../../shared/api';

export const api = new Hono();

const BASE_TIME_LIMIT_SECONDS = 45;
const MAX_RUNS_PER_DAY = 3;
const MAX_SCORE = 20000;
const MAX_MISTAKES = 50;
const MAX_NODES = 20;
const LEADERBOARD_SIZE = 10;

type PlayerState = {
  username: string;
  bestScore: number;
  totalRuns: number;
  streak: number;
  lastPlayedDay: string | null;
};

type RunState = {
  runId: string;
  dayKey: string;
  username: string;
  mutatorId: MutatorOptionId;
  startedAt: string;
  consumed: boolean;
};

const mutatorOptions: MutatorOption[] = [
  {
    id: 'pulse-rush',
    title: 'Pulse Rush',
    description: 'Hazards move faster, but every clean node chain earns bonus score.',
    scoreMultiplier: 1.2,
    timeBonusSeconds: 0,
    mistakePenalty: 60,
  },
  {
    id: 'safe-step',
    title: 'Safe Step',
    description: 'You get extra time, but each mistake hurts your score more.',
    scoreMultiplier: 1,
    timeBonusSeconds: 10,
    mistakePenalty: 90,
  },
  {
    id: 'double-or-nothing',
    title: 'Double or Nothing',
    description: 'Higher multiplier for perfect paths, but mistakes can tank your run.',
    scoreMultiplier: 1.35,
    timeBonusSeconds: -5,
    mistakePenalty: 120,
  },
  {
    id: 'fog-shift',
    title: 'Fog Shift',
    description: 'Visual noise and moving blockers increase challenge and tension.',
    scoreMultiplier: 1.15,
    timeBonusSeconds: 5,
    mistakePenalty: 80,
  },
];

const mutatorIndex = new Map(mutatorOptions.map((option) => [option.id, option]));

const getDayKey = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getPreviousDayKey = (dayKey: string): string => {
  const parts = dayKey.split('-').map((value) => Number.parseInt(value, 10));
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return getDayKey(date);
};

const seededHash = (input: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash >>> 0);
};

const getPrefix = (postId: string): string => `hookline:${postId}`;

const getPlayerKey = (prefix: string, username: string): string =>
  `${prefix}:player:${username}`;

const getRunKey = (prefix: string, username: string, runId: string): string =>
  `${prefix}:run:${username}:${runId}`;

const getDailyPlaysKey = (prefix: string, dayKey: string, username: string): string =>
  `${prefix}:day:${dayKey}:plays:${username}`;

const getDailyBoardKey = (prefix: string, dayKey: string): string =>
  `${prefix}:day:${dayKey}:leaderboard`;

const getDailyVotesKey = (prefix: string, dayKey: string): string =>
  `${prefix}:day:${dayKey}:votes`;

const getDailyVoteByUserKey = (
  prefix: string,
  dayKey: string,
  username: string
): string => `${prefix}:day:${dayKey}:vote:${username}`;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const isMutatorOptionId = (value: unknown): value is MutatorOptionId => {
  if (typeof value !== 'string') {
    return false;
  }

  return mutatorOptions.some((option) => option.id === value);
};

const getMutatorById = (optionId: MutatorOptionId): MutatorOption => {
  const option = mutatorIndex.get(optionId);
  if (!option) {
    return {
      id: 'safe-step',
      title: 'Safe Step',
      description: 'You get extra time, but each mistake hurts your score more.',
      scoreMultiplier: 1,
      timeBonusSeconds: 10,
      mistakePenalty: 90,
    };
  }
  return option;
};

const parseJson = <T>(raw: string | null, fallback: T): T => {
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as unknown as T;
  } catch {
    return fallback;
  }
};

const getTodayPlays = async (
  prefix: string,
  dayKey: string,
  username: string
): Promise<number> => {
  const raw = await redis.get(getDailyPlaysKey(prefix, dayKey, username));
  if (!raw) {
    return 0;
  }

  const count = Number.parseInt(raw, 10);
  if (!Number.isFinite(count)) {
    return 0;
  }
  return clamp(count, 0, MAX_RUNS_PER_DAY);
};

const getPlayerState = async (prefix: string, username: string): Promise<PlayerState> => {
  const fallback: PlayerState = {
    username,
    bestScore: 0,
    totalRuns: 0,
    streak: 0,
    lastPlayedDay: null,
  };

  const raw = await redis.get(getPlayerKey(prefix, username));
  const parsed = parseJson<PlayerState>(raw ?? null, fallback);
  if (parsed.username !== username) {
    return fallback;
  }

  return {
    username,
    bestScore: clamp(parsed.bestScore, 0, MAX_SCORE),
    totalRuns: clamp(parsed.totalRuns, 0, 100000),
    streak: clamp(parsed.streak, 0, 100000),
    lastPlayedDay:
      typeof parsed.lastPlayedDay === 'string' ? parsed.lastPlayedDay : null,
  };
};

const savePlayerState = async (prefix: string, state: PlayerState): Promise<void> => {
  await redis.set(getPlayerKey(prefix, state.username), JSON.stringify(state));
};

const getVotes = async (prefix: string, dayKey: string): Promise<MutatorVoteTally> => {
  const fallback: MutatorVoteTally = {
    'pulse-rush': 0,
    'safe-step': 0,
    'double-or-nothing': 0,
    'fog-shift': 0,
  };

  const raw = await redis.get(getDailyVotesKey(prefix, dayKey));
  const parsed = parseJson<MutatorVoteTally>(raw ?? null, fallback);

  return {
    'pulse-rush': clamp(parsed['pulse-rush'] ?? 0, 0, 1000000),
    'safe-step': clamp(parsed['safe-step'] ?? 0, 0, 1000000),
    'double-or-nothing': clamp(parsed['double-or-nothing'] ?? 0, 0, 1000000),
    'fog-shift': clamp(parsed['fog-shift'] ?? 0, 0, 1000000),
  };
};

const resolveActiveMutator = async (
  prefix: string,
  dayKey: string,
  seed: number
): Promise<MutatorOption> => {
  const previousDayKey = getPreviousDayKey(dayKey);
  const previousVotes = await getVotes(prefix, previousDayKey);

  const ordered = Object.entries(previousVotes).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });

  const hasVotes = ordered.some((entry) => entry[1] > 0);
  if (hasVotes) {
    const winner = ordered[0]?.[0];
    if (isMutatorOptionId(winner)) {
      return getMutatorById(winner);
    }
  }

  return mutatorOptions[seed % mutatorOptions.length] ?? mutatorOptions[0] ?? getMutatorById('safe-step');
};

const getDailyState = async (prefix: string, dayKey: string): Promise<DailyState> => {
  const seed = seededHash(`${prefix}:${dayKey}`);
  const mutator = await resolveActiveMutator(prefix, dayKey, seed);

  return {
    dayKey,
    seed,
    timeLimitSeconds: BASE_TIME_LIMIT_SECONDS + mutator.timeBonusSeconds,
    mutator,
  };
};

const getLeaderboard = async (
  prefix: string,
  dayKey: string
): Promise<LeaderboardEntry[]> => {
  const raw = await redis.get(getDailyBoardKey(prefix, dayKey));
  const parsed = parseJson<LeaderboardEntry[]>(raw ?? null, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.slice(0, LEADERBOARD_SIZE);
};

const saveLeaderboard = async (
  prefix: string,
  dayKey: string,
  entries: LeaderboardEntry[]
): Promise<void> => {
  await redis.set(getDailyBoardKey(prefix, dayKey), JSON.stringify(entries));
};

const upsertLeaderboard = (
  entries: LeaderboardEntry[],
  nextEntry: LeaderboardEntry
): { entries: LeaderboardEntry[]; rank: number } => {
  const filtered = entries.filter((entry) => entry.username !== nextEntry.username);
  filtered.push(nextEntry);
  filtered.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.playedAt.localeCompare(right.playedAt);
  });

  const limited = filtered.slice(0, LEADERBOARD_SIZE);
  const rank = limited.findIndex((entry) => entry.username === nextEntry.username) + 1;
  return {
    entries: limited,
    rank: rank > 0 ? rank : LEADERBOARD_SIZE + 1,
  };
};

const buildPlayerProfile = (
  username: string,
  player: PlayerState,
  todayPlayed: number,
  voteOptionId: MutatorOptionId | null
): PlayerProfile => ({
  username,
  streak: player.streak,
  bestScore: player.bestScore,
  totalRuns: player.totalRuns,
  todayPlayed,
  runsLeft: clamp(MAX_RUNS_PER_DAY - todayPlayed, 0, MAX_RUNS_PER_DAY),
  voteOptionId,
});

api.get('/init', async (c) => {
  const { postId } = context;

  if (!postId) {
    console.error('API Init Error: postId not found in devvit context');
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required but missing from context',
      },
      400
    );
  }

  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const prefix = getPrefix(postId);
    const dayKey = getDayKey(new Date());

    const [player, todayPlayed, daily, leaderboard, voteRaw] = await Promise.all([
      getPlayerState(prefix, username),
      getTodayPlays(prefix, dayKey, username),
      getDailyState(prefix, dayKey),
      getLeaderboard(prefix, dayKey),
      redis.get(getDailyVoteByUserKey(prefix, dayKey, username)),
    ]);

    const voteOptionId = isMutatorOptionId(voteRaw) ? voteRaw : null;

    return c.json<InitResponse>({
      type: 'init',
      postId,
      player: buildPlayerProfile(username, player, todayPlayed, voteOptionId),
      daily,
      leaderboard,
      mutatorOptions,
    });
  } catch (error) {
    console.error(`API Init Error for post ${postId}:`, error);
    let errorMessage = 'Unknown error during initialization';
    if (error instanceof Error) {
      errorMessage = `Initialization failed: ${error.message}`;
    }
    return c.json<ErrorResponse>(
      { status: 'error', message: errorMessage },
      400
    );
  }
});

api.post('/start-run', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required',
      },
      400
    );
  }

  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const prefix = getPrefix(postId);
    const dayKey = getDayKey(new Date());

    const [todayPlayed, daily] = await Promise.all([
      getTodayPlays(prefix, dayKey, username),
      getDailyState(prefix, dayKey),
    ]);

    if (todayPlayed >= MAX_RUNS_PER_DAY) {
      return c.json<ErrorResponse>(
        {
          status: 'error',
          message: 'Daily run cap reached. Come back tomorrow for a fresh board.',
        },
        429
      );
    }

    const runId = `${Date.now()}-${seededHash(`${username}:${Math.random()}`)}`;
    const startedAt = new Date().toISOString();
    const runState: RunState = {
      runId,
      dayKey,
      username,
      mutatorId: daily.mutator.id,
      startedAt,
      consumed: false,
    };
    await redis.set(getRunKey(prefix, username, runId), JSON.stringify(runState));

    return c.json<StartRunResponse>({
      type: 'start-run',
      runId,
      startedAt,
      daily,
    });
  } catch (error) {
    console.error('Failed to start run', error);
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'Unable to start run right now',
      },
      500
    );
  }
});

api.post('/finish-run', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required',
      },
      400
    );
  }

  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const payload = await c.req.json<FinishRunRequest>();
    const prefix = getPrefix(postId);
    const dayKey = getDayKey(new Date());

    if (!payload.runId || typeof payload.runId !== 'string') {
      return c.json<ErrorResponse>(
        {
          status: 'error',
          message: 'runId is required',
        },
        400
      );
    }

    const [runRaw, todayPlayed] = await Promise.all([
      redis.get(getRunKey(prefix, username, payload.runId)),
      getTodayPlays(prefix, dayKey, username),
    ]);

    if (!runRaw) {
      return c.json<ErrorResponse>(
        {
          status: 'error',
          message: 'Run not found or expired',
        },
        404
      );
    }

    const runState = parseJson<RunState>(runRaw, {
      runId: payload.runId,
      dayKey,
      username,
      mutatorId: 'safe-step',
      startedAt: new Date().toISOString(),
      consumed: true,
    });

    if (runState.username !== username || runState.dayKey !== dayKey) {
      return c.json<ErrorResponse>(
        {
          status: 'error',
          message: 'Run is not valid for this player or day',
        },
        400
      );
    }

    if (runState.consumed) {
      return c.json<FinishRunResponse>(
        {
          type: 'finish-run',
          accepted: false,
          finalScore: 0,
          bestScore: 0,
          streak: 0,
          rank: 0,
          todayPlayed,
          runsLeft: clamp(MAX_RUNS_PER_DAY - todayPlayed, 0, MAX_RUNS_PER_DAY),
          message: 'This run was already submitted.',
        },
        200
      );
    }

    if (todayPlayed >= MAX_RUNS_PER_DAY) {
      return c.json<FinishRunResponse>(
        {
          type: 'finish-run',
          accepted: false,
          finalScore: 0,
          bestScore: 0,
          streak: 0,
          rank: 0,
          todayPlayed,
          runsLeft: 0,
          message: 'Daily run cap reached before this run could be accepted.',
        },
        200
      );
    }

    const mutator = getMutatorById(runState.mutatorId);
    const rawScore = clamp(Math.floor(payload.rawScore), 0, MAX_SCORE);
    const mistakes = clamp(Math.floor(payload.mistakes), 0, MAX_MISTAKES);
    const completedNodes = clamp(Math.floor(payload.completedNodes), 0, MAX_NODES);
    const totalNodes = clamp(Math.floor(payload.totalNodes), 1, MAX_NODES);
    const timeLeftMs = clamp(Math.floor(payload.timeLeftMs), 0, 120000);

    const completionRatio = completedNodes / totalNodes;
    const finalScore = clamp(
      Math.floor(
        rawScore * mutator.scoreMultiplier +
          completionRatio * 450 +
          timeLeftMs / 25 -
          mistakes * mutator.mistakePenalty
      ),
      0,
      MAX_SCORE
    );

    const [player, leaderboard] = await Promise.all([
      getPlayerState(prefix, username),
      getLeaderboard(prefix, dayKey),
    ]);

    const nextPlayed = todayPlayed + 1;
    const previousDay = getPreviousDayKey(dayKey);
    const isConsecutive = player.lastPlayedDay === previousDay;
    const alreadyPlayedToday = player.lastPlayedDay === dayKey;

    const nextStreak = alreadyPlayedToday
      ? player.streak
      : isConsecutive
        ? player.streak + 1
        : 1;

    const updatedPlayer: PlayerState = {
      ...player,
      bestScore: Math.max(player.bestScore, finalScore),
      totalRuns: player.totalRuns + 1,
      streak: nextStreak,
      lastPlayedDay: dayKey,
    };

    const leaderboardEntry: LeaderboardEntry = {
      username,
      score: finalScore,
      streak: updatedPlayer.streak,
      playedAt: new Date().toISOString(),
    };
    const nextLeaderboard = upsertLeaderboard(leaderboard, leaderboardEntry);

    runState.consumed = true;

    await Promise.all([
      savePlayerState(prefix, updatedPlayer),
      redis.set(getDailyPlaysKey(prefix, dayKey, username), String(nextPlayed)),
      redis.set(getRunKey(prefix, username, payload.runId), JSON.stringify(runState)),
      saveLeaderboard(prefix, dayKey, nextLeaderboard.entries),
    ]);

    return c.json<FinishRunResponse>({
      type: 'finish-run',
      accepted: true,
      finalScore,
      bestScore: updatedPlayer.bestScore,
      streak: updatedPlayer.streak,
      rank: nextLeaderboard.rank,
      todayPlayed: nextPlayed,
      runsLeft: clamp(MAX_RUNS_PER_DAY - nextPlayed, 0, MAX_RUNS_PER_DAY),
      message:
        nextLeaderboard.rank <= LEADERBOARD_SIZE
          ? `Run accepted. You are #${nextLeaderboard.rank} on today's board.`
          : 'Run accepted. Keep pushing to reach today\'s top board.',
    });
  } catch (error) {
    console.error('finish-run failed', error);
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'Unable to submit this run',
      },
      500
    );
  }
});

api.post('/vote-mutator', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required',
      },
      400
    );
  }

  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const body = await c.req.json<VoteMutatorRequest>();

    if (!isMutatorOptionId(body.optionId)) {
      return c.json<ErrorResponse>(
        {
          status: 'error',
          message: 'Invalid mutator option',
        },
        400
      );
    }

    const prefix = getPrefix(postId);
    const dayKey = getDayKey(new Date());
    const voteKey = getDailyVoteByUserKey(prefix, dayKey, username);

    const [votes, existingVote] = await Promise.all([
      getVotes(prefix, dayKey),
      redis.get(voteKey),
    ]);

    if (isMutatorOptionId(existingVote)) {
      votes[existingVote] = clamp(votes[existingVote] - 1, 0, 1000000);
    }
    votes[body.optionId] += 1;

    await Promise.all([
      redis.set(voteKey, body.optionId),
      redis.set(getDailyVotesKey(prefix, dayKey), JSON.stringify(votes)),
    ]);

    return c.json<VoteMutatorResponse>({
      type: 'vote-mutator',
      optionId: body.optionId,
      tally: votes,
    });
  } catch (error) {
    console.error('vote-mutator failed', error);
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'Unable to submit vote right now',
      },
      500
    );
  }
});
