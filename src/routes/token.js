const { v4: uuidv4 } = require('uuid');
const {
  createToken,
  getToken,
  expireTokens,
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

const TOKEN_EXPIRE_HOURS = parseInt(process.env.TOKEN_EXPIRE_HOURS || '12', 10);

module.exports = function tokenRoutes(db) {
  const router = require('express').Router();

  // POST /api/token/create
  router.post('/create', (_req, res) => {
    const id = uuidv4();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRE_HOURS * 3600 * 1000).toISOString();
    createToken(db, id, expiresAt);
    res.json({ token: id, expiresInHours: TOKEN_EXPIRE_HOURS });
  });

  // GET /api/token/status/:id
  router.get('/status/:id', (req, res) => {
    const { id } = req.params;
    expireTokens(db);
    const token = getToken(db, id);
    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }
    let service = null;
    if (token.serviceId) {
      const { getServiceById } = require('../db');
      service = getServiceById(db, token.serviceId);
    }
    res.json({
      id: token.id,
      status: token.status,
      serviceId: token.serviceId,
      code: service ? service.code : null,
      maxUsers: service ? service.maxUsers : null,
      allowUpload: service ? !!service.allowUpload : null,
      sharePath: service ? service.sharePath : null,
      expiresAt: token.expiresAt,
    });
  });

  return router;
};

// Also export for use by service routes
module.exports.TOKEN_EXPIRE_HOURS = TOKEN_EXPIRE_HOURS;
