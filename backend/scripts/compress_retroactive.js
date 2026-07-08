require('dotenv').config({ path: __dirname + '/../.env' }); // Load .env
const db = require('../src/db');
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { compressPDFToTarget } = require('../src/services/pdf.service');

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

const streamToBuffer = async (stream) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
};

async function run() {
  console.log('Starting retroactive PDF compression...');
  try {
    const res = await db.query("SELECT * FROM documents WHERE file_size > 1048576 AND mime_type = 'application/pdf' AND is_deleted = false");
    const docs = res.rows;
    console.log(`Found ${docs.length} documents > 1MB`);

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      console.log(`\nProcessing ${i+1}/${docs.length}: Doc ID ${doc.id} | Size: ${(doc.file_size/1024/1024).toFixed(2)}MB`);
      
      try {
        // Download from S3
        console.log(`Downloading ${doc.s3_key}...`);
        const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: doc.s3_key });
        const s3Object = await s3Client.send(getCmd);
        const originalBuffer = await streamToBuffer(s3Object.Body);
        
        console.log(`Compressing...`);
        const startTime = Date.now();
        const compressedBuffer = await compressPDFToTarget(originalBuffer);
        const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);

        if (compressedBuffer && compressedBuffer.length < originalBuffer.length) {
          console.log(`Compression successful: ${(originalBuffer.length/1024/1024).toFixed(2)}MB -> ${(compressedBuffer.length/1024/1024).toFixed(2)}MB in ${timeTaken}s`);
          
          const newS3Key = doc.s3_key.replace('.pdf', '_retro_compressed.pdf');
          console.log(`Uploading as ${newS3Key}...`);
          
          const putCmd = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: newS3Key,
            Body: compressedBuffer,
            ContentType: 'application/pdf',
          });
          await s3Client.send(putCmd);
          
          const fileUrl = `r2://${BUCKET_NAME}/${newS3Key}`;

          console.log('Updating database...');
          await db.query(
            `UPDATE documents SET s3_key = $1, file_url = $2, file_size = $3, is_compressed = true, updated_at = NOW() WHERE id = $4`,
            [newS3Key, fileUrl, compressedBuffer.length, doc.id]
          );

          console.log('Deleting old S3 object...');
          try {
            await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: doc.s3_key }));
          } catch (e) {
            console.warn(`Failed to delete old object ${doc.s3_key}`, e.message);
          }
          console.log('Done.');
        } else {
          console.log(`No compression benefit or failed.`);
        }
      } catch (err) {
        console.error(`Error processing doc ${doc.id}:`, err);
      }
    }
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    console.log('\nFinished all documents.');
    process.exit(0);
  }
}

run();
