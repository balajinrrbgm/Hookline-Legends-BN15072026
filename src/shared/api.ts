export type MutatorOptionId =
  | 'pulse-rush'
  | 'safe-step'
  | 'double-or-nothing'
  | 'fog-shift';

export type MutatorOption = {
  id: MutatorOptionId;
  title: string;
  description: string;
  scoreMultiplier: number;
  timeBonusSeconds: number;
  mistakePenalty: number;
};

export type MutatorVoteTally = Record<MutatorOptionId, number>;

export type LeaderboardEntry = {
  username: string;
  score: number;
  streak: number;
  playedAt: string;
};

export type PlayerProfile = {
  username: string;
  streak: number;
  bestScore: number;
  totalRuns: number;
  todayPlayed: number;
  runsLeft: number;
  voteOptionId: MutatorOptionId | null;
};

export type DailyState = {
  dayKey: string;
  seed: number;
  timeLimitSeconds: number;
  mutator: MutatorOption;
};

export type InitResponse = {
  type: 'init';
  postId: string;
  player: PlayerProfile;
  daily: DailyState;
  leaderboard: LeaderboardEntry[];
  mutatorOptions: MutatorOption[];
};

export type StartRunResponse = {
  type: 'start-run';
  runId: string;
  startedAt: string;
  daily: DailyState;
};

export type FinishRunRequest = {
  runId: string;
  rawScore: number;
  mistakes: number;
  completedNodes: number;
  totalNodes: number;
  timeLeftMs: number;
};

export type FinishRunResponse = {
  type: 'finish-run';
  accepted: boolean;
  finalScore: number;
  bestScore: number;
  streak: number;
  rank: number;
  todayPlayed: number;
  runsLeft: number;
  message: string;
};

export type VoteMutatorRequest = {
  optionId: MutatorOptionId;
};

export type VoteMutatorResponse = {
  type: 'vote-mutator';
  optionId: MutatorOptionId;
  tally: MutatorVoteTally;
};

export type ErrorResponse = {
  status: 'error';
  message: string;
};
