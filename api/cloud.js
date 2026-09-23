'use strict';
const {S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command} = require('@aws-sdk/client-s3');
const {HttpError, settings, owner, snapshotId, partId} = require('../lib/security');
const {manage} = require('../lib/snapshots');
const {syncIndex} = require('../lib/sync');
const {storage}=require('../lib/storage');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const cfg = settings();
    const action = req.query.action;
    if (action === 'config' && req.method === 'GET') return res.status(200).json({url: cfg.url, publishableKey: cfg.key});
    const uid = await owner(req, cfg);
    if (action === 'session' && req.method === 'GET') return res.status(200).json({owner: true});
    const {s3, Bucket} = storage();
    const prefix = 'loft-private/v1/' + uid + '/';
    if(action==='storage-usage'&&req.method==='GET'){
      const cursor=req.query.cursor;
      if(cursor&&(typeof cursor!=='string'||cursor.length>4096))throw new HttpError(400,'Invalid cursor.');
      const page=await s3.send(new ListObjectsV2Command({Bucket,Prefix:prefix,MaxKeys:1000,ContinuationToken:cursor||undefined}));
      const totals={sync:0,backups:0,other:0,objects:0};
      for(const file of page.Contents||[]){
        if(!file.Key.startsWith(prefix))throw new HttpError(503,'Unexpected storage response.');
        const path=file.Key.slice(prefix.length);
        totals[path.startsWith('sync/')?'sync':/^(parts|commits)\//.test(path)?'backups':'other']+=file.Size||0;totals.objects++;
      }
      return res.status(200).json({totals,cursor:page.NextContinuationToken||null});
    }
    if (action === 'list' && req.method === 'GET') {
      const token = req.query.cursor;
      if (token && (typeof token !== 'string' || token.length > 4096)) throw new HttpError(400, 'Invalid cursor.');
      const result = await s3.send(new ListObjectsV2Command({Bucket, Prefix: prefix + 'commits/', MaxKeys: 100, ContinuationToken: token || undefined}));
      return res.status(200).json({items: (result.Contents || []).map(x => ({id: x.Key.slice((prefix+'commits/').length).replace(/\.json$/, ''), savedAt: x.LastModified})), cursor: result.NextContinuationToken || null});
    }
    if(['sync-index','sync-cleanup','trash-restore','trash-purge'].includes(action)){
      let body=req.body;
      if(typeof body==='string'){try{body=JSON.parse(body);}catch{throw new HttpError(400,'Invalid JSON.');}}
      return res.status(200).json(await syncIndex({s3,Bucket,prefix,method:req.method,body,cleanup:action==='sync-cleanup',operation:action==='trash-restore'?'restore':action==='trash-purge'?'purge':undefined}));
    }
    const id = snapshotId(req.query.id);
    if (['browse','remove-record','cleanup','delete-snapshot'].includes(action)) {
      if (req.method !== (action === 'browse' ? 'GET' : 'POST')) throw new HttpError(405, 'Method not allowed.');
      let body=req.body || {};
      if(typeof body==='string'){try{body=JSON.parse(body);}catch{throw new HttpError(400,'Invalid JSON.');}}
      return res.status(200).json(await manage({s3,Bucket,prefix,id,action,body}));
    }
    const isPart = action === 'part' || action === 'sync-part';
    if (!isPart && action !== 'commit') throw new HttpError(400, 'Unknown action.');
    const key = prefix + (action === 'sync-part' ? 'sync/parts/' + id + '/' + partId(req.query.part) : isPart ? 'parts/' + id + '/' + partId(req.query.part) : 'commits/' + id + '.json');
    if (req.method === 'GET') {
      const result = await s3.send(new GetObjectCommand({Bucket, Key: key}));
      const body = await result.Body.transformToByteArray();
      if (!isPart && JSON.parse(Buffer.from(body).toString()).deleting) throw new HttpError(409, 'This backup is being deleted.');
      res.setHeader('Content-Type', isPart ? 'application/octet-stream' : 'application/json');
      return res.status(200).send(Buffer.from(body));
    }
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new HttpError(400, 'Invalid JSON.'); } }
    let bytes;
    if (isPart) {
      if (!body || typeof body.data !== 'string' || body.data.length > 1398104 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) throw new HttpError(400, 'Invalid upload part.');
      bytes = Buffer.from(body.data, 'base64');
      if (bytes.length > 1048576) throw new HttpError(413, 'Upload part too large.');
    } else {
      if (!body || body.version !== 1 || !Array.isArray(body.records) || !Number.isInteger(body.parts) || body.parts < 0 || body.parts > 1000000) throw new HttpError(400, 'Invalid snapshot.');
      bytes = Buffer.from(JSON.stringify(body));
      if (bytes.length > 3000000) throw new HttpError(413, 'Snapshot metadata too large.');
    }
    await s3.send(new PutObjectCommand({Bucket, Key: key, Body: bytes, ContentType: isPart ? 'application/octet-stream' : 'application/json', CacheControl: 'private, no-store', IfNoneMatch: '*'}));
    return res.status(201).json({saved: true});
  } catch (err) {
    const status = err.status || (err.$metadata && err.$metadata.httpStatusCode === 404 ? 404 : err.$metadata && err.$metadata.httpStatusCode === 412 ? 409 : 503);
    return res.status(status).json({error: err.status ? err.message : status === 404 ? 'Snapshot or part not found.' : status === 409 ? 'This backup changed or the part already exists. Refresh and try again.' : 'Cloud storage request failed. Check the R2 configuration and try again.'});
  }
};
