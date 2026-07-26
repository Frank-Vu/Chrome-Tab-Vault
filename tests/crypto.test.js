'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ENCRYPTED_FORMAT,
  ENCRYPTED_TXT_HEADER,
  decryptBackupContent,
  encryptBackupContent,
  parseEncryptedEnvelope,
  serializeEncryptedEnvelope
} = require('../crypto.js');

const PASSWORD = 'correct horse battery staple 🔐';
const SECRET_URL = 'https://private.example.test/account?token=secret';
const JSON_CONTENT = `${JSON.stringify({
  format: 'chrome-tab-vault',
  windows: [{ tabs: [{ url: SECRET_URL }] }]
}, null, 2)}\n`;
const TXT_CONTENT = `# Chrome Tab Vault TXT v1\n${SECRET_URL}\n`;

const jsonEnvelopePromise = encryptBackupContent(JSON_CONTENT, PASSWORD, 'json');
const txtEnvelopePromise = encryptBackupContent(TXT_CONTENT, PASSWORD, 'txt');

test('encrypted JSON serializes and decrypts without exposing backup content', async () => {
  const envelope = await jsonEnvelopePromise;
  const serialized = serializeEncryptedEnvelope(envelope, 'json');
  const parsed = parseEncryptedEnvelope(serialized);
  const decrypted = await decryptBackupContent(parsed, PASSWORD);

  assert.equal(parsed.format, ENCRYPTED_FORMAT);
  assert.equal(parsed.payloadFormat, 'json');
  assert.equal(serialized.includes(SECRET_URL), false);
  assert.deepEqual(decrypted, {
    payloadFormat: 'json',
    plaintext: JSON_CONTENT
  });
});

test('encrypted TXT has a recognizable header and decrypts without exposing backup content', async () => {
  const envelope = await txtEnvelopePromise;
  const serialized = serializeEncryptedEnvelope(envelope, 'txt');
  const parsed = parseEncryptedEnvelope(serialized);
  const decrypted = await decryptBackupContent(parsed, PASSWORD);

  assert.equal(serialized.startsWith(ENCRYPTED_TXT_HEADER), true);
  assert.equal(serialized.includes(SECRET_URL), false);
  assert.deepEqual(decrypted, {
    payloadFormat: 'txt',
    plaintext: TXT_CONTENT
  });
});

test('an incorrect password cannot decrypt a backup', async () => {
  const envelope = await jsonEnvelopePromise;

  await assert.rejects(
    decryptBackupContent(envelope, 'definitely the wrong password'),
    /password is incorrect or the encrypted backup has been altered/i
  );
});

test('AES-GCM authentication rejects modified ciphertext or metadata', async () => {
  const envelope = await jsonEnvelopePromise;
  const modifiedCiphertext = JSON.parse(JSON.stringify(envelope));
  modifiedCiphertext.ciphertext = `${
    modifiedCiphertext.ciphertext[0] === 'A' ? 'B' : 'A'
  }${modifiedCiphertext.ciphertext.slice(1)}`;

  await assert.rejects(
    decryptBackupContent(modifiedCiphertext, PASSWORD),
    /password is incorrect or the encrypted backup has been altered/i
  );

  const modifiedMetadata = JSON.parse(JSON.stringify(envelope));
  modifiedMetadata.payloadFormat = 'txt';
  await assert.rejects(
    decryptBackupContent(modifiedMetadata, PASSWORD),
    /password is incorrect or the encrypted backup has been altered/i
  );
});

test('plain backups are not mistaken for encrypted envelopes', () => {
  assert.equal(parseEncryptedEnvelope(JSON_CONTENT), null);
  assert.equal(parseEncryptedEnvelope(TXT_CONTENT), null);
});

test('malformed encrypted TXT and short export passwords are rejected', async () => {
  assert.throws(
    () => parseEncryptedEnvelope(`${ENCRYPTED_TXT_HEADER}\nmissing envelope`),
    /missing its encrypted data/i
  );
  await assert.rejects(
    encryptBackupContent(JSON_CONTENT, 'short', 'json'),
    /at least 8 characters/i
  );
});
