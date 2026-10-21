const express = require('express');
const { createProjectHandlers } = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const db = require('~/models');

const router = express.Router();
const handlers = createProjectHandlers({
  listChatProjects: db.listChatProjects,
  createChatProject: db.createChatProject,
  getChatProject: db.getChatProject,
  updateChatProject: db.updateChatProject,
  deleteChatProject: db.deleteChatProject,
  assignConversationToProject: db.assignConversationToProject,
  listChatProjectKnowledge: db.listChatProjectKnowledge,
  addChatProjectKnowledge: db.addChatProjectKnowledge,
  removeChatProjectKnowledge: db.removeChatProjectKnowledge,
  listProjectThreads: db.listProjectThreads,
});

router.use(requireJwtAuth);

router.get('/', handlers.listProjects);
router.post('/', handlers.createProject);
router.put('/conversations/:conversationId', handlers.assignConversationToProject);
router.get('/:projectId', handlers.getProject);
router.patch('/:projectId', handlers.updateProject);
router.delete('/:projectId', handlers.deleteProject);
router.get('/:projectId/knowledge', handlers.listKnowledge);
router.post('/:projectId/knowledge', handlers.addKnowledge);
router.delete('/:projectId/knowledge/:fileId', handlers.removeKnowledge);
router.get('/:projectId/threads', handlers.listThreads);

module.exports = router;
