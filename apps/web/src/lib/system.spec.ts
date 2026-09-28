import { describe, expect, it } from 'vitest';
import { WATCHDOG_LEVELS } from '@fmip/contracts';
import {
  LEVEL_TONE,
  LEVEL_WORDS,
  ago,
  channelLine,
  conditionName,
  formatDuration,
  formatMeasure,
  freshnessSentence,
  hourlySeries,
  sparkBars,
} from './system';

const SINCE = '2026-09-28T00:00:00.000Z';

describe('hourlySeries', () => {
  it('puts each bucket in its hour and an absent hour at zero', () => {
    const series = hourlySeries(
      [
        { hour: '2026-09-28T02:00:00.000Z', count: 3 },
        { hour: '2026-09-28T23:00:00.000Z', count: 1 },
      ],
      SINCE,
      24,
    );
    expect(series).toHaveLength(24);
    expect(series[2]).toBe(3);
    expect(series[23]).toBe(1);
    expect(series.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('drops a bucket outside the window rather than stretching it', () => {
    expect(
      hourlySeries([{ hour: '2026-09-27T23:00:00.000Z', count: 9 }], SINCE, 24).every(
        (n) => n === 0,
      ),
    ).toBe(true);
    expect(hourlySeries([], 'not a time', 3)).toEqual([0, 0, 0]);
  });

  it('holds a week of hours', () => {
    expect(hourlySeries([], SINCE, 168)).toHaveLength(168);
  });
});

describe('sparkBars', () => {
  it('draws nothing for a quiet window, never a flat line that looks like data', () => {
    expect(sparkBars([0, 0, 0], 120, 20)).toEqual([]);
  });

  it('scales the busiest hour to the full height and keeps the order of time', () => {
    const bars = sparkBars([1, 0, 4, 0], 120, 20);
    expect(bars.map((b) => b.count)).toEqual([1, 4]);
    expect(bars[1]).toMatchObject({ y: 0, height: 20, x: 60 });
    expect(bars[0]).toMatchObject({ height: 5, x: 0 });
  });

  it('runs time the other way in a right-to-left locale', () => {
    const bars = sparkBars([1, 0, 0, 4], 120, 20, 'rtl');
    // The oldest hour at the inline end (the right), the newest on the left.
    expect(bars.find((b) => b.count === 1)?.x).toBe(90);
    expect(bars.find((b) => b.count === 4)?.x).toBe(0);
  });
});

describe('the words', () => {
  it('says every level, and unknown is never read as fine', () => {
    for (const level of WATCHDOG_LEVELS) {
      expect(LEVEL_WORDS[level]).toBeTruthy();
      expect(LEVEL_TONE[level]).toMatch(/^text-/);
    }
    expect(LEVEL_WORDS.unknown).not.toMatch(/ok/i);
  });

  it('formats a measure in its unit', () => {
    expect(formatMeasure(null, 'seconds')).toBe('nothing measured');
    expect(formatMeasure(960, 'seconds')).toBe('16 min');
    expect(formatMeasure(82.4, 'percent')).toBe('82 %');
    expect(formatMeasure(3, 'count')).toBe('3');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(3 * 3600 + 300)).toBe('3 h 5 min');
    expect(formatDuration(50 * 3600)).toBe('2 d 2 h');
  });

  it('measures age against the report clock', () => {
    expect(ago('2026-09-28T11:40:00Z', '2026-09-28T12:00:00Z')).toBe('20 min ago');
  });

  it('names the conditions, and falls back to the key for a new one', () => {
    expect(conditionName('ingest:live')).toBe('Ingestion: live job');
    expect(conditionName('jobs:news')).toBe('Failed jobs: news queue');
    expect(conditionName('data_quality')).toBe('Live match data contradicting itself');
    expect(conditionName('backup')).toBe('Backup');
    expect(conditionName('elo_source')).toBe("Club Elo (the model's long-term ratings)");
    expect(conditionName('restore_drill')).toBe('Restore drill (monthly)');
    expect(conditionName('something_new')).toBe('something_new');
  });

  it('says a stopped or absent watchdog plainly (rule 4)', () => {
    const now = '2026-09-28T12:00:00Z';
    expect(freshnessSentence('current', now, now)).toBeNull();
    expect(freshnessSentence('never_run', null, now)).toMatch(/never run/);
    expect(freshnessSentence('stale', '2026-09-28T11:50:00Z', now)).toMatch(
      /10 min ago: it has stopped, and the levels below are the last known/,
    );
  });

  it('never counts a send on a channel that does not exist', () => {
    const none = { sent: 0, failed: 0, skipped: 0, absent: 0, pending: 2 };
    expect(channelLine('absent', none)).toBe('not configured on this deployment');
    expect(channelLine('configured', { ...none, pending: 0, sent: 1, skipped: 1 })).toBe(
      '1 sent, 1 with no device or address',
    );
    expect(channelLine('configured', { ...none, pending: 0 })).toBe('nothing to carry');
    expect(channelLine('configured', { ...none, failed: 1 })).toBe('1 failed, 2 not carried yet');
  });
});
