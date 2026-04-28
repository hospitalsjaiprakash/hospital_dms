const { getAuditLogs } = require('../services/audit.service');
const { sendSuccess, sendPaginated, getPaginationParams } = require('../utils/response');

const getLogs = async (req, res) => {
  const { page, limit } = getPaginationParams(req.query);
  const { entity_type, entity_id, user_id, action } = req.query;

  const { total, logs } = await getAuditLogs({ entityType: entity_type, entityId: entity_id, userId: user_id, action, page, limit });

  return sendPaginated(res, logs, total, page, limit);
};

module.exports = { getLogs };
