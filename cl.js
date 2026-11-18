
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { execSync } = require('node:child_process');

const API = 'https://discord.com/api/v9';
const GW = 'wss://gateway.discord.gg/?v=9&encoding=json';
const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7, INVALID: 9, HELLO: 10, ACK: 11 };
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);
const DM = 1, GDM = 3;
const RE_TOKEN = /(mfa\.[\w-]{84}|[\w-]{24,26}\.[\w-]{6}\.[\w-]{25,110})/;
const RE_TOKEN_G = /(mfa\.[\w-]{84}|[\w-]{24,26}\.[\w-]{6}\.[\w-]{25,110})/g;
const RE_ENC = /dQw4w9WgXcQ:([^"']+)/g;
const MANUAL = path.join(__dirname, 'token_manual.txt');
const OUT = path.join(__dirname, 'tokens_validos.txt');
const CMD = 'take';

const C = { r: '\x1b[0m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', cya: '\x1b[36m', gry: '\x1b[90m', b: '\x1b[1m' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const backoff = (n) => Math.min(500 * 2 ** n, 30000) + Math.floor(Math.random() * 250);
const safeJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

// ─── DPAPI ────────────────────────────────────────────────────────────────
let Dpapi, dpapiOk;
async function loadDpapi() {
    try {
        const m = require('@primno/dpapi');
        Dpapi = m.Dpapi; dpapiOk = m.isPlatformSupported;
        console.log(`${C.grn}[OK]${C.r} @primno/dpapi presente`);
    } catch {
        console.log(`${C.yel}[!]${C.r} instalando @primno/dpapi@2.0.1`);
        if (!fs.existsSync(path.join(__dirname, 'package.json'))) {
            try { execSync('npm init -y', { cwd: __dirname, stdio: 'ignore' }); } catch {}
        }
        try {
            execSync('npm install @primno/dpapi@2.0.1 --no-audit --no-fund', { cwd: __dirname, stdio: 'inherit' });
            const m = require('@primno/dpapi');
            Dpapi = m.Dpapi; dpapiOk = m.isPlatformSupported;
        } catch (e) {
            console.log(`${C.red}[X]${C.r} falha @primno/dpapi: ${e.message}`);
            process.exit(1);
        }
    }
}

// ─── TOKENS ───────────────────────────────────────────────────────────────
function decryptGcm(key, b64) {
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), data = buf.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return d.update(data, 'utf8', 'utf8') + d.final('utf8');
}

async function masterKey(basePath) {
    const p = path.join(basePath, 'Local State');
    if (!fs.existsSync(p) || !dpapiOk) return null;
    const st = safeJson(await fsp.readFile(p, 'utf8'));
    if (!st?.os_crypt?.encrypted_key) return null;
    try {
        const enc = Buffer.from(st.os_crypt.encrypted_key, 'base64');
        return Dpapi.unprotectData(enc.subarray(5), null, 'CurrentUser');
    } catch { return null; }
}

async function extractTokens() {
    const found = new Map();
    const add = (t, src) => { if (t && !found.has(t)) found.set(t, src); };

    if (fs.existsSync(MANUAL)) {
        const m = (await fsp.readFile(MANUAL, 'utf8')).match(RE_TOKEN);
        if (m) add(m[0], 'manual');
    }
    if (process.env.DISCORD_TOKEN && RE_TOKEN.test(process.env.DISCORD_TOKEN)) add(process.env.DISCORD_TOKEN, 'env');

    const appData = process.env.APPDATA;
    if (appData) {
        for (const d of ['discord', 'discordptb', 'discordcanary', 'discorddevelopment', 'lightcord']) {
            const base = path.join(appData, d);
            const ldb = path.join(base, 'Local Storage', 'leveldb');
            if (!fs.existsSync(ldb)) continue;
            const key = await masterKey(base);
            for (const f of (await fsp.readdir(ldb)).filter(x => x.endsWith('.ldb') || x.endsWith('.log'))) {
                const txt = await fsp.readFile(path.join(ldb, f), 'utf8');
                (txt.match(RE_TOKEN_G) || []).forEach(t => add(t, 'ldb'));
                if (key) {
                    RE_ENC.lastIndex = 0;
                    let m;
                    while ((m = RE_ENC.exec(txt)) !== null) {
                        try { const dec = decryptGcm(key, m[1]); if (dec.length > 20) add(dec, 'ldb-gcm'); } catch {}
                    }
                }
            }
        }
    }
    return Array.from(found.entries()).map(([token, source]) => ({ token, source }));
}

// ─── HTTP ─────────────────────────────────────────────────────────────────
class Http {
    constructor(token) {
        this.token = token;
        this.ua = `DiscordDeepCleaner/4.1 (Node/${process.version})`;
        this.nextAt = 0;
    }
    async req(method, endpoint, body = null, tries = 5) {
        const now = Date.now();
        if (this.nextAt > now) await sleep(this.nextAt - now);
        const res = await fetch(API + endpoint, {
            method,
            headers: {
                Authorization: this.token,
                'Content-Type': 'application/json',
                'User-Agent': this.ua,
                'X-RateLimit-Precision': 'millisecond'
            },
            body: body ? JSON.stringify(body) : undefined
        });
        const ra = parseFloat(res.headers.get('X-RateLimit-Reset-After') || '0');
        if (ra > 0) this.nextAt = Date.now() + ra * 1000 + 50;

        if (res.status === 429) {
            const d = await res.json().catch(() => ({}));
            const wait = (d.retry_after ?? 1) * 1000;
            await sleep(wait + 100);
            return this.req(method, endpoint, body, tries);
        }
        if (res.status === 204) return null;
        const text = await res.text();
        const json = text ? safeJson(text) : null;
        if (!res.ok) {
            const err = new Error(`HTTP ${res.status}: ${json?.message || 'erro'}`);
            err.status = res.status;
            if (res.status >= 500 && tries > 0) {
                await sleep(backoff(5 - tries));
                return this.req(method, endpoint, body, tries - 1);
            }
            throw err;
        }
        return json;
    }
    get(e) { return this.req('GET', e); }
    del(e) { return this.req('DELETE', e); }
}

// ─── LISTA DE DMs ABERTAS ─────────────────────────────────────────────────
async function listDMs(http) {
    const channels = await http.get('/users/@me/channels');
    const dms = (channels || []).filter(c => c.type === DM || c.type === GDM);
    return dms.map((ch, i) => {
        const r = ch.recipients?.[0];
        const name = ch.type === GDM
            ? `GROUP_DM (${ch.recipients?.map(x => x.username).join(', ') || '?'})`
            : (r?.global_name || r?.username || 'Desconhecido');
        return { num: i + 1, id: ch.id, type: ch.type, name };
    });
}

// ─── GATEWAY ──────────────────────────────────────────────────────────────
class Gateway {
    constructor(token) {
        this.token = token;
        this.ws = null;
        this.seq = null;
        this.session = null;
        this.hb = null;
        this.acked = true;
        this.listener = null;
    }
    onMessage(fn) { this.listener = fn; }
    connect() {
        this.ws = new WebSocket(GW);
        this.ws.addEventListener('message', (ev) => this._msg(safeJson(ev.data)));
        this.ws.addEventListener('close', () => this._reconnect());
        this.ws.addEventListener('error', (e) => console.log(`${C.red}[GW]${C.r} ${e.message || 'erro'}`));
    }
    _msg(p) {
        if (!p) return;
        if (p.s != null) this.seq = p.s;
        if (p.op === OP.HELLO) {
            this._hb(p.d.heartbeat_interval);
            if (this.session && this.seq != null) this._send({ op: OP.RESUME, d: { token: this.token, session_id: this.session, seq: this.seq } });
            else this._identify();
        } else if (p.op === OP.ACK) {
            this.acked = true;
        } else if (p.op === OP.HEARTBEAT) {
            this._beat();
        } else if (p.op === OP.RECONNECT) {
            this._reconnect();
        } else if (p.op === OP.INVALID) {
            this.session = null; this.seq = null;
            setTimeout(() => this._identify(), 1500);
        } else if (p.op === OP.DISPATCH) {
            if (p.t === 'READY') {
                this.session = p.d.session_id;
                console.log(`${C.grn}[READY]${C.r} ${p.d.user.username} — digite ${C.b}take${C.r} numa DM`);
            } else if (p.t === 'MESSAGE_CREATE' && this.listener) {
                this.listener(p.d);
            }
        }
    }
    _identify() {
        this.acked = true;
        this._send({
            op: OP.IDENTIFY,
            d: {
                token: this.token,
                capabilities: 125,
                intents: INTENTS,
                properties: { os: process.platform, browser: 'Chrome', device: 'desktop' },
                compress: false
            }
        });
    }
    _hb(ms) {
        clearInterval(this.hb);
        this.hb = setInterval(() => this._beat(), ms);
        this._beat();
    }
    _beat() {
        if (!this.acked) { this._reconnect(); return; }
        this.acked = false;
        this._send({ op: OP.HEARTBEAT, d: this.seq });
    }
    _send(p) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(p));
    }
    async _reconnect() {
        clearInterval(this.hb);
        if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
        await sleep(2000);
        this.connect();
    }
    close() { clearInterval(this.hb); if (this.ws) { try { this.ws.close(); } catch {} } }
}

// ─── CLEANER ──────────────────────────────────────────────────────────────
class Cleaner {
    constructor(http, me) {
        this.http = http;
        this.me = me;
        this.busy = false;
    }
    async clean(channelId, label) {
        if (this.busy) { console.log(`${C.yel}[!]${C.r} limpeza já em andamento`); return; }
        this.busy = true;
        let deleted = 0, scanned = 0, cursor = null;
        const t0 = Date.now();
        console.log(`\n${C.cya}[take]${C.r} canal ${channelId} (${label})`);
        try {
            while (true) {
                let url = `/channels/${channelId}/messages?limit=100`;
                if (cursor) url += `&before=${cursor}`;
                let batch;
                try { batch = await this.http.get(url); }
                catch (e) {
                    if (e.status === 403 || e.status === 404) { console.log(`${C.yel}[!]${C.r} ${e.message}`); break; }
                    throw e;
                }
                if (!batch || batch.length === 0) break;
                for (const m of batch) {
                    cursor = m.id;
                    scanned++;
                    if (m.author?.id !== this.me.id) continue;
                    try {
                        await this.http.del(`/channels/${channelId}/messages/${m.id}`);
                        deleted++;
                        process.stdout.write(`\r${C.grn}[apagando]${C.r} ${deleted} | scan ${scanned}   `);
                    } catch (e) {
                        console.log(`\n${C.red}[x]${C.r} ${m.id}: ${e.message}`);
                    }
                }
                if (batch.length < 100) break;
            }
        } finally {
            const sec = ((Date.now() - t0) / 1000).toFixed(1);
            console.log(`\n${C.grn}[fim]${C.r} apagadas=${deleted} scan=${scanned} tempo=${sec}s\n`);
            this.busy = false;
        }
    }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────
async function validate(token) {
    const http = new Http(token);
    try {
        const user = await http.get('/users/@me');
        return { ok: true, user, http };
    } catch (e) { return { ok: false, err: e }; }
}

async function main() {
    console.log(`${C.cya}=== Discord Deep Cleaner 4.1 ===${C.r}\n`);
    await loadDpapi();

    const cands = await extractTokens();
    console.log(`${C.gry}tokens encontrados: ${cands.length}${C.r}`);

    const valid = [];
    for (const c of cands) {
        const r = await validate(c.token);
        if (r.ok) {
            valid.push({ ...c, user: r.user, http: r.http });
            console.log(`${C.grn}[ok]${C.r} ${r.user.username} (${c.source})`);
        }
    }

    if (valid.length) {
        const txt = '=== TOKENS VÁLIDOS ===\n\n' + valid.map(v =>
            `Usuário: ${v.user.username} (${v.user.id})\nToken: ${v.token}\nFonte: ${v.source}\n`).join('\n');
        await fsp.writeFile(OUT, txt, 'utf8');
        console.log(`${C.grn}[ok]${C.r} salvo em ${OUT}`);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));

    console.log(`\n${C.cya}=== CONTAS ===${C.r}`);
    valid.forEach((v, i) => console.log(`  [${i + 1}] ${v.user.global_name || v.user.username} (${v.source})`));
    console.log(`  [M] token manual`);
    console.log(`  [0] sair\n`);

    const pick = (await ask('Escolha: ')).trim();
    let sel = null;

    if (pick.toLowerCase() === 'm') {
        let t = (await ask('Token: ')).trim().replace(/^["']|["']$/g, '');
        if (!t && fs.existsSync(MANUAL)) {
            const m = (await fsp.readFile(MANUAL, 'utf8')).match(RE_TOKEN);
            if (m) t = m[0];
        }
        if (!t) { console.log(`${C.red}[X]${C.r} nenhum token`); rl.close(); return; }
        const r = await validate(t);
        if (!r.ok) { console.log(`${C.red}[X]${C.r} inválido`); rl.close(); return; }
        sel = { token: t, user: r.user, http: r.http };
    } else {
        const n = parseInt(pick, 10);
        if (!(n > 0 && n <= valid.length)) { rl.close(); return; }
        sel = valid[n - 1];
    }

    // ─── LISTA DE DMs ABERTAS ────────────────────────────────────────────
    let dmList = [];
    try {
        dmList = await listDMs(sel.http);
    } catch (e) {
        console.log(`${C.yel}[!]${C.r} falha ao listar DMs: ${e.message}`);
    }

    if (dmList.length === 0) {
        console.log(`${C.yel}Nenhuma DM aberta.${C.r}`);
    } else {
        console.log(`\n${C.cya}=== DMs ABERTAS ===${C.r}`);
        dmList.forEach(d => console.log(`  ${d.num}. ${d.name} ${C.gry}(${d.type === DM ? 'DM' : 'GDM'})${C.r}`));
        console.log(`${C.cya}===================${C.r}\n`);
    }

    console.log(`${C.gry}Opções: número da DM = limpar agora | 0 = apenas escutar "take" | Enter = escutar "take"${C.r}`);
    const dmPick = (await ask('DM: ')).trim();
    rl.close();

    const cleaner = new Cleaner(sel.http, sel.user);
    const gw = new Gateway(sel.token);

    gw.onMessage(async (msg) => {
        if (!msg?.author || msg.author.id !== sel.user.id) return;
        if ((msg.content || '').trim().toLowerCase() !== CMD) return;
        let ch;
        try { ch = await sel.http.get(`/channels/${msg.channel_id}`); }
        catch { return; }
        if (ch?.type !== DM && ch?.type !== GDM) return;
        const label = ch.recipients?.[0]?.global_name || ch.recipients?.[0]?.username || (ch.type === GDM ? 'GROUP_DM' : 'DM');
        cleaner.clean(msg.channel_id, label);
    });

    gw.connect();

    if (dmPick && dmPick !== '0') {
        const n = parseInt(dmPick, 10);
        const target = dmList.find(d => d.num === n);
        if (target) {
            await cleaner.clean(target.id, target.name);
        } else {
            console.log(`${C.yel}[!]${C.r} DM ${dmPick} não existe na lista`);
        }
    } else {
        console.log(`${C.gry}[*]${C.r} Apenas escutando "take". Envie "take" em qualquer DM.`);
    }

    process.on('SIGINT', () => { gw.close(); console.log('\n[saida]'); process.exit(0); });
    process.on('uncaughtException', (e) => console.log(`${C.red}[fatal]${C.r} ${e.stack}`));
    process.on('unhandledRejection', (e) => console.log(`${C.red}[promise]${C.r} ${e?.message || e}`));
}

main();