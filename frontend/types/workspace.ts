import type { Client, Order, Stage } from '@tirek/contracts';
export type Section = 'overview' | 'clients' | 'orders' | 'finances' | 'documents' | 'settings' | 'history' | 'tasks' | 'team';
export type Modal = { kind: 'client' | 'order' | 'edit-order' | 'expense' | 'payment' | 'document' | 'about'; client?: Client; order?: Order } | { kind: 'details'; order: Order; client?: never };
export const nextStage: Partial<Record<Stage, Stage>> = { NEW: 'CONFIRMED', CONFIRMED: 'IN_PROGRESS', IN_PROGRESS: 'COMPLETED' };
