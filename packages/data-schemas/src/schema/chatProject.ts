import { Schema } from 'mongoose';
import {
  CHAT_PROJECT_ICONS,
  CHAT_PROJECT_COLORS,
  MAX_CHAT_PROJECT_KNOWLEDGE_FILES,
  MAX_CHAT_PROJECT_INSTRUCTIONS_LENGTH,
} from 'librechat-data-provider';
import type { IChatProjectDocument } from '~/types';

const chatProjectSchema: Schema<IChatProjectDocument> = new Schema<IChatProjectDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      index: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000,
    },
    instructions: {
      type: String,
      default: '',
      trim: true,
      maxlength: MAX_CHAT_PROJECT_INSTRUCTIONS_LENGTH,
    },
    knowledgeFileIds: {
      type: [String],
      default: [],
      validate: {
        validator: (ids: string[]) => ids.length <= MAX_CHAT_PROJECT_KNOWLEDGE_FILES,
        message: `A project holds at most ${MAX_CHAT_PROJECT_KNOWLEDGE_FILES} knowledge files`,
      },
    },
    icon: {
      type: String,
      enum: CHAT_PROJECT_ICONS,
      default: null,
    },
    color: {
      type: String,
      enum: CHAT_PROJECT_COLORS,
      default: null,
    },
    user: {
      type: String,
      required: true,
      index: true,
    },
    conversationCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastConversationAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastConversationId: {
      type: String,
      default: null,
    },
    coordinatorConversationId: {
      type: String,
      default: null,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

chatProjectSchema.index({ user: 1, name: 1, _id: 1 });
chatProjectSchema.index({ user: 1, createdAt: -1, _id: -1 });
chatProjectSchema.index({ user: 1, lastConversationAt: -1, _id: -1 });

export default chatProjectSchema;
