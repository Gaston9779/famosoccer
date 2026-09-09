import "dotenv/config";
import { db } from "../src/lib/db";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";
import { saveProfile } from "../src/lib/services/players";
import { finishRun, withSyncLock } from "../src/lib/services/runs";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { ProviderError } from "../src/lib/transfermarkt/errors";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";
const ids=["1419072","1524911","903133","1405292"];
async function main(){await withSyncLock(async()=>{const ps=await db.player.findMany({where:{tmPlayerId:{in:ids}}});if(ps.length!==4)throw Error("Expected 4 direct profiles");const run=await db.syncRun.create({data:{type:"UZ1_RESIDUAL_ROLE_PROFILES"}});const tm=new TransfermarktProvider(new TransfermarktClient(run.id,4));let done=0;try{for(const p of ps){const q=await tm.fetchPlayerProfile(p.tmPlayerId,p.tmUrl);const saved=await saveProfile(q);await db.player.update({where:{id:saved.id},data:{preferredFootSyncedAt:new Date()}});await calculateAndPersistPlayerOpportunity(saved.id);done++}await finishRun(run.id)}catch(e){await finishRun(run.id,e);if(e instanceof ProviderError&&["BLOCKED","STOPPED"].includes(e.code))return;throw e}finally{console.log(JSON.stringify({done}))}})}try{await main()}finally{await db.$disconnect()}
