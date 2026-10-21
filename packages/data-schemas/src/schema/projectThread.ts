import { Schema } from 'mongoose';
import type { IProjectThreadDocument } from '~/types';

const projectThreadSchema: Schema<IProjectThreadDocument> = new Schema<IProjectThreadDocument>(
  {
    user: { type: String, required: true },
    tenantId: { type: String, index: true },
    projectId: { type: String, required: true },
    conversationId: { type: String, required: true },
    coordinatorConversationId: { type: String, default: null },
    agentId: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    brief: { type: String, default: '' },
    status: {
      type: String,
      enum: ['working', 'needs_you', 'done', 'failed'],
      default: 'working',
    },
    run: {
      type: String,
      enum: ['queued', 'dispatched', 'settling', 'idle'],
      default: 'queued',
    },
    runCount: { type: Number, default: 0, min: 0 },
    pendingInput: { type: String, default: null },
    queuedAt: { type: Date, default: null },
    dispatchedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    summary: { type: String, default: '' },
    error: { type: String, default: '' },
  },
  { timestamps: true },
);

projectThreadSchema.index({ user: 1, conversationId: 1 }, { unique: true });
projectThreadSchema.index({ user: 1, projectId: 1, createdAt: -1 });
projectThreadSchema.index({ run: 1, queuedAt: 1 });

export default projectThreadSchema;
