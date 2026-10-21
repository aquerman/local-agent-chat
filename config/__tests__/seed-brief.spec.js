const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('../connect', () => jest.fn().mockResolvedValue(true));
require('../helpers');

logger.silent = true;

describe('seedBrief', () => {
  let mongoServer;
  let models;
  let methods;
  let seedBrief;
  let BRIEF_AGENT_ID;
  let owner;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    models = require('~/db/models');
    methods = require('~/models');
    await methods.seedDatabase();
    ({ seedBrief, BRIEF_AGENT_ID } = require('../seed-brief'));
    owner = await models.User.create({ name: 'Owner', email: 'owner@test.com', role: 'USER' });
    for (const name of ['log', 'green', 'purple', 'orange']) {
      jest.spyOn(console, name).mockImplementation(() => undefined);
    }
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  const getBrief = () => methods.getAgent({ id: BRIEF_AGENT_ID });
  const getBriefSchedules = async () =>
    (await methods.getSchedulesByUser(owner._id)).filter(
      (schedule) => schedule.agent_id === BRIEF_AGENT_ID,
    );

  it('attaches only websearch and names the missing sources when nothing is connected', async () => {
    await expect(seedBrief({})).resolves.toBe(0);
    const agent = await getBrief();
    expect(agent.tools).toEqual(['search_mcp_websearch']);
    expect(agent.mcpServerNames).toEqual(['websearch']);
    expect(agent.model_parameters).toEqual({ reasoning_effort: 'none' });
    expect(agent.instructions).toContain('_Not connected: Calendar, Todoist._');
    expect(agent.instructions).not.toContain('**Today**');
    expect(agent.instructions).not.toContain('**Top 3 priorities**');
    expect(agent.instructions).toContain('{{current_date}}');
    expect(agent.instructions).not.toContain('call list_events');
  });

  it('adds the calendar and Todoist read tools once they are connected', async () => {
    await models.PluginAuth.create({
      userId: owner._id,
      pluginKey: 'mcp_calendar',
      authField: 'CALENDAR_ICS_URL',
      value: 'encrypted',
    });
    await models.Token.create({
      userId: owner._id,
      type: 'mcp_oauth',
      identifier: 'mcp:todoist',
      token: 'encrypted',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await expect(seedBrief({})).resolves.toBe(0);
    const agent = await getBrief();
    expect(agent.tools).toEqual([
      'list_events_mcp_calendar',
      'find-tasks-by-date_mcp_todoist',
      'search_mcp_websearch',
    ]);
    expect(agent.instructions).not.toContain('Not connected');
    expect(agent.instructions).toContain('**Tasks**');
    expect(await models.Agent.countDocuments({ id: BRIEF_AGENT_ID })).toBe(1);
  });

  it('keeps a renamed agent on refresh and restores it with reset', async () => {
    await methods.updateAgent(
      { id: BRIEF_AGENT_ID },
      { name: 'My brief' },
      { updatingUserId: owner._id.toString() },
    );
    await seedBrief({});
    expect((await getBrief()).name).toBe('My brief');
    await seedBrief({ reset: true });
    expect((await getBrief()).name).toBe('Morning brief');
  });

  it('creates one armed daily schedule and retimes it instead of adding another', async () => {
    await seedBrief({ schedule: true, time: '07:00', timezone: 'Europe/Amsterdam' });
    let [schedule, ...rest] = await getBriefSchedules();
    expect(rest).toHaveLength(0);
    expect(schedule.cadence).toMatchObject({ frequency: 'daily', hour: 7, minute: 0 });
    expect(schedule.timezone).toBe('Europe/Amsterdam');
    expect(schedule.enabled).toBe(true);
    expect(schedule.nextRunAt).toBeInstanceOf(Date);

    await seedBrief({ schedule: true, time: '07:00', timezone: 'Europe/Amsterdam' });
    await seedBrief({ schedule: true, time: '6:30', timezone: 'Europe/Amsterdam' });
    [schedule, ...rest] = await getBriefSchedules();
    expect(rest).toHaveLength(0);
    expect(schedule.cadence).toMatchObject({ hour: 6, minute: 30 });
    expect(schedule.nextRunAt).toBeInstanceOf(Date);
  });

  it('refuses an invalid time or zone before touching the database', async () => {
    await expect(seedBrief({ schedule: true, time: '25:00' })).resolves.toBe(1);
    await expect(seedBrief({ schedule: true, timezone: 'Not/AZone' })).resolves.toBe(1);
  });
});
