import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  loadEnvFile: vi.fn(),
  Pool: vi.fn(() => ({ on: vi.fn() }))
}));

vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }));
vi.mock('node:process', () => ({ loadEnvFile: mocks.loadEnvFile }));
vi.mock('pg', () => ({ default: { Pool: mocks.Pool } }));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('database environment loading', () => {
  it('loads the repository .env before constructing the pool', async () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.loadEnvFile.mockImplementation(() => {
      vi.stubEnv('DB_PASSWORD', 'test-only-password');
    });

    await import('../src/db/client.js');

    expect(mocks.loadEnvFile).toHaveBeenCalledWith(resolve(__dirname, '../../../.env'));
    expect(mocks.Pool).toHaveBeenCalledWith(expect.objectContaining({ password: 'test-only-password' }));
  });

  it('supports environments without a .env file', async () => {
    mocks.existsSync.mockReturnValue(false);
    vi.stubEnv('DB_PASSWORD', 'injected-password');

    await import('../src/db/client.js');

    expect(mocks.loadEnvFile).not.toHaveBeenCalled();
    expect(mocks.Pool).toHaveBeenCalledWith(expect.objectContaining({ password: 'injected-password' }));
  });
});
