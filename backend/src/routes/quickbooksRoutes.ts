import express from 'express';
import { getAuthUrl, exchangeCodeAndSave } from '../integrations/quickbooks';
const router = express.Router();

// Returns the QuickBooks OAuth2 authorization URL to the frontend
router.get('/auth-url', async (req, res) => {
  try {
    const url = getAuthUrl();
    res.json({ url });
  } catch (err) {
    console.error('quickbooks auth-url err', err);
    res.status(500).json({ error: 'failed' });
  }
});

// Callback endpoint (you can also implement this using a redirect URL that calls this server-side)
router.post('/callback', async (req, res) => {
  try {
    const { organizationId, code, realmId } = req.body;
    if (!organizationId || !code || !realmId) return res.status(400).json({ error: 'missing params' });
    const result = await exchangeCodeAndSave(organizationId, code, realmId);
    res.json({ ok: true, result });
  } catch (err) {
    console.error('quickbooks callback err', err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
