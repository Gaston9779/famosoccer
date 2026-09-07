import assert from 'node:assert/strict';
const base=process.env.LOCAL_APP_URL??'http://127.0.0.1:3000';
const results=[];
async function get(path,status=200){const response=await fetch(`${base}${path}`);assert.equal(response.status,status,path);results.push({path,status:response.status});return response;}
const summary=await (await get('/api/dashboard/summary')).json();assert.equal(summary.playerCount,27);assert.equal(summary.clubCount,16);assert.equal(summary.coverage.rostersImported,1);
const player=summary.topPlayerOpportunities.find(p=>p.player.tmPlayerId==='481513');assert.ok(player);assert.equal(player.total,24);
const id=player.playerId;
assert.equal((await (await get('/api/opportunities/players?role=RB&minScore=20&sort=score_desc')).json()).items[0].playerId,id);
assert.ok((await (await get('/api/opportunities/clubs?role=AM')).json()).items.length);
assert.equal((await (await get('/api/matches')).json()).items.length,0);
assert.ok((await (await get('/api/events?unread=true&limit=20')).json()).items.length);
await get(`/api/players/${id}/notes`);await get(`/api/players/${id}/tags`);
await get('/api/opportunities/players?minScore=101',400);await get('/api/matches?limit=999',400);await get('/api/events?unread=garbage',400);await get('/api/players/missing/notes',404);
for(const path of ['/players','/clubs','/opportunities',`/players/${id}`]){const html=await (await get(path)).text();assert.match(html,/Koffi Kouao|Neftchi/);}
const invalidNote=await fetch(`${base}/api/players/${id}/notes`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:' '})});assert.equal(invalidNote.status,400);
console.log(JSON.stringify({results,invalidNoteStatus:invalidNote.status,sample:{name:player.player.name,total:player.total,confidence:player.confidence},coverage:summary.coverage,matchCount:summary.topMatches.length},null,2));
