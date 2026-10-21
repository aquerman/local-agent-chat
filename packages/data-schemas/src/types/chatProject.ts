import type { Document, Types } from 'mongoose';

export interface IChatProject {
  _id?: Types.ObjectId;
  name: string;
  description?: string;
  /** Added to the system prompt of every chat in the project. */
  instructions?: string;
  /** `file_id`s of the project's knowledge files, in the order they were added. */
  knowledgeFileIds?: string[];
  user: string;
  conversationCount: number;
  lastConversationAt?: Date | null;
  lastConversationId?: string | null;
  /** The project's coordinator chat, which can start and follow task threads. */
  coordinatorConversationId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  tenantId?: string;
}

export interface IChatProjectDocument extends Omit<IChatProject, '_id'>, Document {}
