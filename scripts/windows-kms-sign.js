/**
 * Custom Windows code signing script for electron-builder.
 *
 * Invoked by electron-builder via `signtoolOptions.sign` for each file
 * that needs an Authenticode signature. Uses Google Cloud KMS as the HSM
 * backend via the Windows CNG provider — the private key never leaves GCP.
 *
 * Requires:
 *   - Google Cloud KMS CNG Provider installed on the build machine
 *   - GCP authentication (GOOGLE_APPLICATION_CREDENTIALS set by WIF)
 *   - Environment variables: USE_KMS_SIGNING, GCP_PROJECT_ID, GCP_KMS_LOCATION,
 *     GCP_KMS_KEY_RING, GCP_KMS_KEY_NAME, GCP_KMS_KEY_VERSION
 *   - Public leaf certificate, supplied at runtime via *one* of:
 *       - WIN_SIGN_CERT_PATH    — path to an existing .crt file
 *       - WIN_SIGN_CERT_BASE64  — base64-encoded cert bytes; decoded to a
 *                                 temp file by this script
 *     The cert is NEVER stored in source control; the CI workflow hands it
 *     in from a GitHub secret. The private key for this cert lives in GCP
 *     KMS.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// signtool requires HTTP for RFC 3161 timestamp URLs (HTTPS is not supported)
const TIMESTAMP_URL = 'http://timestamp.sectigo.com';

const REQUIRED_ENV_VARS = [
  'GCP_PROJECT_ID',
  'GCP_KMS_LOCATION',
  'GCP_KMS_KEY_RING',
  'GCP_KMS_KEY_NAME',
  'GCP_KMS_KEY_VERSION',
];

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

// Resolve the codesign leaf cert at sign time from env. Two acceptable shapes:
//   1. WIN_SIGN_CERT_PATH points to an already-on-disk .crt
//   2. WIN_SIGN_CERT_BASE64 holds the cert bytes; we materialise them to a
//      runner-temp file. Decoding more than once (the hook fires per signed
//      binary) is harmless — same bytes, same path.
function getCertPath() {
  if (process.env.WIN_SIGN_CERT_PATH) {
    return process.env.WIN_SIGN_CERT_PATH;
  }
  if (process.env.WIN_SIGN_CERT_BASE64) {
    const tempPath = path.join(os.tmpdir(), 'windows-codesign.crt');
    if (!fs.existsSync(tempPath)) {
      fs.writeFileSync(tempPath, Buffer.from(process.env.WIN_SIGN_CERT_BASE64, 'base64'));
    }
    return tempPath;
  }
  throw new Error(
    'Windows codesign cert missing — set WIN_SIGN_CERT_PATH or WIN_SIGN_CERT_BASE64.',
  );
}

function getKmsKeyPath() {
  return [
    'projects',
    process.env.GCP_PROJECT_ID,
    'locations',
    process.env.GCP_KMS_LOCATION,
    'keyRings',
    process.env.GCP_KMS_KEY_RING,
    'cryptoKeys',
    process.env.GCP_KMS_KEY_NAME,
    'cryptoKeyVersions',
    process.env.GCP_KMS_KEY_VERSION,
  ].join('/');
}

function findSigntool() {
  const kitsRoot = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
  if (!fs.existsSync(kitsRoot)) {
    throw new Error(`Windows SDK not found at ${kitsRoot}`);
  }

  const versions = fs
    .readdirSync(kitsRoot)
    .filter((d) => d.startsWith('10.'))
    .sort()
    .reverse();

  for (const version of versions) {
    const candidate = path.join(kitsRoot, version, 'x64', 'signtool.exe');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`signtool.exe not found in ${kitsRoot}. Is the Windows SDK installed?`);
}

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`KMS signing enabled but missing environment variables: ${missing.join(', ')}`);
  }
}

function validateCert(certPath) {
  if (!fs.existsSync(certPath)) {
    throw new Error(
      `Signing certificate not found at ${certPath}. ` +
        'Workflow should provide it via WIN_SIGN_CERT_BASE64 (preferred) or WIN_SIGN_CERT_PATH.',
    );
  }
}

function runSigntool(signtoolPath, args) {
  return new Promise((resolve, reject) => {
    execFile(signtoolPath, args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`signtool failed (exit ${error.code}):\nstdout: ${stdout}\nstderr: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {import('electron-builder').CustomWindowsSignTaskConfiguration} configuration
 * @returns {Promise<void>}
 */
async function sign(configuration) {
  // Skip signing when KMS is not enabled (local dev, macOS/Linux CI)
  if (process.env.USE_KMS_SIGNING !== 'true') {
    return;
  }

  validateEnv();

  const certPath = getCertPath();
  validateCert(certPath);

  const signtoolPath = findSigntool();
  const kmsKeyPath = getKmsKeyPath();

  const args = buildSigntoolArgs(certPath, kmsKeyPath, configuration.path);

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await runSigntool(signtoolPath, args);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        console.warn(`signtool attempt ${attempt + 1} failed, retrying in ${RETRY_DELAY_MS}ms...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
}

exports.default = sign;

/**
 * Build the signtool argument array. Extracted as a pure function for testability.
 */
function buildSigntoolArgs(certPath, kmsKeyPath, filePath) {
  return [
    'sign',
    '/fd',
    'sha256',
    '/tr',
    TIMESTAMP_URL,
    '/td',
    'sha256',
    '/f',
    certPath,
    '/csp',
    'Google Cloud KMS Provider',
    '/kc',
    kmsKeyPath,
    filePath,
  ];
}

// Exported for testing
exports._internals = {
  getCertPath,
  getKmsKeyPath,
  validateEnv,
  buildSigntoolArgs,
  REQUIRED_ENV_VARS,
};
