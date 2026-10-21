import type { Document, Types } from 'mongoose';

/** Where a project task thread stands, as the user and the coordinator see it. */
export type ProjectThreadStatus = 'working' | 'needs_you' | 'done' | 'failed';

/**
 * Where the thread is in the background queue. `queued` waits for the GPU slot, `dispatched`
 * has a generation started (or starting), `settling` is being finished by one worker, `idle`
 * has nothing to run.
 */
export type ProjectThreadRunState = 'queued' | 'dispatched' | 'settling' | 'idle';

export interface IProjectThread {
  _id?: Types.ObjectId;
  user: string;
  tenantId?: string;
  projectId: string;
  /** The thread's own chat, created by its first run. */
  conversationId: string;
  /** The coordinator chat that started it. */
  coordinatorConversationId?: string | null;
  /** The agent that runs the thread. */
  agentId: string;
  title: string;
  brief: string;
  status: ProjectThreadStatus;
  run: ProjectThreadRunState;
  /** Runs started so far; the first creates the chat, later ones continue it. */
  runCount: number;
  /** The message the next run sends: the brief, or text the coordinator posted. */
  pendingInput?: string | null;
  queuedAt?: Date | null;
  dispatchedAt?: Date | null;
  finishedAt?: Date | null;
  summary?: string;
  error?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IProjectThreadDocument extends Omit<IProjectThread, '_id'>, Document {}
