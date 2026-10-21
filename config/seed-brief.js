/**
 * Seeds the "Morning brief" agent (roadmap 3) and, optionally, its daily scheduled chat.
 *
 * The agent is separate from Benny so its tool set stays small for a 9B model: today's calendar
 * events, Todoist tasks due today (read tool only) and one web search for headlines. Only the
 * connectors the owner has already connected are attached. A scheduled run checks every MCP server
 * on its agent before it starts and disables the schedule when one is not connected, so attaching
 * a missing connector would stop the brief instead of shortening it. The instructions name the
 * missing sources, and the brief ends with "Not connected: <sources>" instead of their sections.
 *
 * Re-running is the refresh: after connecting Todoist or the calendar in the MCP panel, run it
 * again and the agent's tools and instructions follow. `--reset` also restores its name,
 * description and model settings.
 *
 * `--schedule` also creates (or retimes) one daily scheduled chat with this agent, at `--time`
 * (HH:MM, default 07:00) in `--tz` (an IANA zone, default this machine's zone).
 *
 * Usage: npm run seed-benny -- [email] --brief [--schedule] [--time 07:00] [--tz Area/City] [--reset]
 */
const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { randomUUID } = require('crypto');
const { Constants } = require('librechat-data-provider');
const { computeNextRunAt, isValidTimezone, DEFAULT_SCHEDULE_LIMITS } = require('@librechat/api');
const { findOwner, grantAccess } = require('./seed-benny');
const connect = require('./connect');

const BRIEF_AGENT_ID = 'agent_morning_brief';
const BRIEF_SCHEDULE_NAME = 'Morning brief';
const BRIEF_PROMPT = 'Write my morning brief for today.';

const mcpTool = (tool, server) => `${tool}${Constants.mcp_delimiter}${server}`;

/**
 * One entry per source, in the order the model works through them. `isConnected` reads the
 * owner's stored connector credentials; websearch needs none.
 */
const BRIEF_SOURCES = [
  {
    label: 'Calendar',
    server: 'calendar',
    tool: 'list_events',
    step: 'Calendar: call list_events with {"days": 1} and no other arguments.',
    isConnected: ({ PluginAuth }, userId) =>
      PluginAuth.exists({
        userId,
        pluginKey: `${Constants.mcp_prefix}calendar`,
        authField: 'CALENDAR_ICS_URL',
      }),
  },
  {
    label: 'Todoist',
    server: 'todoist',
    tool: 'find-tasks-by-date',
    step: 'Tasks: call find-tasks-by-date with {"startDate": "today"} (this includes overdue tasks).',
    isConnected: ({ Token }, userId) =>
      Token.exists({
        userId,
        type: 'mcp_oauth',
        identifier: { $in: ['mcp:todoist', 'mcp:todoist:refresh'] },
      }),
  },
  {
    label: 'Headlines',
    server: 'websearch',
    tool: 'search',
    step: 'Headlines: call search with {"query": "top news headlines today"}.',
    isConnected: async () => true,
  },
];

const FORMAT_SECTIONS = {
  calendar: ['**Today**', '- <time> <event>, earliest first'],
  todoist: ['**Tasks**', '- <task> (overdue / due today), at most 5'],
  websearch: ['**Headlines**', '- <one line each>, at most 3'],
};

/**
 * Builds the agent's instructions from the sources that are connected now. Kept short: they are
 * prefilled on every run. The output format follows skill/morning-brief, with a section only for
 * each connected source, so a small model has no empty section to fill with guesses; the missing
 * ones are named on a fixed last line instead.
 */
function buildBriefInstructions(available, missing) {
  const steps = available.map((source, index) => `${index + 1}. ${source.step}`);
  const hasPlan = available.some((source) => source.server !== 'websearch');
  const format = [
    '## Morning brief - <weekday> <date>',
    ...available.flatMap((source) => FORMAT_SECTIONS[source.server]),
    ...(hasPlan ? ['**Top 3 priorities**', '1. <from the events and tasks above>'] : []),
    '**Heads-up:** <one deadline or risk, or leave out>',
    ...(missing.length > 0
      ? [`_Not connected: ${missing.map((source) => source.label).join(', ')}._`]
      : []),
  ];
  return [
    "You write the user's morning brief. Today is {{current_date}}.",
    'Go through the sources one at a time and call each tool once. After each result, keep only what matters (titles, times, due dates) before moving on.',
    ...steps,
    'If a tool fails, do not call it again: under that section write only "unavailable" (for example "**Headlines**" then "- unavailable"), and continue.',
    'Only write events, tasks and headlines that a tool returned in this chat. Never invent or guess any.',
    'Then reply with only the brief, under 250 words, in this format:',
    ...format,
  ].join('\n');
}

function buildBriefAgent(available, missing) {
  return {
    instructions: buildBriefInstructions(available, missing),
    tools: available.map((source) => mcpTool(source.tool, source.server)),
    mcpServerNames: available.map((source) => source.server),
  };
}

/** Fields only `--reset` (or the first run) writes, so builder edits to them survive a refresh. */
const briefDefaults = {
  name: 'Morning brief',
  description: 'Daily start-of-day brief from your calendar, Todoist and the news.',
  provider: 'Benner',
  model: 'local',
  /** Thinking Off (`enable_thinking: false`): the brief is a summary, not a reasoning task. */
  model_parameters: { reasoning_effort: 'none' },
  artifacts: '',
};

async function getSourceStatus(models, userId) {
  const status = await Promise.all(
    BRIEF_SOURCES.map(async (source) => ({
      source,
      connected: Boolean(await source.isConnected(models, userId)),
    })),
  );
  return {
    available: status.filter((entry) => entry.connected).map((entry) => entry.source),
    missing: status.filter((entry) => !entry.connected).map((entry) => entry.source),
  };
}

/** Parses "HH:MM" (24 h). Returns null when it is not a valid time. */
function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

/**
 * Creates the daily schedule, or retimes the existing one. Mirrors the create handler's two
 * writes (insert unarmed, then arm), so a crash in between leaves a row the engine's reconciler
 * arms later instead of a half-written one. The MCP check the HTTP handler runs here happens
 * again before every run, so it is not repeated.
 */
async function upsertBriefSchedule(methods, owner, { hour, minute, timezone }) {
  const cadence = { frequency: 'daily', hour, minute };
  const schedules = await methods.getSchedulesByUser(owner._id);
  const existing = schedules.find(
    (schedule) => schedule.agent_id === BRIEF_AGENT_ID && schedule.deleting !== true,
  );

  if (existing) {
    const unchanged =
      existing.timezone === timezone &&
      existing.cadence?.frequency === 'daily' &&
      existing.cadence?.hour === hour &&
      existing.cadence?.minute === minute;
    if (unchanged) {
      console.purple(
        `Schedule "${existing.name}" already runs daily at the same time; left unchanged.`,
      );
      return existing;
    }
    const nextRunAt = existing.enabled
      ? computeNextRunAt({ cadence, timezone, scheduleId: existing.id })
      : undefined;
    const updated = await methods.updateScheduleById(existing.id, owner._id, {
      cadence,
      timezone,
      ...(nextRunAt ? { nextRunAt } : {}),
    });
    console.green(`Retimed schedule "${existing.name}".`);
    return updated;
  }

  const id = `sched_${randomUUID()}`;
  const created = await methods.createScheduleWithSlot(
    {
      id,
      user: owner._id,
      tenantId: owner.tenantId,
      name: BRIEF_SCHEDULE_NAME,
      prompt: BRIEF_PROMPT,
      agent_id: BRIEF_AGENT_ID,
      cadence,
      timezone,
      target: 'new',
      enabled: true,
      clientRequestId: `seed-${id}`,
    },
    DEFAULT_SCHEDULE_LIMITS.maxPerUser,
  );
  if (created === 'limit') {
    console.orange('Schedule limit reached: delete a scheduled chat, then run this again.');
    return null;
  }
  const nextRunAt = computeNextRunAt({ cadence, timezone, scheduleId: created.id });
  if (nextRunAt) {
    await methods.armSchedule(created.id, nextRunAt);
  }
  console.green(`Created schedule "${BRIEF_SCHEDULE_NAME}".`);
  return created;
}

const pad = (value) => String(value).padStart(2, '0');

async function seedBrief({ email, reset, schedule, time = '07:00', timezone }) {
  const zone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const at = parseTime(time);
  if (schedule && !at) {
    console.orange(`--time must be HH:MM (24 h), got "${time}".`);
    return 1;
  }
  if (schedule && !isValidTimezone(zone)) {
    console.orange(`--tz must be an IANA time zone such as Europe/Paris, got "${zone}".`);
    return 1;
  }

  await connect();
  const { grantPermission } = require('~/server/services/PermissionService');
  const methods = require('~/models');
  const { User, PluginAuth, Token } = require('~/db/models');

  const owner = await findOwner(User, email);
  if (!owner) {
    console.orange(
      email
        ? `No user with email ${email}. Register in the UI first, then run this again.`
        : 'No users yet. Register in the UI first, then run this again.',
    );
    return 0;
  }

  const existing = await methods.getAgent({ id: BRIEF_AGENT_ID });
  const ownerId = existing?.author ?? owner._id;
  const { available, missing } = await getSourceStatus({ PluginAuth, Token }, ownerId);
  const managed = buildBriefAgent(available, missing);

  let agent;
  if (!existing) {
    agent = await methods.createAgent({
      id: BRIEF_AGENT_ID,
      author: owner._id,
      ...briefDefaults,
      ...managed,
    });
    console.green(`Created ${BRIEF_AGENT_ID} (owner: ${owner.email}).`);
  } else {
    agent = await methods.updateAgent(
      { id: BRIEF_AGENT_ID },
      reset ? { ...briefDefaults, ...managed } : managed,
      { updatingUserId: ownerId.toString() },
    );
    console.green(`Refreshed ${BRIEF_AGENT_ID}${reset ? ' and reset its defaults' : ''}.`);
  }
  await grantAccess(grantPermission, agent, ownerId);

  console.log(`Sources: ${available.map((source) => source.label).join(', ')}`);
  if (missing.length > 0) {
    console.orange(
      `Not connected: ${missing.map((source) => source.label).join(', ')}. ` +
        'The brief names them on its last line. Connect them in the MCP panel, then run this again.',
    );
  }

  if (schedule) {
    const row = await upsertBriefSchedule(
      methods,
      { ...owner, _id: ownerId },
      { ...at, timezone: zone },
    );
    if (row) {
      console.log(`Runs daily at ${pad(at.hour)}:${pad(at.minute)} (${zone}).`);
    }
  }
  return 0;
}

module.exports = {
  seedBrief,
  briefDefaults,
  buildBriefAgent,
  buildBriefInstructions,
  parseTime,
  BRIEF_SOURCES,
  BRIEF_AGENT_ID,
};
