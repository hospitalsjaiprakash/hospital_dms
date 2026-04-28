const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const logger = require('../utils/logger');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'hospital-dms-documents';

/**
 * Upload file buffer to S3
 */
const uploadToS3 = async (buffer, key, mimeType, metadata = {}) => {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    Metadata: metadata,
    ServerSideEncryption: 'AES256',
  });

  await s3Client.send(command);

  return {
    key,
    url: `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
  };
};

/**
 * Generate a pre-signed URL for secure file access (15 min expiry)
 */
const getPresignedUrl = async (key, expiresIn = 900) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
};

/**
 * Soft delete - move to archive folder
 */
const deleteFromS3 = async (key) => {
  // Move to archive prefix instead of hard delete
  const archiveKey = key.replace('documents/', 'archive/');
  const { CopyObjectCommand } = require('@aws-sdk/client-s3');

  await s3Client.send(new CopyObjectCommand({
    Bucket: BUCKET_NAME,
    CopySource: `${BUCKET_NAME}/${key}`,
    Key: archiveKey,
    ServerSideEncryption: 'AES256',
  }));

  await s3Client.send(new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  }));

  logger.info('File archived in S3', { originalKey: key, archiveKey });
};

/**
 * Generate organized S3 key
 * Format: documents/YYYY/MM/patientId/docType/uuid-filename
 */
const generateS3Key = (patientId, docType, filename) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  const { v4: uuidv4 } = require('crypto');
  const uid = require('crypto').randomUUID();
  return `documents/${year}/${month}/${patientId}/${docType}/${uid}-${sanitized}`;
};

module.exports = { uploadToS3, getPresignedUrl, deleteFromS3, generateS3Key };
