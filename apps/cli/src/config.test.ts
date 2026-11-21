import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveIdentity } from './config';
import { tempDir } from './test-helpers';

describe('resolveIdentity', () => {
  it('flags win over the config file', () => {
    const file = join(tempDir('ab-cfg-'), 'config.json');
    writeFileSync(file, JSON.stringify({ name: 'Dewi', side: 'engineering' }));
    expect(resolveIdentity({}, file)).toEqual({ name: 'Dewi', side: 'engineering' });
    expect(resolveIdentity({ name: 'Tan', side: 'product' }, file)).toEqual({ name: 'Tan', side: 'product' });
  });

  it('defaults to the OS user and product', () => {
    const id = resolveIdentity({}, join(tempDir('ab-cfg-'), 'missing.json'));
    expect(id.side).toBe('product');
    expect(id.name.length).toBeGreaterThan(0);
  });

  it('rejects an unknown side', () => {
    expect(() => resolveIdentity({ side: 'sales' }, '/nonexistent')).toThrow(/--side/);
  });
});
