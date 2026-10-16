import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractAction } from '../activityExtractor';

const projectsDir = path.join(os.homedir(), '.claude', 'projects');

/** The .jsonl files directly in a project dir; none for a plain file or an unreadable entry. */
function transcriptsIn(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.jsonl'))
      .map((file) => path.join(dir, file));
  } catch {
    return []; // ENOTDIR, EACCES, a dangling link: skip it
  }
}

function someTranscripts(limit: number): string[] {
  let dirs: string[];
  try {
    dirs = fs.readdirSync(projectsDir);
  } catch {
    return []; // no ~/.claude/projects here (CI) or unreadable: the test skips
  }
  const found: string[] = [];
  for (const dir of dirs) {
    found.push(...transcriptsIn(path.join(projectsDir, dir)));
    if (found.length >= limit) {
      return found.slice(0, limit);
    }
  }
  return found;
}

describe('extractAction against real transcripts', () => {
  const transcripts = someTranscripts(5);

  it.skipIf(transcripts.length === 0)(
    'never throws and never leaks a raw tool id',
    () => {
      let rendered = 0;
      for (const transcript of transcripts) {
        for (const line of fs.readFileSync(transcript, 'utf8').split('\n')) {
          if (!line.trim()) {
            continue;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          expect(() => extractAction(parsed)).not.toThrow();
          const result = extractAction(parsed);
          if (result) {
            rendered++;
            expect(result).not.toMatch(/^toolu_/);
            expect(result.length).toBeLessThan(80);
          }
        }
      }
      expect(rendered).toBeGreaterThan(0);
      // Reads whole real transcripts (one can be ~10 MB); the 5 s default flakes under parallel suites.
    },
    30_000,
  );
});
