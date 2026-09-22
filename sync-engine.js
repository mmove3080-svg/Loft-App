/* Three-way merge planning. No network or database writes occur in this module. */
(function(root){
 'use strict';
 const keyOf=e=>JSON.stringify([e.store,e.id]);
 const stamp=e=>!e||e.deleted?'deleted':e.hash;
 function plan(local,remote,base={},choices={}){
  const l=new Map(local.map(e=>[keyOf(e),e])),r=new Map(remote.map(e=>[keyOf(e),e]));
  const keys=new Set([...l.keys(),...r.keys(),...Object.keys(base)]),push=[],pull=[],conflicts=[],next={};
  for(const key of keys){
   const le=l.get(key),re=r.get(key),ls=stamp(le),rs=stamp(re),b=base[key];
   if(ls===rs){next[key]=ls;continue;}
   let direction;
   const choice=choices[key];
   if(choice&&choice.local===ls&&choice.remote===rs)direction=choice.direction;
   else if(b===undefined){if(!le)direction='pull';else if(!re)direction='push';}
   else if(ls===b)direction='pull';else if(rs===b)direction='push';
   if(!direction){conflicts.push({key,local:le,remote:re,localStamp:ls,remoteStamp:rs});continue;}
   const [store,id]=JSON.parse(key);
   if(direction==='push'){push.push(le||{store,id,deleted:true});next[key]=ls;}
   else{pull.push(re||{store,id,deleted:true});next[key]=rs;}
  }
  return {push,pull,conflicts,base:next};
 }
 const api={keyOf,stamp,plan};root.LoftSyncEngine=api;
 if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
