import {WalletPilot} from './runner-core.mjs';
import {format} from './domain.mjs';
import {recoveryAdvice} from './recovery-advice.mjs';
import {safeError} from './ui-error.mjs';
import {BotNetworkSelector,networkActionMessage} from './network-switch.mjs';
const $=id=>document.getElementById(id);
const rows=(target,entries)=>{target.replaceChildren();for(const [label,value] of entries){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);target.append(dt,dd);}};
const tbot=n=>format(BigInt(n)).replace(/\.?0+$/,'')+' tBOT';
const assets=await(await fetch('./assets.json',{cache:'no-store'})).json();
let pilot=null,review=null,working=false,downloadRequested=false,networkBusy=false,networkSelector=null,networkRefreshId=0;
// A saved hash stays in browser storage across a user-approved network change.
// An unresolved wallet prompt has no known outcome and must not be interrupted.
const networkFrozen=()=>working||networkBusy||pilot?.busy||['requesting','unknown'].includes(pilot?.state?.phase);
function networkControls({showSwitch=false,showAdd=false}={}){
 $('switch-network').hidden=!showSwitch;$('switch-network').disabled=!showSwitch||networkFrozen();
 $('add-network').hidden=!showAdd;$('add-network').disabled=!showAdd||networkFrozen();
 $('add-network-details').hidden=!showAdd;
}
async function refreshNetwork(){
 const refreshId=++networkRefreshId;
 if(!networkSelector||networkBusy)return;
 try{
  const chain=await networkSelector.inspect(),accounts=await networkSelector.accounts();
  if(refreshId!==networkRefreshId||networkBusy)return;
  const name=chain.chainId===5042?'Arc mainnet':`chain ${chain.chainId}`;
  $('network-status').textContent=(chain.correct?'Wallet network: BOT testnet 968. Connect and review the account before any test.':`Wallet detected on ${name}, not BOT testnet 968. ${accounts.length?'An account is authorized for this site, but no BOT testnet run is connected.':'Connect after switching to BOT testnet.'}`)+(pilot?.invalidated?' Wallet context changed: reload this page before connecting or resuming; saved evidence remains intact.':'');
  if(pilot?.invalidated)$('connect').disabled=true;
  networkControls({showSwitch:!chain.correct,showAdd:!chain.correct&&networkSelector.canAdd});
 }catch(e){if(refreshId!==networkRefreshId||networkBusy)return;$('network-status').textContent=networkActionMessage(e);networkControls();}
}
async function networkAction(action){
 if(!networkSelector||networkFrozen())return;
 const connectWasDisabled=$('connect').disabled;
 networkBusy=true;$('connect').disabled=true;networkControls();
 try{
  if(pilot?.state){const accounts=await networkSelector.accounts();if(accounts.length!==1||accounts[0]!==pilot.state.account)throw Object.assign(new Error('NETWORK_SAVED_ACCOUNT_MISMATCH'),{code:'NETWORK_SAVED_ACCOUNT_MISMATCH'});}
  const result=await (action==='switch'?networkSelector.switch():networkSelector.add());
  if(result.kind==='unknown-chain'){
   $('network-status').textContent='BOT testnet is not in this wallet. Review the official network details below, then click Add BOT testnet if you choose. Nothing was added automatically.';
   networkControls({showSwitch:true,showAdd:true});
  }else if(result.kind==='added'){
   $('network-status').textContent='BOT testnet was added. It may not be selected. Click Switch to BOT testnet separately; no transaction was requested.';
   networkControls({showSwitch:true});
  }else{
   $('network-status').textContent='BOT testnet 968 and its pinned genesis verified. Reloading to reset wallet context; click Connect Wallet afterward.';
   location.reload();
  }
 }catch(e){
  $('network-status').textContent=networkActionMessage(e);
  networkControls({showSwitch:true,showAdd:networkSelector.canAdd});
 }finally{
  networkBusy=false;$('connect').disabled=connectWasDisabled;
  networkControls({showSwitch:!$('switch-network').hidden,showAdd:!$('add-network').hidden});
 }
}
document.getElementById('arc-link').addEventListener('click',event=>{if(working||pilot?.state&&['requesting','unknown'].includes(pilot.state.phase)){event.preventDefault();status('Wallet request may still be active or its outcome is unknown. Preserve this page and reconcile the original request before changing chains.');}});
function display(snapshot){
 if(!snapshot){$('current').replaceChildren();$('history').replaceChildren();$('plan').replaceChildren();$('recovery').textContent='';$('recovery').hidden=true;$('new-run').disabled=true;$('download').disabled=true;$('reconcile-fee-hold').disabled=true;return;}
 $('status').textContent=snapshot.message+(snapshot.phase==='complete'&&!pilot?.verifiedSession?' Saved completion must be revalidated before it is reported as verified.':'');
 const stage=['Receiver deployment','0.01 tBOT payment','Principal return'][snapshot.stageIndex]??'Complete';
 rows($('current'),[['Stage',stage],['Phase',snapshot.phase],['Original hash',snapshot.hash??'none'],['Receiver',snapshot.receiverAddress??'not deployed'],['Wallet approval',snapshot.phase==='requesting'?'Approve this exact transaction in your wallet':'none pending'],...(snapshot.intent?[['Target',snapshot.intent.to??'new receiver contract'],['Value',tbot(BigInt(snapshot.intent.value))],['Gas limit',BigInt(snapshot.intent.gas).toString()],['Gas price',BigInt(snapshot.intent.gasPrice).toString()+' wei'],['Maximum fee',tbot(snapshot.intent.maximumFeeWei)]]:[])]);
 const list=$('history');list.replaceChildren();for(const item of snapshot.receipts){const li=document.createElement('li');li.textContent=item.stage+' · '+item.hash+' · block '+item.blockNumber+' · fee '+item.actualFeeWei+' wei';list.append(li);}
 $('download').disabled=false;
 const recovery=$('recovery');
 recovery.textContent=recoveryAdvice(snapshot);
 recovery.hidden=!recovery.textContent;
 $('resume').disabled=working||!pilot?.account||['unknown','requesting','rejected','hold'].includes(snapshot.phase);
 $('reconcile-fee-hold').disabled=working||!pilot?.account||!pilot.canReconcileFeeHold();
 $('start').disabled=true;$('review').disabled=true;
 $('new-run').disabled=working||!downloadRequested||snapshot.phase!=='complete'||!pilot?.verifiedSession;
}
function status(message){$('status').textContent=message;}
function setWorking(value){working=value;$('connect').disabled=value;$('review').disabled=value||!pilot?.account||!!pilot?.state;$('start').disabled=value||!review||!$('confirm').checked||!!pilot?.state;$('resume').disabled=value||!pilot?.account||!pilot?.state||['unknown','requesting','rejected','hold'].includes(pilot.state.phase);$('reconcile-fee-hold').disabled=value||!pilot?.account||!pilot?.canReconcileFeeHold();$('new-run').disabled=value||!downloadRequested||pilot?.state?.phase!=='complete'||!pilot?.verifiedSession;if($('switch-network').hidden===false||$('add-network').hidden===false)networkControls({showSwitch:!$('switch-network').hidden,showAdd:!$('add-network').hidden});}
const withLock=async fn=>{
 if(!navigator.locks?.request)throw Error('BROWSER_LOCK_UNAVAILABLE');
 return navigator.locks.request('settleref-bot-968-wallet-runner',{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock)throw Error('ANOTHER_TAB_ACTIVE');return fn();});
};
if(!window.ethereum?.request){$('network-status').textContent='No injected wallet provider found in this browser.';status('No injected wallet found. Use a browser with a user-controlled testnet wallet; live integration remains unqualified. The packaged Node tests use a fake provider.');$('connect').disabled=true;}
else{
 networkSelector=new BotNetworkSelector(window.ethereum);
 pilot=new WalletPilot({provider:window.ethereum,storage:localStorage,assets,withLock,onChange:({message,state})=>{if(state)display(state);status(message);}});
 try{const saved=pilot.load();if(saved){display(saved);status('Saved run retained. Reconnect the same account before any read-only recovery or next wallet prompt.');}}catch{status('Saved run is malformed. Do not send; preserve the browser data for review.');$('connect').disabled=true;}
 window.ethereum.on?.('chainChanged',()=>{networkControls();void refreshNetwork();});
 window.ethereum.on?.('accountsChanged',()=>{networkControls();void refreshNetwork();});
 void refreshNetwork();
}
$('switch-network').addEventListener('click',()=>{void networkAction('switch');});
$('add-network').addEventListener('click',()=>{void networkAction('add');});
$('connect').addEventListener('click',async()=>{setWorking(true);try{const account=await pilot.connect();$('account').textContent='Connected payer and receiver owner: '+account;setWorking(false);}catch(e){if(e?.code==='TESTNET_968_ONLY')$('account').textContent='Wallet detected on another network; no BOT testnet account is connected to this run.';status('Stopped: '+safeError(e));setWorking(false);}});
$('review').addEventListener('click',async()=>{setWorking(true);try{review=await pilot.review();rows($('plan'),[['Network','BOT testnet 968 · pinned genesis '+review.genesisHash],['Connected account',review.account],['Existing settlement',review.settlement],['Steps','Deploy owned receiver → pay → withdraw to same account'],['Principal',tbot(review.principalWei)],['Total maximum app gas cap',tbot(review.totalFeeCapWei)],['Maximum fee per step',tbot(review.stepFeeCapWei)],['First-step estimated maximum fee',tbot(review.firstMaximumFeeWei)],['Receiver owner',review.receiverOwner]]);$('confirm').disabled=false;status('Review complete. Each stage is re-estimated; a changed fee above cap stops the run. Your wallet must approve each transaction.');}catch(e){status('Stopped: '+safeError(e));}finally{setWorking(false);}});
$('confirm').addEventListener('change',()=>setWorking(false));
$('start').addEventListener('click',async()=>{setWorking(true);try{await pilot.start({reviewConfirmed:$('confirm').checked});}catch(e){status('Stopped: '+safeError(e)+'. Preserve the original hash and export evidence; do not resend.');}finally{setWorking(false);if(pilot?.state)display(pilot.snapshot());}});
$('resume').addEventListener('click',async()=>{setWorking(true);try{await pilot.resume();}catch(e){status('Stopped: '+safeError(e)+'. Preserve the original hash and export evidence; do not resend.');}finally{setWorking(false);if(pilot?.state)display(pilot.snapshot());}});
$('reconcile-fee-hold').addEventListener('click',async()=>{setWorking(true);let notice;try{const result=await pilot.reconcileFeeHold();notice=result.phase==='pending'?'Original hash remains unverified: RPC data is incomplete or finality is pending. No wallet request was made. Keep the journal and retry the read-only check later.':'Original hash verified read-only. No wallet request was made. Review the verified step and export evidence before considering the next step.';}catch(e){notice='Original-hash verification stopped: '+safeError(e)+'. Preserve the journal; do not resend.';}finally{setWorking(false);if(pilot?.state)display(pilot.snapshot());status(notice);}});
$('download').addEventListener('click',()=>{if(!pilot?.state)return;try{const blob=new Blob([JSON.stringify(pilot.report(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='settleref-bot-testnet-wallet-run.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);downloadRequested=true;setWorking(false);status('Evidence download requested. Check that the JSON file was saved and opens correctly; the browser journal is still retained.');}catch(e){status('Evidence export failed: '+safeError(e)+'. Keep the browser journal for review.');}});
$('new-run').addEventListener('click',async()=>{if(!downloadRequested||!window.confirm('I verified the completed evidence JSON was saved and opens correctly. Clear this completed browser journal and require a fresh plan review?'))return;setWorking(true);try{await pilot.newRun({evidenceExportConfirmed:true});review=null;downloadRequested=false;$('confirm').checked=false;$('confirm').disabled=true;display(null);status('Completed run cleared after revalidation. Review a new plan.');}catch(e){status('Stopped: '+safeError(e)+'. Existing evidence was retained.');}finally{setWorking(false);}});
