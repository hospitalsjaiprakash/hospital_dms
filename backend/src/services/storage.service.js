const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const logger = require('../utils/logger');
const crypto = require('crypto');

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'jphospital-dms-storage';

const s3Client = new S3Client({
  region: process.env.S3_REGION || process.env.AWS_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const uploadToS3 = async (buffer, key, mimeType, metadata = {}) => {
  try {
    // Convert object values to strings for S3 metadata
    const stringMetadata = {};
    for (const [k, v] of Object.entries(metadata)) {
      if (v !== null && v !== undefined) {
        stringMetadata[k] = String(v);
      }
    }

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      Metadata: stringMetadata
    });

    await s3Client.send(command);

    // R2 doesn't return a public URL directly unless configured with a custom domain.
    // We will just return the key as the URL placeholder, and rely on getPresignedUrl for access.
    return {
      key,
      url: `r2://${BUCKET_NAME}/${key}`,
    };
  } catch (error) {
    logger.error('R2 Upload Error:', error);
    throw error;
  }
};

const getPresignedUrl = async (key, expiresIn = 3600, downloadName = null) => {
  try {
    const params = {
      Bucket: BUCKET_NAME,
      Key: key,
    };
    
    if (downloadName) {
      params.ResponseContentDisposition = `attachment; filename="${downloadName}"`;
    }

    const command = new GetObjectCommand(params);
    
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    logger.error('R2 Signed URL Error:', error);
    return null;
  }
};

const deleteFromS3 = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    
    await s3Client.send(command);
    logger.info('File removed from R2', { key });
  } catch (error) {
    logger.error('R2 Delete Error:', error);
    throw error;
  }
};

const generateS3Key = (patientIdentifier, docType, filename) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  const uid = crypto.randomUUID();
  
  return `documents/${year}/${month}/${patientIdentifier}/${docType}/${uid}-${sanitized}`;
};

module.exports = { uploadToS3, getPresignedUrl, deleteFromS3, generateS3Key };