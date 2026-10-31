import {WalletPilot} from './runner-core.mjs';
import {format} from './domain.mjs';
import {recoveryAdvice} from './recovery-advice.mjs';
const $=id=>document.getElementById(id);
const rows=(target,entries)=>{target.replaceChildren();for(const [label,value] of entries){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);target.append(dt,dd);}};
const tbot=n=>format(BigInt(n)).replace(/\.?0+$/,'')+' tBOT';
const safeError=e=>typeof e?.code==='string'&&/^[A-Z_]{4,70}$/.test(e.code)?e.code:'PROVIDER_OR_VERIFICATION_ERROR';
const assets=await(await fetch('./assets.json',{cache:'no-store'})).json();
let pilot=null,review=null,working=false,downloadRequested=false;
document.getElementById('arc-link').addEventListener('click',event=>{if(working||pilot?.state&&['requesting','unknown'].includes(pilot.state.phase)){event.preventDefault();status('Wallet request may still be active or its outcome is unknown. Preserve this page and reconcile the original request before changing chains.');}});
function display(snapshot){
 if(!snapshot){$('current').replaceChildren();$('history').replaceChildren();$('plan').replaceChildren();$('recovery').textContent='';$('recovery').hidden=true;$('new-run').disabled=true;$('download').disabled=true;return;}
 $('status').textContent=snapshot.message+(snapshot.phase==='complete'&&!pilot?.verifiedSession?' Saved completion must be revalidated before it is reported as verified.':'');
 const stage=['Receiver deployment','0.01 tBOT payment','Principal return'][snapshot.stageIndex]??'Complete';
 rows($('current'),[['Stage',stage],['Phase',snapshot.phase],['Original hash',snapshot.hash??'none'],['Receiver',snapshot.receiverAddress??'not deployed'],['Wallet approval',snapshot.phase==='requesting'?'Approve this exact transaction in your wallet':'none pending'],...(snapshot.intent?[['Target',snapshot.intent.to??'new receiver contract'],['Value',tbot(BigInt(snapshot.intent.value))],['Gas limit',BigInt(snapshot.intent.gas).toString()],['Gas price',BigInt(snapshot.intent.gasPrice).toString()+' wei'],['Maximum fee',tbot(snapshot.intent.maximumFeeWei)]]:[])]);
 const list=$('history');list.replaceChildren();for(const item of snapshot.receipts){const li=document.createElement('li');li.textContent=item.stage+' · '+item.hash+' · block '+item.blockNumber+' · fee '+item.actualFeeWei+' wei';list.append(li);}
 $('download').disabled=false;
 const recovery=$('recovery');
 recovery.textContent=recoveryAdvice(snapshot);
 recovery.hidden=!recovery.textContent;
 $('resume').disabled=working||!pilot?.account||['unknown','requesting','rejected','hold'].includes(snapshot.phase);
 $('start').disabled=true;$('review').disabled=true;
 $('new-run').disabled=working||!downloadRequested||snapshot.phase!=='complete'||!pilot?.verifiedSession;
}
function status(message){$('status').textContent=message;}
function setWorking(value){working=value;$('connect').disabled=value;$('review').disabled=value||!pilot?.account||!!pilot?.state;$('start').disabled=value||!review||!$('confirm').checked||!!pilot?.state;$('resume').disabled=value||!pilot?.account||!pilot?.state||['unknown','requesting','rejected','hold'].includes(pilot.state.phase);$('new-run').disabled=value||!downloadRequested||pilot?.state?.phase!=='complete'||!pilot?.verifiedSession;}
const withLock=async fn=>{
 if(!navigator.locks?.request)throw Error('BROWSER_LOCK_UNAVAILABLE');
 return navigator.locks.request('settleref-bot-968-wallet-runner',{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock)throw Error('ANOTHER_TAB_ACTIVE');return fn();});
};
if(!window.ethereum?.request){status('No injected wallet found. Use a browser with a user-controlled testnet wallet; live integration remains unqualified. The packaged Node tests use a fake provider.');$('connect').disabled=true;}
else{
 pilot=new WalletPilot({provider:window.ethereum,storage:localStorage,assets,withLock,onChange:({message,state})=>{if(state)display(state);status(message);}});
 try{const saved=pilot.load();if(saved){display(saved);status('Saved run retained. Reconnect the same account before any read-only recovery or next wallet prompt.');}}catch{status('Saved run is malformed. Do not send; preserve the browser data for review.');$('connect').disabled=true;}
}
$('connect').addEventListener('click',async()=>{setWorking(true);try{const account=await pilot.connect();$('account').textContent='Connected payer and receiver owner: '+account;setWorking(false);}catch(e){status('Stopped: '+safeError(e));setWorking(false);}});
$('review').addEventListener('click',async()=>{setWorking(true);try{review=await pilot.review();rows($('plan'),[['Network','BOT testnet 968 · pinned genesis '+review.genesisHash],['Connected account',review.account],['Existing settlement',review.settlement],['Steps','Deploy owned receiver → pay → withdraw to same account'],['Principal',tbot(review.principalWei)],['Total maximum app gas cap',tbot(review.totalFeeCapWei)],['Maximum fee per step',tbot(review.stepFeeCapWei)],['First-step estimated maximum fee',tbot(review.firstMaximumFeeWei)],['Receiver owner',review.receiverOwner]]);$('confirm').disabled=false;status('Review complete. Each stage is re-estimated; a changed fee above cap stops the run. Your wallet must approve each transaction.');}catch(e){status('Stopped: '+safeError(e));}finally{setWorking(false);}});
$('confirm').addEventListener('change',()=>setWorking(false));
$('start').addEventListener('click',async()=>{setWorking(true);try{await pilot.start({reviewConfirmed:$('confirm').checked});}catch(e){status('Stopped: '+safeError(e)+'. Preserve the original hash and export evidence; do not resend.');}finally{setWorking(false);if(pilot?.state)display(pilot.snapshot());}});
$('resume').addEventListener('click',async()=>{setWorking(true);try{await pilot.resume();}catch(e){status('Stopped: '+safeError(e)+'. Preserve the original hash and export evidence; do not resend.');}finally{setWorking(false);if(pilot?.state)display(pilot.snapshot());}});
$('download').addEventListener('click',()=>{if(!pilot?.state)return;try{const blob=new Blob([JSON.stringify(pilot.report(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='settleref-bot-testnet-wallet-run.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);downloadRequested=true;setWorking(false);status('Evidence download requested. Check that the JSON file was saved and opens correctly; the browser journal is still retained.');}catch(e){status('Evidence export failed: '+safeError(e)+'. Keep the browser journal for review.');}});
$('new-run').addEventListener('click',async()=>{if(!downloadRequested||!window.confirm('I verified the completed evidence JSON was saved and opens correctly. Clear this completed browser journal and require a fresh plan review?'))return;setWorking(true);try{await pilot.newRun({evidenceExportConfirmed:true});review=null;downloadRequested=false;$('confirm').checked=false;$('confirm').disabled=true;display(null);status('Completed run cleared after revalidation. Review a new plan.');}catch(e){status('Stopped: '+safeError(e)+'. Existing evidence was retained.');}finally{setWorking(false);}});
