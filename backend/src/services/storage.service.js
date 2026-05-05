const supabase = require('../utils/supabase');
const logger = require('../utils/logger');
const crypto = require('crypto');

const BUCKET_NAME = process.env.SUPABASE_BUCKET || 'testing-dms';

const uploadToS3 = async (buffer, key, mimeType, metadata = {}) => {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(key, buffer, {
        contentType: mimeType,
        upsert: true,
        metadata: metadata
      });

    if (error) throw error;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(key);

    return {
      key,
      url: publicUrl,
    };
  } catch (error) {
    logger.error('Supabase Upload Error:', error);
    throw error;
  }
};

const getPresignedUrl = async (key, expiresIn = 3600) => {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(key, expiresIn);

    if (error) {
      // Fallback to public URL if signed URL fails (e.g. bucket is public)
      const { data: { publicUrl } } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(key);
      return publicUrl;
    }

    return data.signedUrl;
  } catch (error) {
    logger.error('Supabase Signed URL Error:', error);
    return null;
  }
};

const deleteFromS3 = async (key) => {
  try {
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([key]);

    if (error) throw error;
    logger.info('File removed from Supabase', { key });
  } catch (error) {
    logger.error('Supabase Delete Error:', error);
    throw error;
  }
};

const generateS3Key = (patientId, docType, filename) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  const uid = crypto.randomUUID();
  
  return `documents/${year}/${month}/${patientId}/${docType}/${uid}-${sanitized}`;
};

module.exports = { uploadToS3, getPresignedUrl, deleteFromS3, generateS3Key };