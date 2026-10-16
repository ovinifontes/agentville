import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractAction } from '../activityExtractor';

const projectsDir = path.join(os.homedir(), '.claude', 'projects');

function someTranscripts(limit: number): string[] {
  if (!fs.existsSync(projectsDir)) {
    return [];
  }
  const found: string[] = [];
  for (const dir of fs.readdirSync(projectsDir)) {
    const full = path.join(projectsDir, dir);
    if (!fs.statSync(full).isDirectory()) {
      continue;
    }
    for (const file of fs.readdirSync(full)) {
      if (file.endsWith('.jsonl')) {
        found.push(path.join(full, file));
      }
      if (found.length >= limit) {
        return found;
      }
    }
  }
  return found;
}

describe('extractAction against real transcripts', () => {
  const transcripts = someTranscripts(5);

  it.skipIf(transcripts.length === 0)('never throws and never leaks a raw tool id', () => {
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
          expect(result).not.toMatch(/^tool_use/);
          expect(result.length).toBeLessThan(80);
        }
      }
    }
    expect(rendered).toBeGreaterThan(0);
  });
});
