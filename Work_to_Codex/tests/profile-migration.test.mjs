import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('Windows profile migration preserves source and existing destination data, skips locks, and clears pending state',{skip:process.platform!=='win32'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-profile-migration-'));
 try{
  const source=path.join(root,'old profile'),destination=path.join(root,'installed profile');
  fs.mkdirSync(path.join(source,'Default','Network'),{recursive:true});
  fs.writeFileSync(path.join(source,'Default','Network','Cookies'),'cookie fixture');fs.mkdirSync(destination);
  fs.writeFileSync(path.join(source,'Default','Preferences'),'saved login and sidebar state');fs.writeFileSync(path.join(source,'LOCK'),'process lock');
  fs.writeFileSync(path.join(destination,'keep.txt'),'existing data');
  const settingsPath=path.join(root,'settings.json');fs.writeFileSync(settingsPath,JSON.stringify({SourceProfileDirectory:source,ProfileDirectory:destination}));
  const script=fileURLToPath(new URL('../migrate-profile.ps1',import.meta.url));
  const run=args=>spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,...args],{encoding:'utf8',timeout:20000,windowsHide:true});
  const snapshot=run(['-SettingsPath',settingsPath,'-AllowRunningSnapshot']);assert.equal(snapshot.status,0,snapshot.stderr);
  assert.equal(fs.existsSync(path.join(destination,'Default','Network','Cookies')),false);
  assert.equal(JSON.parse(fs.readFileSync(settingsPath,'utf8')).SourceProfileDirectory,source);
  const result=run(['-SettingsPath',settingsPath]);assert.equal(result.status,0,result.stderr);
  assert.equal(fs.readFileSync(path.join(destination,'Default','Preferences'),'utf8'),'saved login and sidebar state');
  assert.equal(fs.readFileSync(path.join(source,'Default','Preferences'),'utf8'),'saved login and sidebar state');
  assert.ok(fs.existsSync(path.join(destination,'keep.txt')));assert.equal(fs.existsSync(path.join(destination,'LOCK')),false);
  assert.equal(JSON.parse(fs.readFileSync(settingsPath,'utf8').replace(/^\uFEFF/,'')).SourceProfileDirectory,undefined);
  assert.equal(fs.readFileSync(path.join(destination,'Default','Network','Cookies'),'utf8'),'cookie fixture');
  assert.equal(run(['-SettingsPath',settingsPath]).status,0);
  const unsafe=run(['-SourceDirectory',source,'-DestinationDirectory',path.join(source,'nested')]);assert.notEqual(unsafe.status,0);assert.match(unsafe.stderr,/non-nested/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
