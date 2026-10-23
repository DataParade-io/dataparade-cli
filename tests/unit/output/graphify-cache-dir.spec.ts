import path from 'path';

import { graphifyCacheDir } from '../../../src/output/write-scan-knowledge';

describe('graphifyCacheDir', () => {
  it('is outside the scan root, per scan root, and stable', () => {
    const one = graphifyCacheDir('/repo/a', { XDG_CACHE_HOME: '/cache' });
    expect(one).toBe(graphifyCacheDir('/repo/a', { XDG_CACHE_HOME: '/cache' }));
    expect(one).not.toBe(graphifyCacheDir('/repo/b', { XDG_CACHE_HOME: '/cache' }));
    expect(one.startsWith(path.join('/cache', 'dataparade', 'graphify') + path.sep)).toBe(true);
    expect(path.basename(one)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('can be moved with DATAPARADE_CACHE_DIR', () => {
    const dir = graphifyCacheDir('/repo/a', { DATAPARADE_CACHE_DIR: '/elsewhere', XDG_CACHE_HOME: '/cache' });
    expect(dir.startsWith(path.join('/elsewhere', 'graphify'))).toBe(true);
  });
});
