const { v4: uuidv4 } = require('uuid');
const {
  getToken,
  markTokenUsed,
  createService,
  startService,
  closeService,
  getServiceByToken,
  getServiceByCode,
  checkCodeExists,
  addActivityLog,
  getActivityLogs,
} = require('../db');

module.exports = function serviceRoutes(db) {
  const router = require('express').Router();

  // POST /api/service/register
  router.post('/register', (req, res) => {
    const { token, code, maxUsers, allowUpload, sharePath } = req.body;

    if (!token) {
      return res.status(400).json({ error: '缺少 token' });
    }
    if (!code || !/^\d{4}$/.test(code)) {
      return res.status(400).json({ error: '加入码必须是 4 位数字' });
    }

    if (checkCodeExists(db, code)) {
      return res.status(409).json({ error: '该加入码已被使用，请换一个' });
    }

    const tokenRow = getToken(db, token);
    if (!tokenRow) {
      return res.status(404).json({ error: 'Token 不存在' });
    }
    if (tokenRow.status !== 'unused') {
      return res.status(400).json({ error: 'Token 已使用或已过期' });
    }

    const serviceId = uuidv4();
    createService(db, serviceId, token, code, maxUsers || 10, !!allowUpload, sharePath || '');
    markTokenUsed(db, token, serviceId);

    res.json({ serviceId });
  });

  // POST /api/service/start
  router.post('/start', (req, res) => {
    const { token } = req.body;

    const tokenRow = getToken(db, token);
    if (!tokenRow || tokenRow.status !== 'used') {
      return res.status(400).json({ error: 'Token 无效' });
    }

    const service = getServiceByToken(db, token);
    if (!service) {
      return res.status(404).json({ error: '服务不存在' });
    }

    startService(db, token);
    res.json({ success: true, serviceId: service.id });
  });

  // POST /api/service/close
  router.post('/close', (req, res) => {
    const { token } = req.body;

    const tokenRow = getToken(db, token);
    if (!tokenRow || tokenRow.status !== 'used') {
      return res.status(400).json({ error: 'Token 无效' });
    }

    const service = getServiceByToken(db, token);
    if (!service) {
      return res.status(404).json({ error: '服务不存在' });
    }

    closeService(db, token);
    res.json({ success: true });
  });

  // GET /api/service/:code
  router.get('/:code', (req, res) => {
    const { code } = req.params;
    if (!/^\d{4}$/.test(code)) {
      return res.status(400).json({ error: '加入码格式错误' });
    }

    const service = getServiceByCode(db, code);
    if (!service) {
      return res.json({ found: false });
    }

    res.json({
      found: true,
      serviceId: service.serviceId,
      allowUpload: service.allowUpload,
      currentUsers: service.currentUsers,
      maxUsers: service.maxUsers,
    });
  });

  return router;
};
