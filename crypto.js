(function attachTabVaultCrypto(globalObject) {
  'use strict';

  const ENCRYPTED_FORMAT = 'chrome-tab-vault-encrypted';
  const ENCRYPTION_VERSION = 1;
  const ENCRYPTION_ALGORITHM = 'AES-GCM';
  const ENCRYPTION_KEY_LENGTH = 256;
  const ENCRYPTION_TAG_LENGTH = 128;
  const KDF_ALGORITHM = 'PBKDF2';
  const KDF_HASH = 'SHA-256';
  const KDF_ITERATIONS = 600000;
  const MIN_KDF_ITERATIONS = 100000;
  const MAX_KDF_ITERATIONS = 2000000;
  const SALT_LENGTH = 16;
  const IV_LENGTH = 12;
  const MIN_PASSWORD_LENGTH = 8;
  const ENCRYPTED_TXT_HEADER = '# Chrome Tab Vault Encrypted TXT v1';

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function getCryptoProvider() {
    if (globalObject.crypto && globalObject.crypto.subtle) {
      return globalObject.crypto;
    }

    if (typeof require === 'function') {
      try {
        return require('node:crypto').webcrypto;
      } catch (error) {
        // Browser builds do not expose require. Fall through to the
        // user-facing error if Web Crypto is unavailable.
      }
    }

    throw new Error('This browser does not support the Web Crypto API required for encrypted backups.');
  }

  function getTextEncoder() {
    if (typeof globalObject.TextEncoder !== 'function') {
      throw new Error('This browser cannot encode encrypted backup content.');
    }
    return new globalObject.TextEncoder();
  }

  function getTextDecoder() {
    if (typeof globalObject.TextDecoder !== 'function') {
      throw new Error('This browser cannot decode encrypted backup content.');
    }
    return new globalObject.TextDecoder('utf-8', { fatal: true });
  }

  function bytesToBase64(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);

    if (typeof globalObject.btoa === 'function') {
      let binary = '';
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      }
      return globalObject.btoa(binary);
    }

    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }

    throw new Error('This browser cannot encode encrypted backup data.');
  }

  function isBase64(value) {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length % 4 === 0 &&
      /^[a-zA-Z0-9+/]*={0,2}$/.test(value)
    );
  }

  function base64ToBytes(value, fieldName) {
    if (!isBase64(value)) {
      throw new Error(`The encrypted backup has invalid ${fieldName} data.`);
    }

    let binary;
    try {
      if (typeof globalObject.atob === 'function') {
        binary = globalObject.atob(value);
      } else if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(value, 'base64'));
      } else {
        throw new Error('Base64 decoding is unavailable.');
      }
    } catch (error) {
      throw new Error(`The encrypted backup has invalid ${fieldName} data.`);
    }

    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function passwordLength(password) {
    return typeof password === 'string' ? Array.from(password).length : 0;
  }

  function validatePayloadFormat(value) {
    if (value !== 'json' && value !== 'txt') {
      throw new Error('The encrypted backup has an unsupported payload format.');
    }
    return value;
  }

  function normalizeEncryptedEnvelope(input) {
    if (!isObject(input) || input.format !== ENCRYPTED_FORMAT) {
      throw new Error('The file is not a Chrome Tab Vault encrypted backup.');
    }
    if (input.version !== ENCRYPTION_VERSION) {
      throw new Error(`Encrypted backup version ${String(input.version)} is not supported.`);
    }
    if (!isObject(input.encryption) || input.encryption.name !== ENCRYPTION_ALGORITHM) {
      throw new Error('The encrypted backup uses an unsupported encryption algorithm.');
    }
    if (
      input.encryption.keyLength !== ENCRYPTION_KEY_LENGTH ||
      input.encryption.tagLength !== ENCRYPTION_TAG_LENGTH
    ) {
      throw new Error('The encrypted backup uses unsupported AES-GCM parameters.');
    }
    if (
      !isObject(input.keyDerivation) ||
      input.keyDerivation.name !== KDF_ALGORITHM ||
      input.keyDerivation.hash !== KDF_HASH
    ) {
      throw new Error('The encrypted backup uses an unsupported password key derivation method.');
    }
    if (
      !Number.isSafeInteger(input.keyDerivation.iterations) ||
      input.keyDerivation.iterations < MIN_KDF_ITERATIONS ||
      input.keyDerivation.iterations > MAX_KDF_ITERATIONS
    ) {
      throw new Error('The encrypted backup has an unsafe password iteration count.');
    }

    for (const [value, fieldName] of [
      [input.encryption.iv, 'initialization vector'],
      [input.keyDerivation.salt, 'salt'],
      [input.ciphertext, 'ciphertext']
    ]) {
      if (!isBase64(value)) {
        throw new Error(`The encrypted backup has invalid ${fieldName} data.`);
      }
    }

    return {
      format: ENCRYPTED_FORMAT,
      version: ENCRYPTION_VERSION,
      payloadFormat: validatePayloadFormat(input.payloadFormat),
      encryption: {
        name: ENCRYPTION_ALGORITHM,
        keyLength: ENCRYPTION_KEY_LENGTH,
        tagLength: ENCRYPTION_TAG_LENGTH,
        iv: input.encryption.iv
      },
      keyDerivation: {
        name: KDF_ALGORITHM,
        hash: KDF_HASH,
        iterations: input.keyDerivation.iterations,
        salt: input.keyDerivation.salt
      },
      ciphertext: input.ciphertext
    };
  }

  function envelopeAdditionalData(envelope) {
    return getTextEncoder().encode(JSON.stringify({
      format: envelope.format,
      version: envelope.version,
      payloadFormat: envelope.payloadFormat,
      encryption: {
        name: envelope.encryption.name,
        keyLength: envelope.encryption.keyLength,
        tagLength: envelope.encryption.tagLength
      },
      keyDerivation: {
        name: envelope.keyDerivation.name,
        hash: envelope.keyDerivation.hash,
        iterations: envelope.keyDerivation.iterations
      }
    }));
  }

  async function deriveEncryptionKey(password, salt, iterations, usages) {
    const cryptoProvider = getCryptoProvider();
    const passwordKey = await cryptoProvider.subtle.importKey(
      'raw',
      getTextEncoder().encode(password),
      KDF_ALGORITHM,
      false,
      ['deriveKey']
    );

    return cryptoProvider.subtle.deriveKey(
      {
        name: KDF_ALGORITHM,
        hash: KDF_HASH,
        salt,
        iterations
      },
      passwordKey,
      {
        name: ENCRYPTION_ALGORITHM,
        length: ENCRYPTION_KEY_LENGTH
      },
      false,
      usages
    );
  }

  async function encryptBackupContent(plaintext, password, payloadFormat) {
    if (typeof plaintext !== 'string') {
      throw new Error('Backup content must be text before it can be encrypted.');
    }
    if (passwordLength(password) < MIN_PASSWORD_LENGTH) {
      throw new Error(`Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const cryptoProvider = getCryptoProvider();
    const salt = cryptoProvider.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = cryptoProvider.getRandomValues(new Uint8Array(IV_LENGTH));
    const envelope = {
      format: ENCRYPTED_FORMAT,
      version: ENCRYPTION_VERSION,
      payloadFormat: validatePayloadFormat(payloadFormat),
      encryption: {
        name: ENCRYPTION_ALGORITHM,
        keyLength: ENCRYPTION_KEY_LENGTH,
        tagLength: ENCRYPTION_TAG_LENGTH,
        iv: bytesToBase64(iv)
      },
      keyDerivation: {
        name: KDF_ALGORITHM,
        hash: KDF_HASH,
        iterations: KDF_ITERATIONS,
        salt: bytesToBase64(salt)
      },
      ciphertext: ''
    };
    const key = await deriveEncryptionKey(password, salt, KDF_ITERATIONS, ['encrypt']);
    const ciphertext = await cryptoProvider.subtle.encrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv,
        additionalData: envelopeAdditionalData(envelope),
        tagLength: ENCRYPTION_TAG_LENGTH
      },
      key,
      getTextEncoder().encode(plaintext)
    );
    envelope.ciphertext = bytesToBase64(ciphertext);
    return envelope;
  }

  async function decryptBackupContent(envelopeInput, password) {
    if (passwordLength(password) === 0) {
      throw new Error('Enter the password used to encrypt this backup.');
    }

    const envelope = normalizeEncryptedEnvelope(envelopeInput);
    const salt = base64ToBytes(envelope.keyDerivation.salt, 'salt');
    const iv = base64ToBytes(envelope.encryption.iv, 'initialization vector');
    const ciphertext = base64ToBytes(envelope.ciphertext, 'ciphertext');
    if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH) {
      throw new Error('The encrypted backup has invalid encryption parameters.');
    }

    try {
      const cryptoProvider = getCryptoProvider();
      const key = await deriveEncryptionKey(
        password,
        salt,
        envelope.keyDerivation.iterations,
        ['decrypt']
      );
      const plaintext = await cryptoProvider.subtle.decrypt(
        {
          name: ENCRYPTION_ALGORITHM,
          iv,
          additionalData: envelopeAdditionalData(envelope),
          tagLength: ENCRYPTION_TAG_LENGTH
        },
        key,
        ciphertext
      );
      return {
        payloadFormat: envelope.payloadFormat,
        plaintext: getTextDecoder().decode(plaintext)
      };
    } catch (error) {
      throw new Error('The password is incorrect or the encrypted backup has been altered.');
    }
  }

  function serializeEncryptedEnvelope(envelopeInput, fileFormat) {
    const envelope = normalizeEncryptedEnvelope(envelopeInput);
    const normalizedFileFormat = validatePayloadFormat(fileFormat);
    if (normalizedFileFormat !== envelope.payloadFormat) {
      throw new Error('Encrypted backup payload and file formats do not match.');
    }

    const json = JSON.stringify(envelope, null, 2);
    if (normalizedFileFormat === 'json') {
      return `${json}\n`;
    }

    return [
      ENCRYPTED_TXT_HEADER,
      '# All tab URLs and metadata below are encrypted.',
      json,
      ''
    ].join('\n');
  }

  function parseEncryptedEnvelope(text) {
    if (typeof text !== 'string') {
      throw new Error('Encrypted backup content must be text.');
    }

    const trimmed = text.trim();
    const hasTxtHeader = trimmed.startsWith(ENCRYPTED_TXT_HEADER);
    let jsonText = trimmed;
    if (hasTxtHeader) {
      const jsonStart = trimmed.indexOf('{');
      if (jsonStart < 0) {
        throw new Error('The encrypted TXT backup is missing its encrypted data.');
      }
      jsonText = trimmed.slice(jsonStart);
    } else if (!trimmed.startsWith('{')) {
      return null;
    }

    let candidate;
    try {
      candidate = JSON.parse(jsonText);
    } catch (error) {
      if (hasTxtHeader || /"format"\s*:\s*"chrome-tab-vault-encrypted"/.test(jsonText)) {
        throw new Error('The encrypted backup envelope is invalid or incomplete.');
      }
      return null;
    }

    if (!isObject(candidate) || candidate.format !== ENCRYPTED_FORMAT) {
      if (hasTxtHeader) {
        throw new Error('The encrypted TXT backup has an invalid envelope.');
      }
      return null;
    }

    return normalizeEncryptedEnvelope(candidate);
  }

  const api = {
    ENCRYPTED_FORMAT,
    ENCRYPTED_TXT_HEADER,
    ENCRYPTION_VERSION,
    MIN_PASSWORD_LENGTH,
    decryptBackupContent,
    encryptBackupContent,
    parseEncryptedEnvelope,
    serializeEncryptedEnvelope
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    globalObject.TabVaultCrypto = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
