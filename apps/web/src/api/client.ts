import type { ApiResponse, Run, Observation, EvidenceArtifact, RunManifest, VerifyResult, ExperimentResult } from '../types';

const API_BASE = '/api/v1';

async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Service-ID': 'web-dashboard',
      'X-Service-Role': (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('bayora-role')) || 'orchestrator',
      ...options.headers
    }
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error?.message || `HTTP ${response.status}`);
  }

  return data;
}

export const api = {
  runs: {
    tamperCheck: (id: string) => fetchApi<{ original: VerifyResult; tampered: VerifyResult }>(`/runs/${id}/tamper-check`, { method: 'POST' }),
    list: (params?: { status?: string; limit?: number; offset?: number }) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params || {})) {
        if (value !== undefined) query.set(key, String(value));
      }
      return fetchApi<Run[]>(`/runs?${query}`);
    },
    
    get: (id: string) => 
      fetchApi<Run>(`/runs/${id}`),
    
    create: (data: { policyVersion: string; modelAdapter: string; createdBy: string; config?: Record<string, unknown> }) =>
      fetchApi<Run>('/runs', { method: 'POST', body: JSON.stringify(data) }),
    
    commit: (id: string, payload: string) =>
      fetchApi<{ commitmentHash: string }>(`/runs/${id}/commit`, { method: 'POST', body: JSON.stringify({ payload }) }),
    
    execute: (id: string) =>
      fetchApi<{ status: string }>(`/runs/${id}/execute`, { method: 'POST' }),
    
    evaluate: (id: string) =>
      fetchApi<{ status: string }>(`/runs/${id}/evaluate`, { method: 'POST' }),
    
    close: (id: string) =>
      fetchApi<{ status: string }>(`/runs/${id}/close`, { method: 'POST' }),
    
    observations: (id: string) =>
      fetchApi<Observation[]>(`/runs/${id}/observations`),
    
    evidence: (id: string) =>
      fetchApi<EvidenceArtifact[]>(`/runs/${id}/evidence`),
    
    manifest: (id: string) =>
      fetchApi<RunManifest>(`/runs/${id}/manifest`),
    
    verify: (id: string) =>
      fetchApi<VerifyResult>(`/runs/${id}/verify`, { method: 'POST' }),
    
    signManifest: (id: string) =>
      fetchApi<RunManifest>(`/runs/${id}/manifest/sign`, { method: 'POST' }),
    
    releaseObservation: (id: string, data: { caseId: string; outcome: string; severity: string; category: string; confidence: number }) =>
      fetchApi<Observation>(`/runs/${id}/observations/release`, { method: 'POST', body: JSON.stringify(data) })
  },

  experiments: {
    createLeakage: (data: { type: string; runId: string; config: Record<string, unknown> }) =>
      fetchApi<{ experimentId: string }>('/experiments/leakage', { method: 'POST', body: JSON.stringify(data) }),
    
    getResults: (id: string) =>
      fetchApi<ExperimentResult[]>(`/experiments/${id}/results`)
  },

  manifest: {
    publicKey: () =>
      fetchApi<{ publicKey: string; keyId: string }>('/manifest/public-key')
  }
};
