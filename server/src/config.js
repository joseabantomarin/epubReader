import 'dotenv/config';
import path from 'node:path';

const required = (name) => {
  const v = process.env[name];
  if (!v || v.startsWith('replace-')) {
    throw new Error(`Missing required env var ${name}`);
  }
  return v;
};

export const config = {
  port: Number(process.env.PORT || 3001),
  jwtSecret: process.env.NODE_ENV === 'test' ? 'test-secret-not-for-prod' : required('JWT_SECRET'),
  googleClientId: process.env.NODE_ENV === 'test' ? 'test-google-client-id' : required('GOOGLE_CLIENT_ID'),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 50),
  // Comma-separated emails that may censor shared books.
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
};

export function isAdminEmail(email) {
  return !!email && config.adminEmails.includes(String(email).toLowerCase());
}
