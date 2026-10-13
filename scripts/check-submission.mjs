import { readFile } from 'node:fs/promises';
const s = JSON.parse(await readFile('submission.json','utf8'));
const configPath = process.env.DEPLOYMENT_CONFIG_PATH ?? 'public/deployment.json';
const d = JSON.parse(await readFile(configPath,'utf8'));
const blockers = [];
function need(condition, message) { if (!condition) blockers.push(message); }
for (const field of ['publicRepo','liveApp','builderProfile']) need(typeof s[field] === 'string' && /^https:\/\//.test(s[field]), `${field} is missing.`);
for (const field of ['deploymentTransactionHash','paymentTransactionHash']) need(typeof s[field] === 'string' && /^0x[0-9a-fA-F]{64}$/.test(s[field]), `${field} is missing.`);
need(d.chainId === 5042 && s.targetChainId === 5042,'Arc mainnet chain 5042 is required.');
need(typeof d.contractAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(d.contractAddress),'Mainnet contract address is missing.');
need(typeof d.runtimeCodeSha256 === 'string' && /^0x[0-9a-fA-F]{64}$/.test(d.runtimeCodeSha256),'Runtime bytecode pin is missing.');
for (const field of ['contractTestsPassed','arcTestnetSmokePassed','mainnetReceiptVerified','rightsToSubmitConfirmed','priorCircleOrArcFundingConfirmedAbsent']) need(s[field] === true,`${field} is not confirmed.`);
need(typeof s.duplicateRejectionEvidence === 'string' && s.duplicateRejectionEvidence.length > 0,'Duplicate rejection evidence is missing.');
console.log(JSON.stringify({status:blockers.length ? 'NOT_READY' : 'CHECKLIST_COMPLETE_NOT_ORGANIZER_APPROVAL', configPath, blockers, note:'This checks a local manifest only. Independently open the app/repo/explorer, verify chain data and recheck organizer rules.'},null,2));
process.exitCode = blockers.length ? 1 : 0;
