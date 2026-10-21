const { logger } = require('@librechat/data-schemas');

let service;

/**
 * Roadmap P1b/P1c: background task threads of a project coordinator. Wiring only; the queue,
 * settlement and summary logic live in packages/api/src/projects/threads. Built on first use,
 * like the schedules facade, so requiring it does not start the trigger service graph.
 */
function getProjectThreadService() {
  if (service != null) {
    return service;
  }
  const mongoose = require('mongoose');
  const {
    GenerationJobManager,
    createThreadSummarizer,
    createProjectThreadService,
    resolveCustomSummaryEndpoint,
  } = require('@librechat/api');
  const { getAppConfig } = require('~/server/services/Config/app');
  const { enqueueAgentTrigger } = require('~/server/services/Agents/triggers');
  const db = require('~/models');

  service = createProjectThreadService({
    methods: db,
    getMessages: (user, conversationId) =>
      db.getMessages(
        { user, conversationId },
        'messageId parentMessageId isCreatedByUser error text content createdAt',
      ),
    enqueueTrigger: (envelope, options) => enqueueAgentTrigger(envelope, options),
    getGenerationStatus: (conversationId) => GenerationJobManager.getJobStatus(conversationId),
    getRunningGenerationCount: async () =>
      (await GenerationJobManager.getJobCountByStatus())?.running ?? 0,
    getPrincipal: async (userId) => {
      const user = await mongoose.models.User.findById(userId).select('_id role tenantId').lean();
      if (!user) {
        return null;
      }
      return {
        id: user._id.toString(),
        ...(user.role != null && { role: user.role }),
        ...(user.tenantId != null && { tenantId: user.tenantId }),
      };
    },
    getProjectChat: async (user, conversationId) => {
      const convo = await db.getConvo(user, conversationId);
      if (!convo?.chatProjectId) {
        return null;
      }
      const project = await db.getChatProject(user, convo.chatProjectId);
      if (!project) {
        return null;
      }
      return {
        projectId: project._id.toString(),
        coordinatorConversationId: project.coordinatorConversationId ?? null,
        agentId: convo.agent_id ?? null,
        title: convo.title ?? null,
        ...(convo.tenantId != null && { tenantId: convo.tenantId }),
      };
    },
    getConfig: async () => (await getAppConfig())?.config?.projects?.threads,
    createSummarizer: (agentId) =>
      createThreadSummarizer({
        resolveEndpoint: async () => {
          const [appConfig, agent] = await Promise.all([
            getAppConfig(),
            db.getAgent({ id: agentId }),
          ]);
          return resolveCustomSummaryEndpoint(appConfig?.endpoints?.custom, agent);
        },
      }),
    /** Hook point for phone notifications: wire the Notifier of roadmap N15 here once it lands. */
    onStatusChange: (thread) => {
      logger.debug(`[projects/threads] "${thread.title}" is ${thread.status}`);
    },
  });
  return service;
}

let unsubscribe = null;

/** Starts the thread runner: settlement listener plus the reconciling sweep. Idempotent. */
async function initializeProjectThreads() {
  const { GenerationJobManager } = require('@librechat/api');
  const { getAppConfig } = require('~/server/services/Config/app');
  const config = (await getAppConfig())?.config?.projects?.threads;
  if (config?.enabled !== true) {
    return false;
  }
  const threads = getProjectThreadService();
  if (unsubscribe == null) {
    unsubscribe = GenerationJobManager.onGenerationSettled((event) =>
      threads.onGenerationSettled(event),
    );
  }
  threads.start();
  logger.info('[projects/threads] Project thread runner started');
  return true;
}

function stopProjectThreads() {
  unsubscribe?.();
  unsubscribe = null;
  service?.stop();
}

module.exports = {
  getProjectThreadService,
  initializeProjectThreads,
  stopProjectThreads,
};
