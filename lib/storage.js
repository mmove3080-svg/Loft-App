'use strict';
const {S3Client}=require('@aws-sdk/client-s3');
const {HttpError}=require('./security');
let client;
function storage() {
  const e = process.env;
  if (!e.R2_ENDPOINT || !e.R2_ACCESS_KEY_ID || !e.R2_SECRET_ACCESS_KEY || !e.R2_BUCKET_NAME) throw new HttpError(503, 'R2 storage is not configured.');
  const endpoint = new URL(e.R2_ENDPOINT);
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.r2.cloudflarestorage.com') || endpoint.pathname !== '/' || endpoint.search || endpoint.username || endpoint.password) throw new HttpError(503, 'Check R2_ENDPOINT: use the account S3 endpoint without a bucket path.');
  if (!client) client = new S3Client({region: e.R2_REGION || 'auto', endpoint: e.R2_ENDPOINT, credentials: {accessKeyId: e.R2_ACCESS_KEY_ID, secretAccessKey: e.R2_SECRET_ACCESS_KEY}});
  return {s3: client, Bucket: e.R2_BUCKET_NAME};
}
module.exports={storage};
