import { describe, expect, it } from 'vitest';

import source from './PlayerDetail.vue?raw';

describe('PlayerDetail hidden runtime boundaries', () => {
  it('unmounts the lyrics view while the detail page is closed', () => {
    expect(source).toContain('v-else-if="showPlayerDetail && parsedLyrics.length > 0"');
  });
});
