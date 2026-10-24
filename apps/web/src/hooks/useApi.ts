import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Run, Observation, EvidenceArtifact, RunManifest, VerifyResult, ExperimentResult, ApiResponse } from '../types';

export function useRuns(status?: string, limit = 50, offset = 0) {
  return useQuery<ApiResponse<Run[]>>({
    queryKey: ['runs', status, limit, offset],
    queryFn: () => api.runs.list({ status, limit, offset })
  });
}

export function useRun(id: string) {
  return useQuery<ApiResponse<Run>>({
    queryKey: ['run', id],
    queryFn: () => api.runs.get(id),
    enabled: !!id
  });
}

export function useCreateRun() {
  const queryClient = useQueryClient();
  return useMutation<ApiResponse<Run>, Error, { policyVersion: string; modelAdapter: string; createdBy: string; config?: Record<string, unknown> }>({
    mutationFn: api.runs.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    }
  });
}

export function useCommitPayload() {
  const queryClient = useQueryClient();
  return useMutation<ApiResponse<{ commitmentHash: string }>, Error, { id: string; payload: string }>({
    mutationFn: ({ id, payload }) => api.runs.commit(id, payload),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['run', id] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    }
  });
}

export function useExecuteRun() {
  const queryClient = useQueryClient();
  return useMutation<ApiResponse<{ status: string }>, Error, string>({
    mutationFn: api.runs.execute,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['run', id] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    }
  });
}

export function useEvaluateRun() {
  const queryClient = useQueryClient();
  return useMutation<ApiResponse<{ status: string }>, Error, string>({
    mutationFn: api.runs.evaluate,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['run', id] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    }
  });
}

export function useCloseRun() {
  const queryClient = useQueryClient();
  return useMutation<ApiResponse<{ status: string }>, Error, string>({
    mutationFn: api.runs.close,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['run', id] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    }
  });
}

export function useObservations(runId: string) {
  return useQuery<ApiResponse<Observation[]>>({
    queryKey: ['observations', runId],
    queryFn: () => api.runs.observations(runId),
    enabled: !!runId
  });
}

export function useReleaseObservation() {
  const queryClient = useQueryClient();
  return useMutation<ApiResponse<Observation>, Error, { id: string; data: { caseId: string; outcome: string; severity: string; category: string; confidence: number } }>({
    mutationFn: ({ id, data }) => api.runs.releaseObservation(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['observations', id] });
      queryClient.invalidateQueries({ queryKey: ['run', id] });
    }
  });
}

export function useEvidence(runId: string) {
  return useQuery<ApiResponse<EvidenceArtifact[]>>({
    queryKey: ['evidence', runId],
    queryFn: () => api.runs.evidence(runId),
    enabled: !!runId
  });
}

export function useManifest(runId: string) {
  return useQuery<ApiResponse<RunManifest>>({
    queryKey: ['manifest', runId],
    queryFn: () => api.runs.manifest(runId),
    enabled: !!runId
  });
}

export function useVerifyRun() {
  const queryClient = useQueryClient();
  return useMutation<ApiResponse<VerifyResult>, Error, string>({
    mutationFn: api.runs.verify,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['run', id] });
    }
  });
}

export function useSignManifest() {
  const queryClient = useQueryClient();
  return useMutation<ApiResponse<RunManifest>, Error, string>({
    mutationFn: api.runs.signManifest,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['manifest', id] });
      queryClient.invalidateQueries({ queryKey: ['run', id] });
    }
  });
}

export function useLeakageExperiment() {
  const queryClient = useQueryClient();
  return useMutation<ApiResponse<{ experimentId: string }>, Error, { type: string; runId: string; config: Record<string, unknown> }>({
    mutationFn: api.experiments.createLeakage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiments'] });
    }
  });
}

export function useExperimentResults(experimentId: string) {
  return useQuery<ApiResponse<ExperimentResult[]>>({
    queryKey: ['experimentResults', experimentId],
    queryFn: () => api.experiments.getResults(experimentId),
    enabled: !!experimentId
  });
}

export function usePublicKey() {
  return useQuery<ApiResponse<{ publicKey: string; keyId: string }>>({
    queryKey: ['publicKey'],
    queryFn: api.manifest.publicKey
  });
}
