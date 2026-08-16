const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const assert=(condition,message)=>{if(!condition){console.error(`FAIL: ${message}`);process.exitCode=1;}else console.log(`OK: ${message}`);};

const index=read('renderer/index.html');
const license=read('agent/license-guard-v107.js');
const profile=read('agent/v3-profile-permissions.js');
const enroll=read('agent/v3-enroll.js');
const loginCss=read('renderer/login-entry-v108.css');
const setup=read('renderer/setup-flow-v109.js');

assert(!index.includes('<script src="login-entry-v108.js"></script>'),'renderer has only one operator-login controller');
assert(index.includes('<script src="operator-gate.js"></script>'),'operator gate remains the authoritative login controller');

const loginBlock=license.slice(license.indexOf('ThorAgent.prototype.loginOperator='),license.indexOf('ThorAgent.prototype.event='));
assert(!loginBlock.includes('await this.checkLicenseOnline'),'operator login never waits for network license validation');
assert(loginBlock.includes('void this.checkLicenseOnline'),'license validation continues in background after local login');
assert(loginBlock.includes("if(isBlocked(this.store))throw new Error('license_blocked')"),'known blocked license still prevents login');
assert(loginBlock.includes("if(pairingInvalidated(this.store))throw new Error('pairing_reconnect_required')"),'known reconnect-required state still prevents normal login');

const profileLogin=profile.slice(profile.indexOf('ThorAgent.prototype.loginOperator ='),profile.indexOf('ThorAgent.prototype.finalizeSale ='));
assert(profileLogin.includes('const localLogin = await originalLoginOperator.call(this, payload)'),'PIN/profile validation stays local first');
assert(profileLogin.includes('void runBackgroundSync()'),'full synchronization runs outside the login critical path');

assert(!enroll.includes('await this.sync.run(true)'),'activation does not wait for a full synchronization');
assert(enroll.includes('this.sync.start()'),'activation still starts background synchronization');
assert(enroll.includes("const { version: APP_VERSION } = require('../package.json')"),'activation reports the real desktop version');

assert(loginCss.includes('.operator-gate-terminal{display:none!important}'),'terminal details are hidden by default');
assert(loginCss.includes('.operator-gate.show-terminal-config .operator-gate-terminal{display:grid!important}'),'terminal details open only when settings is requested');
assert(setup.includes('Configurações do terminal'),'activation keeps terminal configuration behind an explicit settings action');

if(process.exitCode)process.exit(process.exitCode);
console.log('ThorPDV login-flow contract passed.');
