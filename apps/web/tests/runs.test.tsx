import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../src/App';
import { api } from '../src/api/client';

afterEach(() => vi.unstubAllGlobals());

it('renders the Runs navigation destination and real API array data', () => {
  const client = new QueryClient();
  client.setQueryData(['runs', undefined, 10, 0], {
    success: true,
    data: [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'CREATED',
      policyVersion: 'v1.0.0', modelAdapter: 'mock-adapter', createdAt: '2026-10-24T10:00:00Z' }]
  });
  const html = renderToString(<QueryClientProvider client={client}><StaticRouter location="/runs"><App /></StaticRouter></QueryClientProvider>);
  expect(html).toContain('Evaluation runs');
  expect(html).toContain('/runs/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  expect(html).toContain('mock-adapter');
  client.clear();
});

it('omits undefined status filters and preserves explicit pagination', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [] }) });
  vi.stubGlobal('fetch', fetch);
  await api.runs.list({ status: undefined, limit: 10, offset: 0 });
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/runs?limit=10&offset=0');
  await api.runs.list({ status: 'CLOSED', limit: 10, offset: 10 });
  expect(fetch.mock.calls[1][0]).toBe('/api/v1/runs?status=CLOSED&limit=10&offset=10');
});
