import { navigateTo, context, requestExpandedMode } from '@devvit/web/client';
import type { InitResponse } from '../shared/api';

const docsLink = document.getElementById('docs-link') as HTMLDivElement;
const playtestLink = document.getElementById('playtest-link') as HTMLDivElement;
const discordLink = document.getElementById('discord-link') as HTMLDivElement;
const startButton = document.getElementById('start-button') as HTMLButtonElement;
const titleElement = document.getElementById('title') as HTMLHeadingElement;
const dailyBrief = document.getElementById('daily-brief') as HTMLParagraphElement;
const statStreak = document.getElementById('stat-streak') as HTMLSpanElement;
const statRuns = document.getElementById('stat-runs') as HTMLSpanElement;
const statBest = document.getElementById('stat-best') as HTMLSpanElement;
const boardPreview = document.getElementById('board-preview') as HTMLDivElement;
const mutatorText = document.getElementById('mutator-text') as HTMLParagraphElement;

startButton.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});

docsLink.addEventListener('click', () => {
  navigateTo('https://developers.reddit.com/docs/introduction/intro-games');
});

playtestLink.addEventListener('click', () => {
  navigateTo('https://www.reddit.com/r/GamesOnReddit/');
});

discordLink.addEventListener('click', () => {
  navigateTo('https://discord.gg/ZJQ3fmQVrm');
});

async function init() {
  titleElement.textContent = `Hookline Legends, ${context.username ?? 'player'}`;

  try {
    const response = await fetch('/api/init');
    if (!response.ok) {
      throw new Error(`init failed (${response.status})`);
    }

    const data = (await response.json()) as InitResponse;
    statStreak.textContent = `${data.player.streak}`;
    statRuns.textContent = `${data.player.runsLeft}`;
    statBest.textContent = `${data.player.bestScore}`;

    dailyBrief.textContent = `Today you have ${data.daily.timeLimitSeconds}s to complete the route before hazards block nodes.`;
    mutatorText.textContent = `Active mutator: ${data.daily.mutator.title} - ${data.daily.mutator.description}`;

    if (data.leaderboard.length === 0) {
      boardPreview.textContent = 'Leaderboard\\nNo completions yet today. Claim the first crown.';
    } else {
      const rows = data.leaderboard
        .slice(0, 3)
        .map((entry, index) => `${index + 1}. u/${entry.username} • ${entry.score}`)
        .join('\\n');
      boardPreview.textContent = `Leaderboard\\n${rows}`;
    }
  } catch (error) {
    console.error(error);
    boardPreview.textContent = 'Could not load daily data. Open arena to retry.';
    mutatorText.textContent = 'Daily mutator loading failed.';
  }
}

void init();
