const { getAuditLogs } = require('../services/audit.service');
const { sendSuccess, sendPaginated, getPaginationParams } = require('../utils/response');

const getLogs = async (req, res) => {
  const { page, limit } = getPaginationParams(req.query);
  const { entity_type, entity_id, user_id, action, patient_activity_only } = req.query;

  const { total, logs } = await getAuditLogs({ 
    entityType: entity_type, 
    entityId: entity_id, 
    userId: user_id, 
    action, 
    page, 
    limit,
    requesterRole: req.user.role,
    requesterId: req.user.id,
    patientActivityOnly: patient_activity_only === 'true',
  });

  return sendPaginated(res, logs, total, page, limit);
};

module.exports = { getLogs };
