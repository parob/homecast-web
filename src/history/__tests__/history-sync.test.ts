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
const PROFILES_SHA256 = '9e945b461e754af808afcdb3ab7a25b6502aa7afffc21f1770f4d5064a6eebb4';
const CASES_SHA256 = 'e85d9b2038fc12f4509c3ccb38444d9fd7aaf8a77c8b0f7cd47a0065a7bfaec3';

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
