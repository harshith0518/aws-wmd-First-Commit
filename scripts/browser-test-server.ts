// Standalone synthetic browser test rig. Never imported by the application or deployment bundle.
import {randomUUID} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';
import {build} from 'esbuild';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {CreateTableCommand,DeleteTableCommand,type CreateTableCommandInput} from '@aws-sdk/client-dynamodb';
import {createAuthenticator} from '../apps/api/src/auth.js';
import {createApp} from '../apps/api/src/app.js';
import {readConfig} from '../apps/api/src/config.js';
import {DynamoStore} from '../apps/api/src/data/dynamo.js';
import {IdentityService} from '../apps/api/src/identity-service.js';
import {CursorCodec} from '../apps/api/src/cursor.js';
import {issueFixture} from '../apps/api/test/issue-fixture.js';
const root=fileURLToPath(new URL('../',import.meta.url));const id=randomUUID();const prefix=`campusfix-browser-test-${id}`;const folder=path.join(root,'.local','browser-test',id);await mkdir(folder,{recursive:true});
const config=readConfig({APP_ENV:'test',DYNAMODB_ENDPOINT:'http://127.0.0.1:8000',CORE_TABLE:prefix+'-core',DISCOVERY_TABLE:prefix+'-discovery',JOBS_TABLE:prefix+'-jobs'});const store=new DynamoStore(config);const created:string[]=[];
let server:ReturnType<typeof serve>|undefined;let stopping=false;
async function stop(){if(stopping)return;stopping=true;server?.close();for(const name of created){if(!name.startsWith(prefix+'-'))throw new Error('Unsafe cleanup.');await store.client.send(new DeleteTableCommand({TableName:name}));}store.client.destroy();}
try{
 const definitions=JSON.parse(await readFile(path.join(root,'specs','dynamodb-tables.json'),'utf8')) as CreateTableCommandInput[];
 for(const table of definitions){const name=table.TableName!.replace('campusfix-local',prefix);await store.client.send(new CreateTableCommand({...table,TableName:name}));created.push(name);}
 const fixture=issueFixture();await store.transact([...fixture.store.items.values()].map(item=>({table:config.CORE_TABLE,key:{pk:item.pk,sk:item.sk},guard:{kind:'absent' as const},item})));
 const identity=new IdentityService(store,config,new CursorCodec('isolated-browser-test-cursor-secret-'+id));const membership=await identity.membership(fixture.user,fixture.campus);
 const pair=await generateKeyPair('RS256');const jwk=await exportJWK(pair.publicKey);jwk.kid='synthetic-browser-key';
 const issuer='https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_browserFixture';const clientId='browser-fixture-client';
 const token=await new SignJWT({token_use:'access',client_id:clientId,scope:'openid email campusfix/api'}).setSubject(fixture.user).setIssuer(issuer).setIssuedAt().setExpirationTime('30m').setProtectedHeader({alg:'RS256',kid:jwk.kid}).sign(pair.privateKey);
 const auth=createAuthenticator({issuer,clientId,domain:'https://synthetic.invalid'},createLocalJWKSet({keys:[jwk]}),async()=>Response.json({sub:fixture.user,email:'alice@example.test',email_verified:true}));
 const ownerMembership=await identity.membership(fixture.owner,fixture.campus);
 const ownerToken=await new SignJWT({token_use:'access',client_id:clientId,scope:'openid email campusfix/api'}).setSubject(fixture.owner).setIssuer(issuer).setIssuedAt().setExpirationTime('30m').setProtectedHeader({alg:'RS256',kid:jwk.kid}).sign(pair.privateKey);
 const campus={id:fixture.campus,name:'Synthetic Browser Test Campus',slug:'browser-test',status:'ACTIVE',membershipStatus:'ACTIVE'};
 const contents=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {IssueWorkspace} from './src/issues';import {ApiContext,createApi} from './src/api';import './src/styles.css';const actors=[{label:'Synthetic student',token:${JSON.stringify(token)},membership:${JSON.stringify(membership)}},{label:'Synthetic owner',token:${JSON.stringify(ownerToken)},membership:${JSON.stringify(ownerMembership)}}];const clients=actors.map(a=>createApi(()=>a.token));function TestApp(){const [role,setRole]=useState(0);const [route,setRoute]=useState('/c/${fixture.campus}/issues');function navigate(next){history.pushState(null,'',next);setRoute(next);}return <ApiContext.Provider value={clients[role]}><div className="shell"><header className="header"><strong>CampusFix browser verification</strong><span className="badge">Synthetic identities and test-only tables</span><label>Test identity<select value={role} onChange={e=>{setRole(Number(e.target.value));navigate('/c/${fixture.campus}/issues');}}>{actors.map((a,i)=><option key={i} value={i}>{a.label}</option>)}</select></label></header><main><IssueWorkspace key={role} campus={${JSON.stringify(campus)}} membership={actors[role].membership} path={route} navigate={navigate}/></main></div></ApiContext.Provider>;}createRoot(document.getElementById('root')).render(<TestApp/>);`;
 await build({stdin:{contents,loader:'tsx',resolveDir:path.join(root,'apps','web')},bundle:true,format:'esm',platform:'browser',jsx:'automatic',outfile:path.join(folder,'ui.js'),logLevel:'silent'});
 const app=new Hono();app.get('/',c=>c.html('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CampusFix synthetic browser test</title><link rel="stylesheet" href="/ui.css"><div id="root"></div><script type="module" src="/ui.js"></script></html>'));
 app.get('/ui.js',async c=>{c.header('Content-Type','application/javascript');return c.body(await readFile(path.join(folder,'ui.js'),'utf8'));});app.get('/ui.css',async c=>{c.header('Content-Type','text/css');return c.body(await readFile(path.join(folder,'ui.css'),'utf8'));});app.route('/',createApp({auth,identity}));
 server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:3002});console.log('Synthetic browser test ready at http://127.0.0.1:3002/ — stop with Ctrl+C to remove only its test tables.');
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>void stop().then(()=>process.exit(0)));
}catch(error){await stop();throw error;}
