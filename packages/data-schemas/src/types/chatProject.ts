import type { TChatProjectColor, TChatProjectIcon } from 'librechat-data-provider';
import type { Document, Types } from 'mongoose';

export interface IChatProject {
  _id?: Types.ObjectId;
  name: string;
  description?: string;
  /** Added to the system prompt of every chat in the project. */
  instructions?: string;
  /** `file_id`s of the project's knowledge files, in the order they were added. */
  knowledgeFileIds?: string[];
  /** Icon shown wherever the project appears; null shows a folder. */
  icon?: TChatProjectIcon | null;
  /** Tint of the icon; null uses the theme's neutral text color. */
  color?: TChatProjectColor | null;
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
