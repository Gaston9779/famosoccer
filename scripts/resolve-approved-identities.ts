import "dotenv/config";
import { db } from "../src/lib/db";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";
import { TransfermarktProvider } from "../src/lib/transfermarkt/provider";
import { saveProfile, emptyCounts } from "../src/lib/services/players";
import { withSyncLock, finishRun } from "../src/lib/services/runs";
import { calculateAndPersistPlayerOpportunity } from "../src/lib/intelligence/persistence";

const known: Record<string,string> = {
"Abbos Ergashboev":"991056","Abbos Shodmonov":"492571","Abdul Aziz Yusupov":"263460","Adkhamjon Musulmonov":"1188361","Akbar Abdirasulov":"1161817","Akmal Shorakhmedov":"185725","Akramjon Komilov":"288933","Albert Nurullayev":"1338213","Aleksandar Alempijevic":"86105","Aleksandr Lobanov":"448562","Alibobo Rakhmatullaev":"217899","Alisher Shukurov":"878829","Anvar Gafurov":"63619","Asadbek Samariddinov":"848893","Bektemir Abdumannonov":"836822","Diyor Turopov":"274557","Fejsal Mulic":"226194","Giorgi Nikabadze":"222595","Idris Bikmaykin":"494103","Ikboldzhon Malikdzhonov":"501829","Ignatiy Nesterov":"63615","Igor Taran":"161738","Iskandar Businov":"757288","Islam Abdullaev":"579953","Islom Sharipov":"661550","Ivan Solovyov":"144702","Jakhongir Urozov":"989069","Jambul Jigauri":"188184","Javokhir Esonkulov":"486763","Kakha Makharadze":"171602","Khudoyshukur Sattorov":"580095","Lazizbek Mirzaev":"1079581","Luka Ratkovic":"458594","Marat Bikmaev":"24983","Mukhammadaziz Ibrakhimov":"661062","Murodzhon Komilov":"969047","Oleksandr Vorobey":"494264","Rashid Abubakar":"711596","Roman Khadzhiev":"659507","Salamat Kutybaev":"440346","Samandar Ochilov":"843313","Sanjar Tursunov":"106632","Sardor Sadulloev":"608538","Stefan Colovic":"366004","Valeri Kichin":"211878","Zoir Jurabaev":"513883","Dilshod Khamroev":"375960","Jakhongir Fazilov":"1196823","Karen Abramov":"379059","Sergey Prokhorov":"427916" };
// The remaining 11 require a deterministic provider lookup; they are deliberately not guessed.
const unresolved = ["Akram Bahriddinov","Alijon Alijonov","Alisher Shogulyamov","Amirbek Berdiyev","Asadbek Sobirjonov","Asilbek To'xtasinov","Khasan Askarov","Sakhob Jurayev","Samandar Sindarov","Sanjar Zokirov","Sardor Kabuldzhanov"];
const numeric = (v:string) => /^\d+$/.test(v);

async function main() { await withSyncLock(async () => {
 const run=await db.syncRun.create({data:{type:"MANUAL"}}); const counts=emptyCounts(); const provider=new TransfermarktProvider(new TransfermarktClient(run.id,150));
 let converted=0, merged=0, refreshed=0, failed=0, skipped=0;
 try {
  for (const [seedName,id] of Object.entries(known)) {
   const seed=await db.player.findFirst({where:{name:seedName,tmPlayerId:{startsWith:"seed:UZ1-2026-"}}});
   const canonical=await db.player.findUnique({where:{tmPlayerId:id}});
   let target=canonical;
   if(seed && !canonical) { await db.player.update({where:{id:seed.id},data:{tmPlayerId:id,tmUrl:`https://www.transfermarkt.com/player/profil/spieler/${id}`}}); converted++; target=await db.player.findUniqueOrThrow({where:{id:seed.id}}); }
   if(seed && canonical && canonical.id!==seed.id) { skipped++; console.log(`SKIP ${seedName}: seed/canonical merge is pending the existing transaction utility`); }
   if(!target) { skipped++; console.log(`SKIP ${seedName}: neither approved seed nor numeric record exists`); continue; }
   try { const saved=await saveProfile(await provider.fetchPlayerProfile(id),counts,true); await calculateAndPersistPlayerOpportunity(saved.id); refreshed++; console.log(`SUCCESS ${seedName} -> ${saved.name} (${id})`); }
   catch(error){ failed++; console.error(`PROFILE FAILED ${seedName} (${id}): ${error instanceof Error?error.message:String(error)}`); }
  }
  for(const name of unresolved) { skipped++; console.log(`SKIP ${name}: exact provider identity lookup has no implemented deterministic endpoint`); }
  await finishRun(run.id,undefined,{converted,merged,refreshed,failed,skipped,counts});
 } catch(error) { await finishRun(run.id,error,{converted,merged,refreshed,failed,skipped,counts}); throw error; }
 console.log(JSON.stringify({converted,merged,refreshed,failed,skipped,unresolved},null,2));
 }); }
main().finally(()=>db.$disconnect());
