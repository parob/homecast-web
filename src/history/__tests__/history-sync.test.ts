// The vendoring contract with homecast-cloud.
//
// profiles.json and policy-cases.json are copied byte-for-byte into
// homecast-cloud/server/homecast/history/, and BOTH repos pin the same
// hashes (there: tests/test_history_policy.py). Changing either file here
// without re-vendoring + updating the hash in both places fails one CI or
// the other — which is the point: the two policy engines must never drift.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Keep in step with homecast-cloud/server/tests/test_history_policy.py
const PROFILES_SHA256 = '3568030cc6ed2440acf8be6faaaaaaa29a74dcde6078169aecf8bb0429548b70';
const CASES_SHA256 = '48cef8539447a2e21a4f645192f454624ef06b29b98bf13d1b5943303590ee47';

const sha256 = (rel: string) =>
  createHash('sha256').update(readFileSync(join(__dirname, rel))).digest('hex');

describe('history policy vendoring', () => {
  it('profiles.json matches the pinned hash shared with homecast-cloud', () => {
    expect(sha256('../profiles.json')).toBe(PROFILES_SHA256);
  });

  it('policy-cases.json matches the pinned hash shared with homecast-cloud', () => {
    expect(sha256('./policy-cases.json')).toBe(CASES_SHA256);
  });
});
