const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs');
test('service worker never intercepts private API or authenticated requests',()=>{
 const handlers={};const context={URL,Set,self:{location:{href:'https://app.test/sw.js',origin:'https://app.test'},addEventListener:(name,fn)=>handlers[name]=fn},caches:{open:()=>Promise.resolve({match:async()=>({})})},fetch:async()=>({})};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../sw.js'),'utf8'),context);
 for(const path of ['/api/cloud?action=config','/api/cloud?action=list','/auth/callback','/notes.json','/index.html?token=x']){
  let handled=false;handlers.fetch({request:{method:'GET',url:'https://app.test'+path,headers:new Headers()},respondWith:()=>handled=true});assert.equal(handled,false,path);
 }
 let handled=false;handlers.fetch({request:{method:'GET',url:'https://app.test/index.html',headers:new Headers({Authorization:'Bearer token'})},respondWith:()=>handled=true});assert.equal(handled,false);
 handlers.fetch({request:{method:'GET',url:'https://app.test/cloud.js',headers:new Headers()},respondWith:()=>handled=true});assert.equal(handled,true);
});
