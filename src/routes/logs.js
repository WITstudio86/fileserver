const { getServiceByToken, addActivityLog, getActivityLogs } = require('../db');

module.exports = function logsRoutes(db) {
  const router = require('express').Router();

  // GET /api/logs/:serviceId?token=xxx&user=yyy
  router.get('/:serviceId', (req, res) => {
    const { serviceId } = req.params;
    const { token, user } = req.query;

    if (!token) {
      return res.status(401).json({ error: '缺少 token' });
    }

    const service = getServiceByToken(db, token);
    if (!service || service.id !== serviceId) {
      return res.status(403).json({ error: '无权访问此服务的日志' });
    }

    const logs = getActivityLogs(db, serviceId, user || null);
    res.json({ logs });
  });

  // POST /api/logs/:serviceId
  router.post('/:serviceId', (req, res) => {
    const { serviceId } = req.params;
    const { token, userName, action, detail } = req.body;

    if (!token) {
      return res.status(401).json({ error: '缺少 token' });
    }
    if (!userName || !action) {
      return res.status(400).json({ error: '缺少 userName 或 action' });
    }

    const service = getServiceByToken(db, token);
    if (!service || service.id !== serviceId) {
      return res.status(403).json({ error: '无权操作此服务' });
    }

    addActivityLog(db, serviceId, userName, action, detail);
    res.json({ success: true });
  });

  return router;
};
