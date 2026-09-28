const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
test('authenticated upload retries are idempotent; part status verifies bytes without downloading them',async()=>{
 const oldFetch=global.fetch,oldEnv={...process.env},storage=require('../lib/storage'),oldStorage=storage.storage,objects=new Map();let getCount=0;
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='public';process.env.APP_OWNER_USER_ID='owner';global.fetch=async()=>new Response(JSON.stringify({id:'owner'}));
 storage.storage=()=>({Bucket:'b',s3:{send:async c=>{const x=c.input;if(c.constructor.name==='PutObjectCommand'){if(objects.has(x.Key))throw {$metadata:{httpStatusCode:412}};objects.set(x.Key,x);return {};}
 if(c.constructor.name==='HeadObjectCommand'){const o=objects.get(x.Key);if(!o)throw {$metadata:{httpStatusCode:404}};return {Metadata:o.Metadata,ContentLength:o.Body.length};}
 if(c.constructor.name==='GetObjectCommand'){getCount++;return {Body:{transformToByteArray:async()=>objects.get(x.Key).Body}};}throw Error(c.constructor.name);}}});
 delete require.cache[require.resolve('../api/cloud')];const handler=require('../api/cloud'),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const call=async(action,body,part='0')=>{let code,data;const res={setHeader(){},status(n){code=n;return this;},json(v){data=v;return this;}};await handler({method:body===undefined?'GET':'POST',headers:{authorization:'Bearer test'},query:{action,id,part},body},res);return {code,data};};
 try{
  const bytes=Buffer.from('original bytes');assert.equal((await call('part',{data:bytes.toString('base64')})).code,201);
  const status=await call('part-status');assert.equal(status.code,200);assert.deepEqual(status.data,{exists:true,hash:crypto.createHash('sha256').update(bytes).digest('hex'),size:bytes.length});assert.equal(getCount,0);
  assert.equal((await call('part',{data:bytes.toString('base64')})).code,201);assert.equal((await call('part',{data:Buffer.from('different').toString('base64')})).code,409);
  assert.deepEqual((await call('part-status',undefined,'1')).data,{exists:false});
  const manifest={version:1,records:[],parts:1};assert.equal((await call('commit',manifest)).code,201);assert.equal((await call('commit',manifest)).code,201);assert.equal((await call('commit',{...manifest,parts:2})).code,409);
 }finally{global.fetch=oldFetch;storage.storage=oldStorage;for(const k of Object.keys(process.env))if(!(k in oldEnv))delete process.env[k];Object.assign(process.env,oldEnv);delete require.cache[require.resolve('../api/cloud')];}
});
