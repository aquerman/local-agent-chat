/**
 * Seeds BennyChat's default "Benny" agent (roadmap F3) into the database.
 *
 * Agents are database records, so `bennychat.yaml` cannot define one; its `modelSpecs` entry points
 * at the fixed id `agent_benny` instead, and this script creates that record. It is idempotent: an
 * existing Benny is left untouched (so edits made in the agent builder survive), unless `--reset`
 * is passed, which rewrites the managed fields below back to their defaults.
 *
 * The agent is owned by the given user (by email), or by the oldest account when none is given, and
 * shared read-only with every user so the default model spec works for all accounts.
 *
 * Usage: npm run seed-benny -- [email] [--reset]
 */
const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const {
  Constants,
  AccessRoleIds,
  ResourceType,
  PrincipalType,
} = require('librechat-data-provider');
const connect = require('./connect');

const BENNY_AGENT_ID = 'agent_benny';

/**
 * Roadmap 8: the filesystem server's tools Benny carries (~1.4k tokens of schemas, of its 14). Left
 * out: read_file (alias of read_text_file), read_media_file (no vision model), read_multiple_files,
 * list_directory_with_sizes and directory_tree (large outputs). Writes ask via toolApproval.
 */
const folderTools = [
  'list_allowed_directories',
  'list_directory',
  'search_files',
  'read_text_file',
  'get_file_info',
  'write_file',
  'edit_file',
  'create_directory',
  'move_file',
];

/** Fields this script owns. Keep the instructions short: every token is prefilled on each turn. */
const bennyDefaults = {
  name: 'Benny',
  description:
    'Local assistant: web search, documents, your folders, asks when unsure, approval before writes.',
  instructions: [
    'You are Benny, a helpful assistant running on a local model.',
    'Answer directly and concisely. Use web search for anything recent or uncertain, and cite the pages you used.',
    'If a request is ambiguous or needs a choice only the user can make, ask with ask_user_question instead of guessing.',
    'To make a Word, PDF or PowerPoint file, call create_document; the file is attached to the chat, so do not repeat its content.',
  ].join('\n'),
  provider: 'Benner',
  model: 'local',
  model_parameters: {},
  tools: [
    `${Constants.mcp_all}${Constants.mcp_delimiter}websearch`,
    `${Constants.mcp_all}${Constants.mcp_delimiter}documents`,
    'ask_user_question',
    ...folderTools.map((tool) => `${tool}${Constants.mcp_delimiter}filesystem`),
  ],
  mcpServerNames: ['websearch', 'documents', 'filesystem'],
  /** Off: the artifacts prompt alone is ~2.5k tokens. Switch it on in the agent builder. */
  artifacts: '',
};

async function findOwner(User, email) {
  if (email) {
    return User.findOne({ email: email.toLowerCase() }).lean();
  }
  return User.findOne({}).sort({ createdAt: 1 }).lean();
}

async function grantAccess(grantPermission, agent, ownerId) {
  const grants = [
    [PrincipalType.USER, ownerId, ResourceType.AGENT, AccessRoleIds.AGENT_OWNER],
    [PrincipalType.USER, ownerId, ResourceType.REMOTE_AGENT, AccessRoleIds.REMOTE_AGENT_OWNER],
    [PrincipalType.PUBLIC, null, ResourceType.AGENT, AccessRoleIds.AGENT_VIEWER],
  ];
  for (const [principalType, principalId, resourceType, accessRoleId] of grants) {
    await grantPermission({
      principalType,
      principalId,
      resourceType,
      resourceId: agent._id,
      accessRoleId,
      grantedBy: ownerId,
    });
  }
}

async function seedBenny({ email, reset }) {
  await connect();
  const { grantPermission } = require('~/server/services/PermissionService');
  const { createAgent, updateAgent, getAgent } = require('~/models');
  const { User } = require('~/db/models');

  const owner = await findOwner(User, email);
  if (!owner) {
    console.orange(
      email
        ? `No user with email ${email}. Register in the UI first, then run this again.`
        : 'No users yet. Register in the UI first, then run this again.',
    );
    return 0;
  }

  const existing = await getAgent({ id: BENNY_AGENT_ID });
  let agent = existing;
  if (!existing) {
    agent = await createAgent({ id: BENNY_AGENT_ID, author: owner._id, ...bennyDefaults });
    console.green(`Created ${BENNY_AGENT_ID} (owner: ${owner.email}).`);
  } else if (reset) {
    agent = await updateAgent({ id: BENNY_AGENT_ID }, bennyDefaults, {
      updatingUserId: owner._id.toString(),
    });
    console.green(`Reset ${BENNY_AGENT_ID} to its defaults.`);
  } else {
    console.purple(
      `${BENNY_AGENT_ID} already exists; left unchanged (pass --reset to restore it).`,
    );
  }

  const ownerId = existing?.author ?? owner._id;
  await grantAccess(grantPermission, agent, ownerId);
  return 0;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const email = args.find((arg) => !arg.startsWith('--'));
  seedBenny({ email, reset })
    .then((code) => process.exit(code))
    .catch((error) => {
      console.red('Seeding Benny failed:');
      console.error(error);
      process.exit(1);
    });
}

module.exports = { seedBenny, bennyDefaults, BENNY_AGENT_ID };
