const test=require('node:test'),assert=require('node:assert/strict');
const handler=require('../api/cleanup');
test('cron requires an exact, sufficiently long secret',()=>{
 const secret='x'.repeat(48);assert(handler.authorized('Bearer '+secret,secret));
 for(const [h,s] of [[undefined,secret],['Bearer wrong',secret],['Bearer short','short'],['Bearer '+secret,undefined],['bearer '+secret,secret]])assert.equal(handler.authorized(h,s),false);
});
test('unauthenticated cleanup never accesses storage',async()=>{
 let code,body;const res={setHeader(){},status(n){code=n;return this;},json(v){body=v;}};
 await handler({method:'GET',headers:{}},res);assert.equal(code,401);assert.equal(body.error,'Unauthorized.');
 await handler({method:'POST',headers:{}},res);assert.equal(code,405);
});
