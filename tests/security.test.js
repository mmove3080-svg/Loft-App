const test = require('node:test');
const assert = require('node:assert/strict');
const {owner, settings, snapshotId, partId} = require('../lib/security');
const cfg = {url:'https://example.supabase.co', key:'publishable', owner:'owner-id'};
test('rejects missing token without contacting auth', async () => {
  await assert.rejects(owner({headers:{}}, cfg, () => {throw new Error('must not call');}), {status:401});
});
test('rejects authenticated users other than owner', async () => {
  await assert.rejects(owner({headers:{authorization:'Bearer token'}}, cfg, async () => ({ok:true,json:async()=>({id:'other'})})), {status:403});
});
test('validates token with Supabase before accepting owner', async () => {
  let called = false;
  const result = await owner({headers:{authorization:'Bearer token'}}, cfg, async (url, options) => {
    assert.equal(url, cfg.url+'/auth/v1/user'); assert.equal(options.headers.Authorization,'Bearer token'); called = true;
    return {ok:true,json:async()=>({id:'owner-id'})};
  });
  assert.equal(result,'owner-id'); assert.equal(called,true);
});
test('rejects expired credentials and auth outage', async () => {
  await assert.rejects(owner({headers:{authorization:'Bearer old'}}, cfg, async()=>({ok:false,status:401})),{status:401});
  await assert.rejects(owner({headers:{authorization:'Bearer old'}}, cfg, async()=>{throw new Error('offline')}),{status:503});
});
test('fails closed when configuration missing',()=>{
  assert.throws(()=>settings({}),{status:503});
});
test('rejects path traversal and malformed part IDs',()=>{
  for(const id of ['../other','x','',null]) assert.throws(()=>snapshotId(id),{status:400});
  for(const id of ['../0','-1','1.2','01',null]) assert.throws(()=>partId(id),{status:400});
  assert.equal(partId('0'),'0');
  assert.equal(snapshotId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});
test('all private API actions reject unauthenticated calls', async()=>{
  process.env.SUPABASE_URL=cfg.url;process.env.SUPABASE_PUBLISHABLE_KEY=cfg.key;process.env.APP_OWNER_USER_ID=cfg.owner;
  const handler=require('../api/cloud');
  for(const action of ['session','list','part','commit','browse','remove-record','cleanup','delete-snapshot','sync-index','sync-part','sync-cleanup']) {
    let status, body; const headers={};
    const res={setHeader:(k,v)=>headers[k]=v,status:s=>{status=s;return res;},json:v=>{body=v;return res;}};
    await handler({headers:{},method:'GET',query:{action}},res);
    assert.equal(status,401);assert.match(headers['Cache-Control'],/no-store/);assert.equal(body.error,'Please sign in.');
  }
});
