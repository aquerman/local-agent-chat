/** One message in a result list: envelope data only, no body. */
export interface MessageSummary {
  id: number;
  date?: Date;
  from: string;
  subject: string;
  unread: boolean;
}

/** One message opened for reading, body already reduced to plain text. */
export interface MessageDetail {
  id: number;
  date?: Date;
  from: string;
  to: string;
  cc: string;
  subject: string;
  text: string;
  attachments: string[];
}

export interface SearchCriteria {
  text?: string;
  from?: string;
  subject?: string;
  since?: Date;
  before?: Date;
  unreadOnly?: boolean;
}

export interface SearchResult {
  total: number;
  messages: MessageSummary[];
}

/**
 * The read-only surface the MCP tools need from a mailbox. It has no method that
 * changes anything, so the server cannot send, move, flag or delete mail no matter
 * what the model asks for.
 */
export interface MailStore {
  listFolders(): Promise<string[]>;
  search(folder: string, criteria: SearchCriteria, limit: number): Promise<SearchResult>;
  read(folder: string, id: number): Promise<MessageDetail | null>;
}

export class MailError extends Error {}
