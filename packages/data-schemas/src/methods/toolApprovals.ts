import type { Model } from 'mongoose';
import type { IConversation } from '~/types';

/**
 * Upper bound on remembered tool names per conversation. A chat rarely touches more than a
 * handful of distinct write tools; the cap keeps a crafted or runaway loop from growing the
 * document without limit.
 */
export const MAX_CONVERSATION_APPROVED_TOOLS = 100;

/** Tool names the user chose "always allow in this chat" for (fork: roadmap item 13). */
export interface ToolApprovalMethods {
  /** The names remembered for one of the user's conversations; empty when there are none. */
  getConversationApprovedTools(user: string, conversationId: string): Promise<string[]>;
  /**
   * Remembers tool names for one of the user's conversations and returns the stored list.
   * Nothing is created for a conversation the user does not own (the list is then empty).
   */
  addConversationApprovedTools(
    user: string,
    conversationId: string,
    toolNames: readonly string[],
  ): Promise<string[]>;
}

export function createToolApprovalMethods(
  mongoose: typeof import('mongoose'),
): ToolApprovalMethods {
  function getModel(): Model<IConversation> {
    return mongoose.models.Conversation as Model<IConversation>;
  }

  async function getConversationApprovedTools(
    user: string,
    conversationId: string,
  ): Promise<string[]> {
    const convo = await getModel()
      .findOne({ user, conversationId }, 'approvedTools')
      .lean<Pick<IConversation, 'approvedTools'>>();
    return convo?.approvedTools ?? [];
  }

  async function addConversationApprovedTools(
    user: string,
    conversationId: string,
    toolNames: readonly string[],
  ): Promise<string[]> {
    const names = [...new Set(toolNames.filter((name) => name.length > 0))];
    if (names.length === 0) {
      return getConversationApprovedTools(user, conversationId);
    }
    /** A full list takes no new names (those tools simply keep asking); `$addToSet` dedupes. */
    const updated = await getModel()
      .findOneAndUpdate(
        {
          user,
          conversationId,
          [`approvedTools.${MAX_CONVERSATION_APPROVED_TOOLS - 1}`]: { $exists: false },
        },
        { $addToSet: { approvedTools: { $each: names } } },
        { new: true, projection: 'approvedTools', timestamps: false },
      )
      .lean<Pick<IConversation, 'approvedTools'>>();
    if (updated == null) {
      return getConversationApprovedTools(user, conversationId);
    }
    return updated.approvedTools ?? [];
  }

  return { getConversationApprovedTools, addConversationApprovedTools };
}
