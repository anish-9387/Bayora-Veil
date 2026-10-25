import { AsyncLocalStorage } from 'node:async_hooks';

export type Principal = { userId: string; tenantId: string; role: string; deadline?: number };
export const principals = new AsyncLocalStorage<Principal>();
export const DEMO_TENANT = '00000000-0000-4000-8000-000000000001';
export function tenantId() { return principals.getStore()?.tenantId || DEMO_TENANT; }
export function isolated() { return process.env.EXECUTION_PROFILE === 'isolated'; }
