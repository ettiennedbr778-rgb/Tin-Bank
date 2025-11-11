import axios from 'axios';
import db from '../db';
import dotenv from 'dotenv';
dotenv.config();

/*
  Minimal QuickBooks Online integration helper.
  - Uses OAuth2 (authorization code) flow. You must configure:
    QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, QUICKBOOKS_REDIRECT_URI
  - Stores tokens in external_mappings table with provider='quickbooks' and external_id = realmId
    metadata will hold access_token, refresh_token, expires_at (ms), and company info.
  - Provide functions: getAuthUrl, exchangeCodeAndSave, getAccessTokenForOrg, createInvoiceInQB
*/

const QB_AUTH_BASE = process.env.QUICKBOOKS_AUTH_BASE || 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = process.env.QUICKBOOKS_TOKEN_URL || 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_API_BASE = 'https://sandbox-quickbooks.api.intuit.com'; // change to production as needed

export function getAuthUrl() {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const redirect = process.env.QUICKBOOKS_REDIRECT_URI;
  const scope = encodeURIComponent('com.intuit.quickbooks.accounting');
  const url = `${QB_AUTH_BASE}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=${scope}&state=security_token`;
  return url;
}

export async function exchangeCodeAndSave(organizationId: string, code: string, realmId: string) {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const redirect = process.env.QUICKBOOKS_REDIRECT_URI;
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await axios.post(
    QB_TOKEN_URL,
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect }).toString(),
    { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const data = res.data;
  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  // upsert external_mappings entry keyed by provider, organization and realmId
  const metadata = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: expiresAt };
  await db.query(
    `INSERT INTO external_mappings (organization_id, provider, external_id, local_type, local_id, metadata) VALUES ($1,'quickbooks',$2,'company',NULL,$3)
    ON CONFLICT (provider, organization_id, external_id) DO UPDATE SET metadata = $3`,
    [organizationId, realmId, JSON.stringify(metadata)]
  );
  return { realmId, metadata };
}

async function refreshTokenIfNeeded(mappingRow: any) {
  const metadata = mappingRow.metadata || {};
  if (!metadata.refresh_token) throw new Error('no refresh token');
  if (metadata.expires_at && Date.now() < metadata.expires_at - 60000) return metadata.access_token; // still valid
  // refresh
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await axios.post(
    QB_TOKEN_URL,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: metadata.refresh_token }).toString(),
    { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const data = res.data;
  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  metadata.access_token = data.access_token;
  metadata.refresh_token = data.refresh_token || metadata.refresh_token;
  metadata.expires_at = expiresAt;
  // persist
  await db.query(`UPDATE external_mappings SET metadata = $1 WHERE id = $2`, [JSON.stringify(metadata), mappingRow.id]);
  return metadata.access_token;
}

export async function getMappingForRealm(organizationId: string, realmId: string) {
  const r = await db.query(`SELECT * FROM external_mappings WHERE organization_id=$1 AND provider='quickbooks' AND external_id=$2 LIMIT 1`, [organizationId, realmId]);
  return r.rows[0] || null;
}

export async function getAccessTokenForOrgByRealm(organizationId: string, realmId: string) {
  const mapping = await getMappingForRealm(organizationId, realmId);
  if (!mapping) throw new Error('quickbooks mapping not found');
  return await refreshTokenIfNeeded(mapping);
}

export async function createInvoiceInQB(organizationId: string, realmId: string, invoicePayload: any) {
  const accessToken = await getAccessTokenForOrgByRealm(organizationId, realmId);
  const url = `${QB_API_BASE}/v3/company/${realmId}/invoice?minorversion=59`;
  const res = await axios.post(url, invoicePayload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  return res.data;
}