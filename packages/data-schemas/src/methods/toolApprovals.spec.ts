import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IConversation } from '..';
import { createToolApprovalMethods, MAX_CONVERSATION_APPROVED_TOOLS } from './toolApprovals';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let Conversation: mongoose.Model<IConversation>;
let methods: ReturnType<typeof createToolApprovalMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  Object.assign(mongoose.models, createModels(mongoose));
  Conversation = mongoose.models.Conversation;
  methods = createToolApprovalMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Conversation.deleteMany({});
});

describe('conversation tool approvals', () => {
  const user = 'user-1';

  it('remembers names once per conversation and keeps them out of default reads', async () => {
    await Conversation.create({ conversationId: 'c1', user, endpoint: 'agents' });
    await methods.addConversationApprovedTools(user, 'c1', ['create_task_mcp_todo']);
    const stored = await methods.addConversationApprovedTools(user, 'c1', [
      'create_task_mcp_todo',
      'send_mcp_mail',
      '',
    ]);
    expect(stored).toEqual(['create_task_mcp_todo', 'send_mcp_mail']);
    expect(await methods.getConversationApprovedTools(user, 'c1')).toEqual(stored);

    const plain = await Conversation.findOne({ conversationId: 'c1' }).lean();
    expect(plain).not.toHaveProperty('approvedTools');
  });

  it("never writes to another user's conversation or creates one", async () => {
    await Conversation.create({ conversationId: 'c2', user: 'someone-else', endpoint: 'agents' });
    expect(await methods.addConversationApprovedTools(user, 'c2', ['send_mcp_mail'])).toEqual([]);
    expect(await methods.addConversationApprovedTools(user, 'missing', ['send_mcp_mail'])).toEqual(
      [],
    );
    expect(await methods.getConversationApprovedTools('someone-else', 'c2')).toEqual([]);
    expect(await Conversation.countDocuments({ conversationId: 'missing' })).toBe(0);
  });

  it('stops growing at the cap', async () => {
    await Conversation.create({ conversationId: 'c3', user, endpoint: 'agents' });
    const many = Array.from({ length: MAX_CONVERSATION_APPROVED_TOOLS }, (_, i) => `tool_${i}`);
    await methods.addConversationApprovedTools(user, 'c3', many);
    const after = await methods.addConversationApprovedTools(user, 'c3', ['one_more']);
    expect(after).toHaveLength(MAX_CONVERSATION_APPROVED_TOOLS);
    expect(after).not.toContain('one_more');
  });
});
