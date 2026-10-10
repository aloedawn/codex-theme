import test from 'node:test';
import assert from 'node:assert/strict';
import {createPageSource} from '../codex-theme.mjs';

const page=createPageSource('', '');
const nativeCode=page.slice(page.indexOf('  function createNativeCompatibility('),page.indexOf('  // src/page/native-ui.mjs'));

test('unified sidebar patches the visible Codex tree and ignores a retained hidden ChatGPT tree',()=>{
 class Element {}
 const root={}; const hidden={memoizedProps:{sidebarMode:'chatgpt',style:{display:'none'}},return:root};
 const visible={memoizedProps:{sidebarMode:'codex'},return:root};
 function Sidebar(){return ['workCloudSidebarContentVisible','workLocalSidebarContentVisible','includeChatGptProjects','sidebarElectron.chatGptWork.recents'];}
 const hiddenSidebar={type:Sidebar,memoizedProps:{sidebarMode:'chatgpt'},return:hidden};
 let renders=0;
 const sidebar={type:Sidebar,memoizedProps:{sidebarMode:'codex'},pendingProps:{sidebarMode:'codex'},return:visible,memoizedState:{memoizedState:new Map(),queue:{dispatch(value){assert.ok(value instanceof Map);renders++},lastRenderedReducer:(state,action)=>typeof action==='function'?action(state):action}}};
 root.child=hidden;hidden.child=hiddenSidebar;hidden.sibling=visible;visible.child=sidebar;
 const panel=new Element();panel.__reactFiber$fixture={return:root};
 const main=new Element();main.__reactFiber$fixture={};
 const document={body:null,querySelectorAll(selector){return selector.includes('.app-shell-left-panel')?[panel,main]:[main]}};
 const diagnostics={unifiedSidebarPatches:0,unifiedSidebarRenderRequests:0,unifiedSidebarRenderErrors:0,unifiedSidebarRestores:0};
 const factory=new Function('Element','HTMLElement','document','createHomeModeSupport','createChatComposerSupport','createQueuedFollowUpSupport',nativeCode+'\nreturn createNativeCompatibility;');
 const create=factory(Element,Element,document,()=>({}),()=>({dispose(){}}),()=>({dispose(){}}));
 const controller=create({diagnostics});controller.reconcileSidebar();controller.reconcileSidebar();
 assert.equal(sidebar.memoizedProps.sidebarMode,'chatgpt');
 assert.equal(hiddenSidebar.memoizedProps.sidebarMode,'chatgpt');
 assert.equal(renders,1);assert.equal(controller.inspectSidebar().active,true);
 controller.dispose();assert.equal(sidebar.memoizedProps.sidebarMode,'codex');assert.equal(renders,2);
});

test('server signals render into the visible scroll container when a hidden container comes first',()=>{
 class Element{
  constructor(width=20){this.width=width;this.attrs={};this.dataset={};this.owned=false;}
  getBoundingClientRect(){return {left:180,width:this.width,height:this.width?20:0}}
  getAttribute(name){return this.attrs[name]??null} setAttribute(name,value){this.attrs[name]=value} removeAttribute(name){delete this.attrs[name]}
 }
 const hidden=new Element(0),visible=new Element(300),panel=new Element(300),label=new Element(),signal=new Element(),nativeStatus=new Element();
 signal.dataset.hostAlias='Homelab';signal.owned=true;signal.nextElementSibling=nativeStatus;
 const bars=[1,2,3,4].map(index=>{const e=new Element();e.attrs['data-index']=String(index);return e});
 signal.querySelectorAll=()=>bars;nativeStatus.contains=()=>false;
 const row=new Element();row.querySelectorAll=selector=>selector==='[role="img"]'?[nativeStatus]:[];
 label.closest=()=>row;
 hidden.querySelectorAll=()=>[];
 visible.querySelectorAll=selector=>selector==='.codex-theme-server-signal'?[signal]:selector.includes('native-server-status')?[nativeStatus]:[];
 panel.querySelector=()=>hidden;panel.querySelectorAll=()=>[hidden,visible];panel.getBoundingClientRect=()=>({left:0,width:300,height:700});
 const document={querySelector:()=>panel,querySelectorAll:()=>[],createTreeWalker(scroll){let emitted=false;return {nextNode(){if(emitted||scroll===hidden)return null;emitted=true;return {nodeValue:'Homelab',parentElement:label}}}}};
 const code=page.slice(page.indexOf('  var ACTIVITY_ATTRIBUTE ='),page.indexOf('  // src/page/composer.mjs'));
 const factory=new Function('HTMLElement','document','NodeFilter','markOwned','isOwnedNode','isVisible','shallowEqualObject','setAttributeIfChanged','removeAttributeIfPresent',code+'\nreturn createServerSignals;');
 const create=factory(Element,document,{SHOW_TEXT:4},e=>e,e=>e.owned,e=>e.getBoundingClientRect().width>0,()=>false,(e,k,v)=>e.setAttribute(k,v),(e,k)=>e.removeAttribute(k));
 create({Homelab:22}).render();
 assert.equal(signal.getAttribute('data-bars'),'4');
 assert.equal(nativeStatus.getAttribute('data-codex-theme-native-server-status'),'true');
 assert.ok(bars.every(bar=>bar.getAttribute('data-active')==='true'));
});
