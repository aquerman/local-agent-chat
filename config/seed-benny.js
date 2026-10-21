/**
 * Seeds BennyChat's agents into the database: the default "Benny" agent (roadmap F3) and the
 * "Researcher" deep-research agent (roadmap 16).
 *
 * Agents are database records, so `bennychat.yaml` cannot define them; its `modelSpecs` entries
 * point at the fixed ids `agent_benny` and `agent_researcher` instead, and this script creates those
 * records. It is idempotent: an existing agent is left untouched (so edits made in the agent builder
 * survive), unless `--reset` is passed, which rewrites the managed fields below back to their
 * defaults (`--reset=researcher` resets only the named agents).
 *
 * The agents are owned by the given user (by email), or by the oldest account when none is given,
 * and shared read-only with every user so the model specs work for all accounts.
 *
 * With `--brief` it also seeds the "Morning brief" agent and, with `--schedule`, its daily run
 * (roadmap 3, `config/seed-brief.js`, which documents the other flags).
 *
 * Usage: npm run seed-benny -- [email] [--reset | --reset=benny,researcher,brief]
 *   [--brief [--schedule] [--time 07:00] [--tz Area/City]]
 */
const fs = require('fs');
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
const RESEARCHER_AGENT_ID = 'agent_researcher';
const DEEP_RESEARCH_SKILL = path.resolve(__dirname, '..', 'skill', 'deep-research', 'SKILL.md');

const mcpTool = (server) => `${Constants.mcp_all}${Constants.mcp_delimiter}${server}`;

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
  description: 'Local assistant: web search, documents, asks when unsure, approval before writes.',
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
    mcpTool('websearch'),
    mcpTool('documents'),
    'ask_user_question',
    ...folderTools.map((tool) => `${tool}${Constants.mcp_delimiter}filesystem`),
  ],
  mcpServerNames: ['websearch', 'documents', 'filesystem'],
  /** Roadmap 16: the skill catalog (names + one line each), so `deep-research` and the starter
   *  skills are usable from Benny; a body enters the prompt only when the skill is used. */
  skills_enabled: true,
  skills_scope: 'all',
  /** Off: the artifacts prompt alone is ~2.5k tokens. Switch it on in the agent builder. */
  artifacts: '',
};

/** The deep-research skill body (frontmatter removed): the Researcher's whole workflow. */
function readDeepResearchWorkflow(file = DEEP_RESEARCH_SKILL) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return text.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

/**
 * Roadmap 16. The workflow is the `deep-research` skill itself, read at seed time and placed in the
 * instructions, so a 9B model follows it from the first token instead of having to load a skill;
 * re-seed with `--reset=researcher` after editing the skill. Only websearch and documents: a small
 * tool set keeps each step's prompt lean. The higher recursion limit covers 6 sub-questions with up
 * to 3 fetches each plus the report sections (one tool round is about 3 graph steps), and the larger
 * context budget keeps the notes of a long run from being summarized away.
 */
function researcherDefaults() {
  return {
    name: 'Researcher',
    description:
      'Deep research: plans sub-questions, reads web sources, writes a cited report document.',
    instructions: [
      'You are Researcher, a deep-research agent running on a local model. Follow this workflow for every request.',
      '',
      readDeepResearchWorkflow(),
    ].join('\n'),
    provider: 'Benner',
    model: 'local',
    model_parameters: { maxContextTokens: 96000 },
    recursion_limit: 100,
    tools: [mcpTool('websearch'), mcpTool('documents')],
    mcpServerNames: ['websearch', 'documents'],
    artifacts: '',
  };
}

const AGENTS = [
  { key: 'benny', id: BENNY_AGENT_ID, defaults: () => bennyDefaults },
  { key: 'researcher', id: RESEARCHER_AGENT_ID, defaults: researcherDefaults },
];

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

async function seedAgent({ id, defaults }, { owner, reset }, deps) {
  const { createAgent, updateAgent, getAgent, grantPermission } = deps;
  const existing = await getAgent({ id });
  let agent = existing;
  if (!existing) {
    agent = await createAgent({ id, author: owner._id, ...defaults() });
    console.green(`Created ${id} (owner: ${owner.email}).`);
  } else if (reset) {
    agent = await updateAgent({ id }, defaults(), { updatingUserId: owner._id.toString() });
    console.green(`Reset ${id} to its defaults.`);
  } else {
    console.purple(`${id} already exists; left unchanged (pass --reset to restore it).`);
  }

  const ownerId = existing?.author ?? owner._id;
  await grantAccess(grantPermission, agent, ownerId);
}

/** `reset`: true resets every agent, a list resets the agents with those keys. */
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

  const deps = { createAgent, updateAgent, getAgent, grantPermission };
  for (const entry of AGENTS) {
    await seedAgent(entry, { owner, reset: resets(reset, entry.key) }, deps);
  }
  return 0;
}

/** `--reset` → true; `--reset=a,b` → ['a', 'b']; absent → false. */
function parseReset(args) {
  const flag = args.find((arg) => arg === '--reset' || arg.startsWith('--reset='));
  if (flag === undefined) {
    return false;
  }
  if (flag === '--reset') {
    return true;
  }
  return flag
    .slice('--reset='.length)
    .split(',')
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean);
}

/** Whether `reset` (from {@link parseReset}) covers the agent with this key. */
function resets(reset, key) {
  return reset === true || (Array.isArray(reset) && reset.includes(key));
}

module.exports = {
  seedBenny,
  findOwner,
  grantAccess,
  parseReset,
  bennyDefaults,
  researcherDefaults,
  readDeepResearchWorkflow,
  BENNY_AGENT_ID,
  RESEARCHER_AGENT_ID,
};

/** Value of `--name value` or `--name=value`, or undefined. */
function readOption(args, name) {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) {
    return inline.slice(name.length + 3);
  }
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(args) {
  const valueOptions = ['time', 'tz'];
  const optionValues = new Set(valueOptions.map((name) => readOption(args, name)));
  const email = args.find((arg) => !arg.startsWith('--') && !optionValues.has(arg));
  const reset = parseReset(args);
  const code = await seedBenny({ email, reset });
  if (code !== 0 || !args.includes('--brief')) {
    return code;
  }
  const { seedBrief } = require('./seed-brief');
  return seedBrief({
    email,
    reset: resets(reset, 'brief'),
    schedule: args.includes('--schedule'),
    time: readOption(args, 'time'),
    timezone: readOption(args, 'tz'),
  });
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.red('Seeding failed:');
      console.error(error);
      process.exit(1);
    });
}
