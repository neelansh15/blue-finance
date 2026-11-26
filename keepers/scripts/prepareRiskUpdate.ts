/** Produce a review artifact, never a transaction. See docs/enforced-risk-parameters.md. */
import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, http, isAddress, type PublicClient } from 'viem';
import { prepareRiskUpdate, type Deployment, type Review } from '../src/riskExecution.js';

const args=process.argv.slice(2);
const option=(name:string) => {const index=args.indexOf(name); if(index<0 || !args[index+1]) throw new Error(`Required ${name}`); return args[index+1]!;};
const raw=JSON.parse(await readFile(option('--deployment'),'utf8'));
for(const name of ['router','morpho','registry','executor','governance','guardian','reviewer'])
  if(!isAddress(raw[name])) throw new Error(`Invalid deployment ${name}`);
for(const name of ['loanToken','collateralToken','oracle','irm'])
  if(!isAddress(raw.market?.[name])) throw new Error(`Invalid market ${name}`);
if(!Number.isSafeInteger(raw.chainId) || raw.chainId<=0 || typeof raw.asset!=='string' ||
  !Number.isInteger(raw.loanDecimals) || !Number.isInteger(raw.collateralDecimals) ||
  ![raw.loanDecimals,raw.collateralDecimals].every(d=>d>=0 && d<=36)) throw new Error('Invalid deployment metadata');
const deployment={...raw,market:{...raw.market,lltv:BigInt(raw.market.lltv)}} as Deployment;
const reviewRaw=JSON.parse(await readFile(option('--review'),'utf8'));
const review={...reviewRaw,expiresAt:BigInt(reviewRaw.expiresAt),multiplier:BigInt(reviewRaw.multiplier)} as Review;
const client=createPublicClient({transport:http(option('--rpc'),{timeout:15000})}) as PublicClient;
const plan=await prepareRiskUpdate(client,deployment,await readFile(option('--advisory'),'utf8'),review,BigInt(option('--nonce')));
await writeFile(option('--output'),JSON.stringify(plan,(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
console.log(`Prepared ${plan.method} for ${plan.to}; no transaction submitted.`);
