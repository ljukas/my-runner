import { describe, expect, test } from 'bun:test';

import { RUN_NOTICE_TEXT } from './run-notice';

describe('RUN_NOTICE_TEXT', () => {
  test('says why no summary opened', () => {
    expect(RUN_NOTICE_TEXT.discarded).toBe('Run discarded');
    expect(RUN_NOTICE_TEXT.tooShort).toBe('Too short to save — under a minute');
  });
});
