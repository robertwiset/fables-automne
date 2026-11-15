const SUPABASE_URL = "https://" + "tmfzrjeaknwvkdhsqmuu" + ".supabase.co";
const SUPABASE_KEY = "sb_publishable_Zx28ISJOTOmc-Hkmdpj-iQ_dP6kHgCC";

let AUTH_TOKEN = localStorage.getItem('fa_token') || null;
let REFRESH_TOKEN = localStorage.getItem('fa_refresh') || null;
let AUTH_USER = JSON.parse(localStorage.getItem('fa_user') || 'null');

function apiHeaders() {
  const h = { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) h['Authorization'] = 'Bearer ' + AUTH_TOKEN;
  return h;
}

async function tryRefreshSession() {
  if (!REFRESH_TOKEN) return false;
  const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: REFRESH_TOKEN })
  });
  if (!r.ok) return false;
  const d = await r.json();
  AUTH_TOKEN = d.access_token; REFRESH_TOKEN = d.refresh_token; AUTH_USER = d.user;
  localStorage.setItem('fa_token', AUTH_TOKEN);
  localStorage.setItem('fa_refresh', REFRESH_TOKEN);
  localStorage.setItem('fa_user', JSON.stringify(AUTH_USER));
  return true;
}

async function sbFetch(url, options) {
  let r = await fetch(url, options);
  if (r.status === 401) {
    const refreshed = await tryRefreshSession();
    if (refreshed) {
      const newOpts = Object.assign({}, options, { headers: Object.assign({}, options.headers, { 'Authorization': 'Bearer ' + AUTH_TOKEN }) });
      r = await fetch(url, newOpts);
    } else {
      localStorage.removeItem('fa_token'); localStorage.removeItem('fa_refresh'); localStorage.removeItem('fa_user');
      location.reload();
    }
  }
  return r;
}

const sb = {
  auth: {
    getSession: async function() { return { data: { session: AUTH_USER ? { user: AUTH_USER } : null } }; },
    signInWithPassword: async function(creds) {
      const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(creds) });
      const d = await r.json();
      if (!r.ok) return { error: { message: d.error_description || d.msg || 'Identifiants incorrects' } };
      AUTH_TOKEN = d.access_token; REFRESH_TOKEN = d.refresh_token; AUTH_USER = d.user;
      localStorage.setItem('fa_token', AUTH_TOKEN); localStorage.setItem('fa_refresh', REFRESH_TOKEN); localStorage.setItem('fa_user', JSON.stringify(AUTH_USER));
      return { data: { user: d.user } };
    },
    signUp: async function(creds) {
      const r = await fetch(SUPABASE_URL + '/auth/v1/signup', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(creds) });
      const d = await r.json();
      if (!r.ok) return { error: { message: d.msg || d.error_description || 'Erreur création compte' } };
      AUTH_TOKEN = d.access_token; REFRESH_TOKEN = d.refresh_token; AUTH_USER = d.user;
      if (AUTH_TOKEN) { localStorage.setItem('fa_token', AUTH_TOKEN); localStorage.setItem('fa_refresh', REFRESH_TOKEN); localStorage.setItem('fa_user', JSON.stringify(AUTH_USER)); }
      return { data: { user: d.user } };
    },
    signOut: async function() {
      localStorage.removeItem('fa_token'); localStorage.removeItem('fa_refresh'); localStorage.removeItem('fa_user');
    }
  },
  from: function(table) {
    let url = SUPABASE_URL + '/rest/v1/' + table + '?select=*';
    let isSingle = false;
    const q = {
      select: function() { return q; },
      eq: function(col, val) { url += '&' + col + '=eq.' + encodeURIComponent(val); return q; },
      order: function(col, opts) { url += '&order=' + col + '.' + (opts && opts.ascending === false ? 'desc' : 'asc'); return q; },
      limit: function(n) { url += '&limit=' + n; return q; },
      single: function() { isSingle = true; return q; },
      then: async function(resolve) {
        const h = apiHeaders();
        if (isSingle) h['Accept'] = 'application/vnd.pgrst.object+json';
        const r = await sbFetch(url, { headers: h });
        const d = await r.json().catch(function() { return null; });
        resolve(r.ok ? { data: d } : { error: d });
      },
      insert: async function(payload) {
        const r = await sbFetch(SUPABASE_URL + '/rest/v1/' + table, { method: 'POST', headers: Object.assign({}, apiHeaders(), { 'Prefer': 'return=representation' }), body: JSON.stringify(payload) });
        const d = await r.json().catch(function() { return null; });
        return r.ok ? { data: d } : { error: { message: (d && d.message) || 'Erreur insertion' } };
      },
      update: function(payload) {
        return {
          eq: async function(col, val) {
            const r = await sbFetch(SUPABASE_URL + '/rest/v1/' + table + '?' + col + '=eq.' + encodeURIComponent(val), { method: 'PATCH', headers: apiHeaders(), body: JSON.stringify(payload) });
            if (r.ok && typeof refreshAllData === 'function') setTimeout(function() { refreshAllData(true); }, 200);
            return r.ok ? { data: true } : { error: { message: 'Erreur mise à jour' } };
          }
        };
      },
      delete: function() {
        return {
          eq: async function(col, val) {
            const r = await sbFetch(SUPABASE_URL + '/rest/v1/' + table + '?' + col + '=eq.' + encodeURIComponent(val), { method: 'DELETE', headers: apiHeaders() });
            if (r.ok && typeof refreshAllData === 'function') setTimeout(function() { refreshAllData(true); }, 200);
            return r.ok ? { data: true } : { error: { message: 'Erreur suppression' } };
          }
        };
      }
    };
    return q;
  },
  channel: function() {
    setInterval(function() { if (typeof refreshAllData === 'function' && CURRENT_USER) refreshAllData(false); }, 4000);
    return { on: function() { return this; }, subscribe: function() {} };
  }
};

let RULES = null, CURRENT_USER = null, CHARACTERS = [], SCENE = null, COMBAT = null, ROLLS = [], LAST_SNAPSHOT = '';
let CREATE_CARACS = { Force: 8, Agilité: 8, Santé: 8, Connaissance: 8, Perception: 8, Présence: 8 };
let CREATE_PORTRAIT = '';
let ACTIVE_RITUELS = {};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function toggleFold(id) {
  const box = document.getElementById(id);
  const icon = document.getElementById('icon-' + id);
  const hidden = box.classList.toggle('hidden');
  if (icon) icon.textContent = hidden ? '▶ Afficher' : '▼ Masquer';
}

function switchTab(tab) {
  ['play', 'combat', 'manage'].forEach(function(t) {
    document.getElementById('tab-' + t).classList.toggle('hidden', t !== tab);
    const btn = document.getElementById('tab-btn-' + t);
    btn.className = (t === tab) ? 'bg-amber-700' : '';
    btn.style.background = (t === tab) ? '#92400e' : '#57534e';
    btn.style.color = '#fff';
  });
}
async function init() {
  const res = await sb.auth.getSession();
  if (res.data && res.data.session) {
    CURRENT_USER = res.data.session.user;
    await bootApp();
  }
}

async function signIn() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const res = await sb.auth.signInWithPassword({ email: email, password: password });
  if (res.error) { document.getElementById('auth-msg').textContent = "Erreur : " + res.error.message; return; }
  CURRENT_USER = res.data.user;
  await bootApp();
}

async function signUp() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const res = await sb.auth.signUp({ email: email, password: password });
  if (res.error) { document.getElementById('auth-msg').textContent = "Erreur : " + res.error.message; return; }
  if (res.data && res.data.user) { CURRENT_USER = res.data.user; await bootApp(); }
}

async function signOut() {
  await sb.auth.signOut();
  location.reload();
}

async function bootApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  document.getElementById('user-display').textContent = CURRENT_USER.email;

  const res = await sb.from('game_rules').select('rules').eq('id', 1).single();
  if (res.error || !res.data) { alert("Impossible de charger les règles depuis Supabase."); return; }
  RULES = res.data.rules;
  initCreationForm();
  initSceneSelectors();
  await refreshAllData(true);
  sb.channel('table-changes').subscribe();
}

async function refreshAllData(force) {
  const results = await Promise.all([
    sb.from('characters').select('*').order('created_at', { ascending: true }),
    sb.from('scene_state').select('*').eq('id', 1).single(),
    sb.from('roll_history').select('*').order('created_at', { ascending: false }).limit(40),
    sb.from('combat_state').select('*').eq('id', 1).single()
  ]);
  const newChars = results.at(0).data || [];
  const newScene = results.at(1).data || { environment: 'Normal', cover_terrain: 'Aucun', cover_obstacle: 'Aucun', cover_noise: 'Normal', cover_light: 'Normale' };
  const newRolls = results.at(2).data || [];
  const newCombat = results.at(3).data || { status: 'inactif', participants: [] };

  const snapshot = JSON.stringify({ c: newChars, s: newScene, r: newRolls, cb: newCombat });
  if (!force && snapshot === LAST_SNAPSHOT) return;

  const activeTag = document.activeElement ? document.activeElement.tagName : '';
  if (!force && (activeTag === 'SELECT' || activeTag === 'INPUT')) return;

  LAST_SNAPSHOT = snapshot;
  CHARACTERS = newChars;
  SCENE = newScene;
  ROLLS = newRolls;
  COMBAT = newCombat;

  syncSceneUI();
  syncCharacterDropdowns();
  renderPlaySheet();
  renderRollHistory();
  renderManageSheet();
  renderCombat();
}

function getEffectiveState(char) {
  const d = char.data;
  const effLvl = char.effective_level || char.level;
  const caracs = Object.assign({}, d.base_caracs);
  if (d.peuple_carac) caracs[d.peuple_carac] = (caracs[d.peuple_carac] || 8) + 1;
  if (d.culture_carac) caracs[d.culture_carac] = (caracs[d.culture_carac] || 8) + 1;

  const lvlUpCaracs = d.level_caracs || {};
  Object.keys(lvlUpCaracs).forEach(function(lvl) {
    if (parseInt(lvl) <= effLvl && lvlUpCaracs[lvl]) {
      caracs[lvlUpCaracs[lvl]] = (caracs[lvlUpCaracs[lvl]] || 8) + 1;
    }
  });

  let talents = (d.talents_lvl1 || []).slice();
  const lvlUpTalents = d.level_talents || {};
  Object.keys(lvlUpTalents).forEach(function(lvl) {
    if (parseInt(lvl) <= effLvl) {
      talents = talents.concat(lvlUpTalents[lvl] || []);
    }
  });

  let sorts = (d.sorts || []).slice();
  const lvlUpSorts = d.level_sorts || {};
  Object.keys(lvlUpSorts).forEach(function(lvl) {
    if (parseInt(lvl) <= effLvl) {
      sorts = sorts.concat(lvlUpSorts[lvl] || []);
    }
  });

  const blessures = d.blessures || {};
  let maxWoundMalus = 0;
  let limbDisabled = false;
  Object.values(blessures).forEach(function(b) {
    if (b && b.gravite > 0) {
      if (b.gravite === 1) maxWoundMalus = Math.max(maxWoundMalus, 1);
      if (b.gravite === 2) maxWoundMalus = Math.max(maxWoundMalus, 2);
      if (b.gravite === 3) maxWoundMalus = Math.max(maxWoundMalus, 4);
      if (b.gravite === 4) maxWoundMalus = Math.max(maxWoundMalus, 6);
      if (b.gravite >= 5) { maxWoundMalus = Math.max(maxWoundMalus, 6); limbDisabled = true; }
    }
  });

  const inv = d.inventaire || [];
  const worn = d.worn || {};
  const equipped = d.equipped || {};
  let totalWeight = 0;
  inv.forEach(function(item) { totalWeight += (item.poids || 0); });

  let armorDef = 0;
  let rawArmorMalusAgi = 0;
  ['Tete', 'Torse', 'Bassin', 'BrasDroit', 'BrasGauche', 'Jambes'].forEach(function(slot) {
    const eqItem = equipped[slot];
    if (eqItem) {
      totalWeight += (eqItem.poids || 0);
      armorDef += (eqItem.def || 0);
      rawArmorMalusAgi += (eqItem.malus_agi || 0);
    } else if (worn[slot] !== undefined && worn[slot] !== null && inv.at(worn[slot])) {
      armorDef += (inv.at(worn[slot]).def || 0);
      rawArmorMalusAgi += (inv.at(worn[slot]).malus_agi || 0);
    }
  });

  ['MainPrincipale', 'MainSecondaire', 'Monture'].forEach(function(slot) {
    if (equipped[slot]) totalWeight += (equipped[slot].poids || 0);
  });

  const normTalents = talents.map(function(t) {
    return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  });

  let armorMalusAgi = Math.floor(rawArmorMalusAgi);
  if (normTalents.includes('entrainement aux armures legeres')) armorMalusAgi = Math.max(0, armorMalusAgi - 2);
  if (normTalents.includes('entrainement aux armures lourdes')) armorMalusAgi = Math.max(0, armorMalusAgi - 2);

  caracs['Agilité'] = (caracs['Agilité'] || 8) - armorMalusAgi;

  let maxWeight = caracs['Force'] * 2;
  if (talents.includes('Transport')) maxWeight += 8;
  if (talents.includes('Chargement')) maxWeight += 8;
  const encumbered = totalWeight > maxWeight;

  const emotionObj = RULES.emotions.find(function(e) { return e.nom === (d.emotion || 'Aucune'); }) || { comp: 0, att: 0, def: 0 };
  const fatigue = d.fatigue || 0;

  return { caracs: caracs, talents: talents, sorts: sorts, normTalents: normTalents, maxWoundMalus: maxWoundMalus, limbDisabled: limbDisabled, totalWeight: totalWeight, maxWeight: maxWeight, encumbered: encumbered, armorDef: armorDef, armorMalusAgi: armorMalusAgi, emotionObj: emotionObj, fatigue: fatigue, worn: worn, equipped: equipped, inv: inv, blessures: blessures, talentChoices: talentChoices };
}
function getCoverTotals() {
  const t = RULES.couverture.terrain.find(function(x) { return x.nom === SCENE.cover_terrain; }) || { malus: 0, bonus: 0 };
  const o = RULES.couverture.obstacles.find(function(x) { return x.nom === SCENE.cover_obstacle; }) || { malus: 0, bonus: 0 };
  const n = RULES.couverture.bruit.find(function(x) { return x.nom === SCENE.cover_noise; }) || { malus: 0, bonus: 0 };
  const l = RULES.couverture.luminosite.find(function(x) { return x.nom === SCENE.cover_light; }) || { malus: 0, bonus: 0 };
  return { malus: t.malus + o.malus + n.malus + l.malus, bonus: t.bonus + o.bonus + n.bonus + l.bonus };
}

function initSceneSelectors() {
  const fill = function(id, list) {
    const sel = document.getElementById(id);
    sel.innerHTML = '';
    list.forEach(function(x) {
      const val = x.nom || x;
      const opt = el('option', '', val);
      opt.value = val;
      sel.appendChild(opt);
    });
  };
  fill('scene-env', RULES.milieux);
  fill('scene-terrain', RULES.couverture.terrain);
  fill('scene-obstacle', RULES.couverture.obstacles);
  fill('scene-noise', RULES.couverture.bruit);
  fill('scene-light', RULES.couverture.luminosite);
}

function syncSceneUI() {
  if (!SCENE) return;
  document.getElementById('scene-env').value = SCENE.environment;
  document.getElementById('scene-terrain').value = SCENE.cover_terrain;
  document.getElementById('scene-obstacle').value = SCENE.cover_obstacle;
  document.getElementById('scene-noise').value = SCENE.cover_noise;
  document.getElementById('scene-light').value = SCENE.cover_light;
  const cov = getCoverTotals();
  document.getElementById('scene-cover-summary').textContent = 'Couverture globale : Malus ' + cov.malus + ' / Bonus +' + cov.bonus + ' | Milieu : ' + SCENE.environment;
  const mini = document.getElementById('play-scene-mini');
  if (mini) mini.textContent = 'Scène : ' + SCENE.environment + ' | Couv. ' + cov.malus + ' / +' + cov.bonus;
}

async function updateScene() {
  await sb.from('scene_state').update({
    environment: document.getElementById('scene-env').value,
    cover_terrain: document.getElementById('scene-terrain').value,
    cover_obstacle: document.getElementById('scene-obstacle').value,
    cover_noise: document.getElementById('scene-noise').value,
    cover_light: document.getElementById('scene-light').value
  }).eq('id', 1);
}

function syncCharacterDropdowns() {
  const myChars = CHARACTERS.filter(function(c) { return c.owner_id === CURRENT_USER.id; });
  const activeSel = document.getElementById('active-char-select');
  const prevActive = activeSel.value;
  activeSel.innerHTML = '';
  myChars.forEach(function(c) {
    const opt = el('option', '', c.name + ' (Niv.' + c.effective_level + ') ' + (c.is_public ? '' : '[Masqué]'));
    opt.value = c.id;
    activeSel.appendChild(opt);
  });
  if (myChars.some(function(c) { return c.id === prevActive; })) activeSel.value = prevActive;

  const sheetSel = document.getElementById('sheet-char-select');
  const prevSheet = sheetSel.value;
  sheetSel.innerHTML = '';
  CHARACTERS.forEach(function(c) {
    const opt = el('option', '', c.name + ' (Niv.' + c.effective_level + ') — ' + (c.owner_id === CURRENT_USER.id ? 'Moi' : (c.owner_email || 'Joueur')));
    opt.value = c.id;
    sheetSel.appendChild(opt);
  });
  if (CHARACTERS.some(function(c) { return c.id === prevSheet; })) sheetSel.value = prevSheet;

  const combatSel = document.getElementById('combat-add-char');
  combatSel.innerHTML = '';
  myChars.forEach(function(c) {
    const opt = el('option', '', c.name);
    opt.value = c.id;
    combatSel.appendChild(opt);
  });
}

function onSelectPlayChar() {
  ACTIVE_RITUELS = {};
  renderPlaySheet();
}

function renderPlaySheet() {
  const charId = document.getElementById('active-char-select').value;
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const colsDiv = document.getElementById('carac-skill-columns');
  const healthMount = document.getElementById('play-health-mount');
  const magicMount = document.getElementById('play-magic-mount');
  const statusDiv = document.getElementById('active-char-status');
  colsDiv.innerHTML = ''; healthMount.innerHTML = ''; magicMount.innerHTML = '';

  if (!char) {
    document.getElementById('play-char-subtitle').textContent = "Aucun personnage. Créez-en un dans l'onglet 'Gestion & Création'.";
    document.getElementById('play-char-badge').textContent = '';
    document.getElementById('play-portrait').src = '';
    statusDiv.textContent = "Sélectionnez ou créez un personnage.";
    return;
  }

  const st = getEffectiveState(char);
  document.getElementById('play-portrait').src = char.data.portrait || 'data:image/svg+xml;utf8,<svg xmlns="http://w3.org" width="64" height="64"><rect width="64" height="64" fill="%23d6d3d1"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="24" fill="%2357534e">?</text></svg>';
  document.getElementById('play-char-badge').textContent = 'Niv. ' + char.effective_level + (char.effective_level !== char.level ? ' / ' + char.level : '');
  document.getElementById('play-char-subtitle').textContent = char.data.peuple + ' • ' + char.data.culture + ' • ' + char.data.classe + ' • Désir : ' + char.data.desir;

  statusDiv.textContent = 'Fatigue : ' + st.fatigue + '/' + st.caracs['Santé'] + ' | Émotion : ' + (char.data.emotion || 'Aucune') + ' | Blessure max : -' + st.maxWoundMalus + ' | Armure Agi : -' + st.armorMalusAgi + (st.encumbered ? ' | ENCOMBRÉ !' : '');

  RULES.caracteristiques.forEach(function(cName) {
    const val = st.caracs[cName] || 10;
    const mod = val - 10;
    const sign = mod >= 0 ? '+' : '';
    const col = el('div', 'border bg-stone-50 space-y-2');
    const cBtn = el('button', 'bg-amber-800', cName + ' : ' + val + ' (' + sign + mod + ')');
    cBtn.style.width = '100%';
    cBtn.onclick = function() { rollTest(cName, true); };
    col.appendChild(cBtn);

    const listWrap = el('div', 'space-y-2');
    RULES.competences.filter(function(cp) { return cp.carac === cName; }).forEach(function(comp) {
      const sMod = computeSkillModifier(char, st, comp).total;
      const sSign = sMod >= 0 ? '+' : '';
      const sBtn = el('button', 'flex justify-between', '');
      sBtn.style.width = '100%';
      sBtn.style.background = '#fff';
      sBtn.style.fontSize = '12px';
      sBtn.appendChild(el('span', '', comp.nom));
      sBtn.appendChild(el('strong', '', sSign + sMod));
      sBtn.onclick = function() { rollTest(comp.nom, false); };
      listWrap.appendChild(sBtn);
    });
    col.appendChild(listWrap);
    colsDiv.appendChild(col);
  });

  renderHealthBlock(char, st, healthMount, true);
  renderMagicBlock(char, st, magicMount);
}

function computeMagicPower(char, st) {
  let parts = [];
  const modCon = (st.caracs['Connaissance'] || 10) - 10;
  const modPre = (st.caracs['Présence'] || 10) - 10;
  const usePre = modPre > modCon;
  let base = usePre ? modPre : modCon;
  if (!usePre && st.talents.includes('Esotérisme')) { base *= 2; parts.push('Connaissance x2 (Ésotérisme) ' + base); }
  else if (usePre && st.talents.includes('Mysticisme')) { base *= 2; parts.push('Présence x2 (Mysticisme) ' + base); }
  else { parts.push((usePre ? 'Présence ' : 'Connaissance ') + (base >= 0 ? '+' : '') + base); }

  let total = base;
  if (st.talents.includes('Grand art')) { total += 1; parts.push('Grand art +1'); }
  if (st.talents.includes('Subtilité') && Object.values(ACTIVE_RITUELS).every(function(v) { return !v; })) {
    total += 4; parts.push('Subtilité +4');
  }
  Object.keys(ACTIVE_RITUELS).forEach(function(rName) {
    const val = parseInt(ACTIVE_RITUELS[rName] || 0);
    if (val > 0) { total += val; parts.push(rName + ' +' + val); }
  });
  if (st.fatigue > 0) { total -= st.fatigue; parts.push('Fatigue -' + st.fatigue); }
  if (st.emotionObj.comp !== 0) { total += st.emotionObj.comp; parts.push('Émotion ' + st.emotionObj.comp); }
  return { total: total, parts: parts };
}

function renderMagicBlock(char, st, mount) {
  const baseRituels = new Array('Formule', 'Gestuelle', 'Inscription', 'Catalyseur', 'Ingrédient', 'Transe');
  const talentRituels = new Array('Danse sacrée', 'Extase', 'Horoscope', 'Humilité', 'Incantation', 'Invocation', 'Méditation', 'Momentum', 'Pacifisme', 'Pauvreté', 'Pureté', 'Sacrifice', 'Solennité', 'Talisman', 'Assistance', 'Potion', 'Alchimie', 'Elixir');
  const ownedTalentRituels = talentRituels.filter(function(r) { return st.talents.includes(r); });

  const ritBox = el('div', 'bg-purple-50 border space-y-2');
  ritBox.appendChild(el('strong', '', 'Rituels de base (accessibles à tout lanceur de sorts) :'));
  const baseGrid = el('div', 'flex');
  baseRituels.forEach(function(rName) {
    const wrap = el('label', 'border', '');
    wrap.style.background = '#fff'; wrap.style.fontSize = '12px';
    const sel = el('select', '');
    sel.style.marginLeft = '6px';
    new Array(0, 1, 2).forEach(function(v) {
      const o = el('option', '', v === 0 ? 'Inactif' : '+' + v);
      o.value = v;
      if ((ACTIVE_RITUELS[rName] || 0) == v) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function() { ACTIVE_RITUELS[rName] = parseInt(sel.value); renderPlaySheet(); };
    wrap.appendChild(document.createTextNode(rName));
    wrap.appendChild(sel);
    baseGrid.appendChild(wrap);
  });
  ritBox.appendChild(baseGrid);

  if (ownedTalentRituels.length > 0) {
    ritBox.appendChild(el('strong', '', 'Rituels & Préparations de talents :'));
    const rGrid = el('div', 'flex');
    ownedTalentRituels.forEach(function(rName) {
      const wrap = el('label', 'border', '');
      wrap.style.background = '#fff'; wrap.style.fontSize = '12px';
      const sel = el('select', '');
      sel.style.marginLeft = '6px';
      new Array(0, 1, 2, 3, 4).forEach(function(v) {
        const o = el('option', '', v === 0 ? 'Inactif' : '+' + v);
        o.value = v;
        if ((ACTIVE_RITUELS[rName] || 0) == v) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = function() { ACTIVE_RITUELS[rName] = parseInt(sel.value); renderPlaySheet(); };
      wrap.appendChild(document.createTextNode(rName));
      wrap.appendChild(sel);
      rGrid.appendChild(wrap);
    });
    ritBox.appendChild(rGrid);
  }
  mount.appendChild(ritBox);

  const pow = computeMagicPower(char, st);
  const pSign = pow.total >= 0 ? '+' : '';
  const pBtn = el('button', 'bg-purple-700', 'Test de Pouvoir brut (1d20 ' + pSign + pow.total + ')');
  pBtn.style.width = '100%';
  pBtn.onclick = function() { rollMagicTest(char, 'Pouvoir brut', pow); };
  mount.appendChild(pBtn);

  const knownSpells = st.sorts || [];
  const spBox = el('div', 'border space-y-2');
  spBox.appendChild(el('strong', '', 'Sorts connus (' + knownSpells.length + ') :'));
  if (knownSpells.length === 0) {
    spBox.appendChild(el('div', '', 'Aucun sort appris (géré lors du passage de niveau).'));
  } else {
    const spGrid = el('div', 'grid grid-cols-2');
    knownSpells.forEach(function(sp) {
      const bCast = el('button', 'border bg-stone-50', sp.nom + ' (' + sp.voie + ') — 1d20 ' + pSign + pow.total);
      bCast.style.textAlign = 'left';
      bCast.onclick = function() { rollMagicTest(char, sp.nom + ' (' + sp.voie + ')', pow); };
      spGrid.appendChild(bCast);
    });
    spBox.appendChild(spGrid);
  }
  mount.appendChild(spBox);
}




async function rollMagicTest(char, label, pow) {
const d20 = Math.floor(Math.random() * 20) + 1;
const total = d20 + pow.total;
const details = '1d20 (' + d20 + ') | ' + pow.parts.join(', ');
await sb.from('roll_history').insert({
character_id: char.id, owner_id: CURRENT_USER.id, character_name: char.name,
is_public: char.is_public, skill_name: 'Magie : ' + label, total: total, details: details
});
}
function computeSkillModifier(char, st, comp) {
  let parts = [];
  const baseMod = (st.caracs[comp.carac] || 10) - 10;
  let total = baseMod;
  parts.push(comp.carac + ' ' + (baseMod >= 0 ? '+' : '') + baseMod);

  st.talents.forEach(function(tName) {
    const tObj = RULES.talents.find(function(x) { return x.nom === tName; });
    if (tObj && tObj.comp_bonus && tObj.comp_bonus[comp.nom]) {
      total += tObj.comp_bonus[comp.nom];
      parts.push(tName + ' +' + tObj.comp_bonus[comp.nom]);
    }
  });

const adaptMilieux = (st.talentChoices && st.talentChoices['Adaptation']) ? st.talentChoices['Adaptation'] : [];
if (st.talents.includes('Adaptation') && adaptMilieux.includes(SCENE.environment)) {
  if (['Déplacement', 'Détection', 'Discrétion', 'Equilibre', 'Chasse', 'Orientation'].includes(comp.nom)) {
    total += 1;
    parts.push('Adaptation (' + SCENE.environment + ') +1');
  }
}

  if (comp.nom !== 'Résistance' && st.fatigue > 0) {
    total -= st.fatigue;
    parts.push('Fatigue -' + st.fatigue);
  }
  if (st.emotionObj.comp !== 0) {
    total += st.emotionObj.comp;
    parts.push('Émotion ' + (st.emotionObj.comp >= 0 ? '+' : '') + st.emotionObj.comp);
  }
  if (['Force', 'Agilité'].includes(comp.carac) && st.maxWoundMalus > 0) {
    total -= st.maxWoundMalus;
    parts.push('Blessure -' + st.maxWoundMalus);
  }

  const cov = getCoverTotals();
  if (comp.couverture === 'malus' && cov.malus !== 0) {
    let cMalus = cov.malus;
    if (st.talents.includes('Nyctalopie') && SCENE.cover_light === 'Obscurité relative') cMalus += 1;
    if (st.talents.includes('Filature') && comp.nom === 'Détection' && SCENE.environment === 'Urbain') cMalus = 0;
    if (cMalus !== 0) { total += cMalus; parts.push('Couverture ' + cMalus); }
  } else if (comp.couverture === 'bonus' && cov.bonus !== 0) {
    total += cov.bonus;
    parts.push('Couverture +' + cov.bonus);
  }
  return { total: total, parts: parts };
}

async function rollTest(name, isCarac) {
  const charId = document.getElementById('active-char-select').value;
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  if (!char) return;
  const st = getEffectiveState(char);
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  const d3 = Math.floor(Math.random() * 6) + 1;
  const diceSum = d1 + d2 + d3;

  let mod = 0;
  let details = '3d6 (' + d1 + '+' + d2 + '+' + d3 + '=' + diceSum + ')';
  if (isCarac) {
    mod = (st.caracs[name] || 10) - 10;
    if (st.fatigue > 0) mod -= st.fatigue;
    if (['Force', 'Agilité'].includes(name) && st.maxWoundMalus > 0) mod -= st.maxWoundMalus;
    details += ' | Mod ' + (mod >= 0 ? '+' : '') + mod;
  } else {
    const comp = RULES.competences.find(function(c) { return c.nom === name; });
    const res = computeSkillModifier(char, st, comp);
    mod = res.total;
    details += ' | ' + res.parts.join(', ');
  }
  const total = diceSum + mod;
  await sb.from('roll_history').insert({
    character_id: char.id, owner_id: CURRENT_USER.id, character_name: char.name,
    is_public: char.is_public, skill_name: name, total: total, details: details
  });
}

function renderRollHistory() {
  const list = document.getElementById('roll-history-list');
  list.innerHTML = '';
  ROLLS.forEach(function(r) {
    const card = el('div', 'border bg-stone-50');
    const top = el('div', 'flex justify-between');
    top.appendChild(el('strong', '', r.character_name + (r.is_public ? '' : ' [Masqué]') + ' — ' + r.skill_name));
    top.appendChild(el('strong', '', r.total));
    card.appendChild(top);
    const det = el('div', '', r.details);
    det.style.color = '#57534e'; det.style.fontSize = '11px';
    card.appendChild(det);
    list.appendChild(card);
  });
}

function renderHealthBlock(char, st, container, isOwner) {
  const hRow = el('div', 'flex');
  const selEmo = el('select', '');
  selEmo.disabled = !isOwner;
  RULES.emotions.forEach(function(e) {
    const o = el('option', '', e.nom + ' (Comp ' + e.comp + ', Att ' + e.att + ', Déf ' + e.def + ')');
    o.value = e.nom;
    if ((char.data.emotion || 'Aucune') === e.nom) o.selected = true;
    selEmo.appendChild(o);
  });
  selEmo.onchange = function() { updateCharField(char.id, 'emotion', selEmo.value); };
  hRow.appendChild(selEmo);

  const fatWrap = el('div', 'flex border bg-stone-50');
  fatWrap.appendChild(el('span', '', 'Fatigue (' + st.fatigue + ' / ' + st.caracs['Santé'] + ')'));
  if (isOwner) {
    const bFm = el('button', '', '-'); bFm.onclick = function() { changeFatigue(char.id, -1); }; fatWrap.appendChild(bFm);
    const bFp = el('button', '', '+'); bFp.onclick = function() { changeFatigue(char.id, 1); }; fatWrap.appendChild(bFp);
  }
  hRow.appendChild(fatWrap);

  if (isOwner) {
    const lblMed = el('label', 'flex');
    const chkMed = el('input', ''); chkMed.type = 'checkbox'; chkMed.id = 'rest-med-' + char.id;
    lblMed.appendChild(chkMed); lblMed.appendChild(document.createTextNode('Soin/Médecine'));
    hRow.appendChild(lblMed);
    const bRc = el('button', 'bg-emerald-700', 'Repos court (2h)'); bRc.onclick = function() { takeRest(char.id, 'court'); };
    const bRl = el('button', 'bg-emerald-800', 'Repos long (10h)'); bRl.onclick = function() { takeRest(char.id, 'long'); };
    const bFiev = el('button', 'bg-amber-800', 'Test Fièvre (D10)'); bFiev.onclick = function() { rollFeverTest(char.id); };
    hRow.appendChild(bRc); hRow.appendChild(bRl); hRow.appendChild(bFiev);
  }
  container.appendChild(hRow);

  const wTop = el('div', 'flex justify-between');
  wTop.appendChild(el('strong', '', 'Blessures localisées'));
  if (isOwner) {
    const wBtns = el('div', 'flex');
    new Array('legere', 'moyenne', 'grave').forEach(function(tp) {
      const b = el('button', 'bg-rose-700', '+ ' + tp);
      b.style.fontSize = '11px';
      b.onclick = function() { rollRandomWound(char.id, tp); };
      wBtns.appendChild(b);
    });
    wTop.appendChild(wBtns);
  }
  container.appendChild(wTop);

  const wGrid = el('div', 'grid grid-cols-3');
  new Array('Tête', 'Torse', 'Ventre/Bassin', 'Bras droit', 'Bras gauche', 'Jambe(s)').forEach(function(loc) {
    const b = st.blessures[loc] || { gravite: 0, infectee: false, jours: 0 };
    const card = el('div', 'border ' + (b.gravite > 0 ? 'bg-rose-50' : 'bg-stone-50'));
    card.appendChild(el('strong', '', loc + (b.infectee ? ' [INFECTÉE]' : '')));
    const info = el('div', '', b.gravite > 0 ? 'Gravité ' + b.gravite + ' (' + b.jours + 'j)' : 'Indemne');
    info.style.fontSize = '11px';
    card.appendChild(info);
    if (isOwner) {
      const gRow = el('div', 'flex');
      gRow.style.marginTop = '4px'; gRow.style.gap = '3px';
      new Array(0, 1, 2, 3, 4, 5, 6).forEach(function(g) {
        const gb = el('button', b.gravite === g ? 'bg-rose-800' : '', 'G' + g);
        gb.style.padding = '2px 5px'; gb.style.fontSize = '10px';
        gb.onclick = function() { setWoundLevel(char.id, loc, g); };
        gRow.appendChild(gb);
      });
      card.appendChild(gRow);
    }
    wGrid.appendChild(card);
  });
  container.appendChild(wGrid);
}


function toggleCreateForm() {
  const wrap = document.getElementById('create-form-wrapper');
  const isOpening = wrap.classList.contains('hidden');
  if (isOpening) {
    resetCreationForm();
    wrap.classList.remove('hidden');
  } else {
    cancelCreation();
  }
}

function cancelCreation() {
  resetCreationForm();
  document.getElementById('create-form-wrapper').classList.add('hidden');
}

function resetCreationForm() {
  CREATE_CARACS = { Force: 8, Agilité: 8, Santé: 8, Connaissance: 8, Perception: 8, Présence: 8 };
  CREATE_PORTRAIT = '';
  if (RULES) initCreationForm();
}


function handlePortraitUpload(input) {
  const file = input.files.at(0);
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 128, 128);
      CREATE_PORTRAIT = canvas.toDataURL('image/jpeg', 0.75);
      const prev = document.getElementById('c-portrait-preview');
      if (prev) prev.src = CREATE_PORTRAIT;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function initCreationForm() {
  const mount = document.getElementById('create-form-mount');
  mount.innerHTML = '';
  mount.appendChild(el('h3', '', "Création guidée d'un personnage (Niveau 1)"));

  const row1 = el('div', 'grid grid-cols-3');
  const colName = el('div', '');
  colName.appendChild(el('div', '', 'Nom du personnage *'));
  const inpName = el('input', ''); inpName.id = 'c-name'; inpName.type = 'text'; inpName.style.width = '90%';
  colName.appendChild(inpName);
  row1.appendChild(colName);

  const colDesire = el('div', '');
  colDesire.appendChild(el('div', '', 'Désir fondamental'));
  const selDesire = el('select', ''); selDesire.id = 'c-desire'; selDesire.style.width = '95%';
  RULES.desirs.forEach(function(d) { const o = el('option', '', d); o.value = d; selDesire.appendChild(o); });
  colDesire.appendChild(selDesire);
  row1.appendChild(colDesire);

  const colPort = el('div', 'flex');
  const prevImg = el('img', 'portrait-img'); prevImg.id = 'c-portrait-preview';
  prevImg.src = 'data:image/svg+xml;utf8,<svg xmlns="http://w3.org" width="64" height="64"><rect width="64" height="64" fill="%23d6d3d1"/></svg>';
  const inpFile = el('input', ''); inpFile.type = 'file'; inpFile.accept = 'image/*'; inpFile.style.fontSize = '11px';
  inpFile.onchange = function() { handlePortraitUpload(inpFile); };
  colPort.appendChild(prevImg); colPort.appendChild(inpFile);
  row1.appendChild(colPort);
  mount.appendChild(row1);

  const lblPub = el('label', 'flex');
  const chkPub = el('input', ''); chkPub.id = 'c-public'; chkPub.type = 'checkbox'; chkPub.checked = true;
  lblPub.appendChild(chkPub); lblPub.appendChild(document.createTextNode(' Visible par tous les joueurs'));
  mount.appendChild(lblPub);

  const topCarac = el('div', 'flex justify-between');
  topCarac.appendChild(el('strong', '', '1. Caractéristiques (Base 8, max 12 avant bonus)'));
  const ptsBadge = el('strong', '', 'Points restants : 14'); ptsBadge.id = 'c-points-left';
  topCarac.appendChild(ptsBadge);
  mount.appendChild(topCarac);

  const gridCarac = el('div', 'grid grid-cols-6');
  RULES.caracteristiques.forEach(function(c) {
    const box = el('div', 'border bg-stone-50');
    box.style.textAlign = 'center';
box.appendChild(el('div', '', c));
const ctrl = el('div', 'flex');
ctrl.style.justifyContent = 'center'; ctrl.style.marginTop = '4px';
const bMinus = el('button', '', '-'); bMinus.onclick = function() { changeCreateCarac(c, -1); };
const valSpan = el('strong', '', '8'); valSpan.id = 'cc-' + c;
const bPlus = el('button', '', '+'); bPlus.onclick = function() { changeCreateCarac(c, 1); };
ctrl.appendChild(bMinus); ctrl.appendChild(valSpan); ctrl.appendChild(bPlus);
box.appendChild(ctrl);
gridCarac.appendChild(box);
});
mount.appendChild(gridCarac);
const secOrigin = el('div', 'grid grid-cols-2');
const divP = el('div', 'space-y-2');
divP.appendChild(el('strong', '', '2. Peuple'));
const selP = el('select', ''); selP.id = 'c-peuple'; selP.style.width = '100%'; selP.onchange = updateCreationChoices;
RULES.peuples.forEach(function(p) { const o = el('option', '', p.nom); o.value = p.nom; selP.appendChild(o); });
const selPC = el('select', ''); selPC.id = 'c-peuple-carac'; selPC.style.width = '100%'; selPC.onchange = updateCreationTalents;
const selPT = el('select', ''); selPT.id = 'c-peuple-talent'; selPT.style.width = '100%'; selPT.onchange = updateCreationTalents;
divP.appendChild(selP); divP.appendChild(selPC); divP.appendChild(selPT);
secOrigin.appendChild(divP);
const divC = el('div', 'space-y-2');
divC.appendChild(el('strong', '', '3. Culture'));
const selC = el('select', ''); selC.id = 'c-culture'; selC.style.width = '100%'; selC.onchange = updateCreationChoices;
RULES.cultures.forEach(function(c) { const o = el('option', '', c.nom); o.value = c.nom; selC.appendChild(o); });
const selCC = el('select', ''); selCC.id = 'c-culture-carac'; selCC.style.width = '100%'; selCC.onchange = updateCreationTalents;
const selCT = el('select', ''); selCT.id = 'c-culture-talent'; selCT.style.width = '100%'; selCT.onchange = updateCreationTalents;
divC.appendChild(selC); divC.appendChild(selCC); divC.appendChild(selCT);
secOrigin.appendChild(divC);
mount.appendChild(secOrigin);
mount.appendChild(el('strong', '', '4. Classe (Choisissez 4 talents éligibles)'));
const selCl = el('select', ''); selCl.id = 'c-classe'; selCl.style.width = '100%'; selCl.onchange = updateCreationTalents;
RULES.classes.forEach(function(c) { const o = el('option', '', c.nom); o.value = c.nom; selCl.appendChild(o); });
mount.appendChild(selCl);
const clGrid = el('div', 'grid grid-cols-2'); clGrid.id = 'c-classe-talents';
mount.appendChild(clGrid);
  const btnRow = el('div', 'flex');
  const btnSave = el('button', 'bg-amber-800', 'Créer le personnage');
  btnSave.style.flex = '2';
  btnSave.onclick = saveNewCharacter;

  const btnCancel = el('button', '', 'Annuler la création');
  btnCancel.style.flex = '1';
  btnCancel.onclick = cancelCreation;

  btnRow.appendChild(btnSave);
  btnRow.appendChild(btnCancel);
  mount.appendChild(btnRow);

updateCreationChoices();
}
function changeCreateCarac(c, delta) {
  const used = Object.values(CREATE_CARACS).reduce(function(a, b) { return a + (b - 8); }, 0);
  if (delta > 0 && (used >= 14 || CREATE_CARACS[c] >= 12)) return;
  if (delta < 0 && CREATE_CARACS[c] <= 8) return;
  CREATE_CARACS[c] += delta;
  document.getElementById('cc-' + c).textContent = CREATE_CARACS[c];
  document.getElementById('c-points-left').textContent = 'Points restants : ' + (14 - (used + delta));
  updateCreationTalents();
}

function getCreationTempCaracs() {
  const res = Object.assign({}, CREATE_CARACS);
  const pc = document.getElementById('c-peuple-carac').value;
  const cc = document.getElementById('c-culture-carac').value;
  if (pc) res[pc] += 1;
  if (cc) res[cc] += 1;
  return res;
}




function getSpellSlotsForTalents(tList) {
  let slots = [];
  tList.forEach(function(t) {
    if (t === 'Initiation magique') slots.push('Initiation magique (1 sort)');
    if (t === 'Apprentissage magique') { slots.push('Apprentissage magique (Sort 1)'); slots.push('Apprentissage magique (Sort 2)'); }
    if (t === 'Maîtrise magique') { slots.push('Maîtrise magique (Sort 1)'); slots.push('Maîtrise magique (Sort 2)'); }
  });
  return slots;
}

function updateCreationChoices() {
  const pObj = RULES.peuples.find(function(p) { return p.nom === document.getElementById('c-peuple').value; });
  const selPC = document.getElementById('c-peuple-carac');
  selPC.innerHTML = '';
  pObj.caracs.forEach(function(c) { const o = el('option', '', 'Bonus Peuple : +1 ' + c); o.value = c; selPC.appendChild(o); });

  const cObj = RULES.cultures.find(function(c) { return c.nom === document.getElementById('c-culture').value; });
  const selCC = document.getElementById('c-culture-carac');
  selCC.innerHTML = '';
  cObj.caracs.forEach(function(c) { const o = el('option', '', 'Bonus Culture : +1 ' + c); o.value = c; selCC.appendChild(o); });

  updateCreationTalents();
}



function onClassTalentToggle(chk) {
  const checked = document.querySelectorAll('input[name="c-cl-talent"]:checked');
  if (checked.length > 4) {
    chk.checked = false;
    alert("Vous ne pouvez choisir que 4 talents de classe.");
    return;
  }
  updateCreationTalents();
}

function getChoicesForTalent(tName) {
  const t = RULES.talents.find(function(x) { return x.nom === tName; });
  if (!t) return null;
  if (t.choix && t.choix.length > 0) return t.choix;
  if (tName === 'Affinité magique') return (RULES.voies_magiques || []).map(function(v) { return v.voie; });
  if (tName === 'Spécialisation magique' || tName === 'Entraînement magique') {
    let allSorts = [];
    (RULES.voies_magiques || []).forEach(function(v) { allSorts = allSorts.concat(v.sorts); });
    return allSorts;
  }
  return null;
}

function isTalentEligible(talentName, caracs, acquiredTalents, targetLevel, acquiredChoicesMap) {
  const lvl = targetLevel || 1;
  const t = RULES.talents.find(function(x) { return x.nom === talentName; });
  if (!t) return false;
  if (t.niveau_min && t.niveau_min > lvl) return false;
  const count = acquiredTalents.filter(function(x) { return x === talentName; }).length;
  const choicesList = getChoicesForTalent(talentName);
  const allowMulti = Boolean(t.cumulable || choicesList);
  if (!allowMulti && count >= 1) return false;
  if (t.max_prises && count >= t.max_prises) return false;
  if (choicesList && acquiredChoicesMap && acquiredChoicesMap[talentName]) {
    if (acquiredChoicesMap[talentName].length >= choicesList.length) return false;
  }
  const reqC = t.caracs || {};
  for (const c of Object.keys(reqC)) {
    if ((caracs[c] || 0) < reqC[c]) return false;
  }
  const reqT = t.talents || [];
  for (let i = 0; i < reqT.length; i++) {
    if (!acquiredTalents.includes(reqT[i])) return false;
  }
  return true;
}

let CREATE_SUBCHOICES = { peuple: '', culture: '', classe: {} };

function updateCreationTalents() {
  const caracs = getCreationTempCaracs();
  const pObj = RULES.peuples.find(function(p) { return p.nom === document.getElementById('c-peuple').value; });
  const cObj = RULES.cultures.find(function(c) { return c.nom === document.getElementById('c-culture').value; });
  const clObj = RULES.classes.find(function(c) { return c.nom === document.getElementById('c-classe').value; });

  const prevChecked = Array.from(document.querySelectorAll('input[name="c-cl-talent"]:checked')).map(function(x) { return x.value; });

  const pSel = document.getElementById('c-peuple-talent');
  const prevP = pSel.value;
  pSel.innerHTML = '';
  pObj.talents.forEach(function(tName) {
    const ok = isTalentEligible(tName, caracs, [], 1, {});
    const o = el('option', '', 'Talent Peuple : ' + tName + (ok ? '' : ' (Prérequis non remplis)'));
    o.value = tName; o.disabled = !ok;
    pSel.appendChild(o);
  });
  if (pObj.talents.includes(prevP)) pSel.value = prevP;
  const pTal = pSel.value;
  const acquired1 = pTal && isTalentEligible(pTal, caracs, [], 1, {}) ? [pTal] : [];

  let pSubWrap = document.getElementById('c-peuple-subwrap');
  if (!pSubWrap) { pSubWrap = el('div', ''); pSubWrap.id = 'c-peuple-subwrap'; pSel.parentNode.appendChild(pSubWrap); }
  pSubWrap.innerHTML = '';
  const choicesMap = {};
  const pChoices = getChoicesForTalent(pTal);
  if (pChoices) {
    if (!pChoices.includes(CREATE_SUBCHOICES.peuple)) CREATE_SUBCHOICES.peuple = pChoices.at(0);
    const sP = el('select', ''); sP.style.width = '100%'; sP.style.background = '#fef3c7';
    pChoices.forEach(function(ch) {
      const o = el('option', '', 'Spécialisation (' + pTal + ') : ' + ch); o.value = ch;
      if (CREATE_SUBCHOICES.peuple === ch) o.selected = true;
      sP.appendChild(o);
    });
    sP.onchange = function() { CREATE_SUBCHOICES.peuple = sP.value; updateCreationTalents(); };
    pSubWrap.appendChild(sP);
    choicesMap[pTal] = [CREATE_SUBCHOICES.peuple];
  } else {
    CREATE_SUBCHOICES.peuple = '';
  }

  const cSel = document.getElementById('c-culture-talent');
  const prevC = cSel.value;
  cSel.innerHTML = '';
  cObj.talents.forEach(function(tName) {
    const ok = isTalentEligible(tName, caracs, acquired1, 1, choicesMap);
    const o = el('option', '', 'Talent Culture : ' + tName + (ok ? '' : ' (Prérequis non remplis)'));
    o.value = tName; o.disabled = !ok;
    cSel.appendChild(o);
  });
  if (cObj.talents.includes(prevC)) cSel.value = prevC;
  const cTal = cSel.value;
  const acquired2 = acquired1.slice();
  if (cTal && isTalentEligible(cTal, caracs, acquired1, 1, choicesMap)) acquired2.push(cTal);

  let cSubWrap = document.getElementById('c-culture-subwrap');
  if (!cSubWrap) { cSubWrap = el('div', ''); cSubWrap.id = 'c-culture-subwrap'; cSel.parentNode.appendChild(cSubWrap); }
  cSubWrap.innerHTML = '';
  const cChoices = getChoicesForTalent(cTal);
  if (cChoices) {
    const usedForC = choicesMap[cTal] || [];
    const availC = cChoices.filter(function(ch) { return !usedForC.includes(ch); });
    if (!availC.includes(CREATE_SUBCHOICES.culture)) CREATE_SUBCHOICES.culture = availC.at(0) || '';
    const sC = el('select', ''); sC.style.width = '100%'; sC.style.background = '#fef3c7';
    availC.forEach(function(ch) {
      const o = el('option', '', 'Spécialisation (' + cTal + ') : ' + ch); o.value = ch;
      if (CREATE_SUBCHOICES.culture === ch) o.selected = true;
      sC.appendChild(o);
    });
    sC.onchange = function() { CREATE_SUBCHOICES.culture = sC.value; updateCreationTalents(); };
    cSubWrap.appendChild(sC);
    if (CREATE_SUBCHOICES.culture) choicesMap[cTal] = usedForC.concat([CREATE_SUBCHOICES.culture]);
  } else {
    CREATE_SUBCHOICES.culture = '';
  }

  let validChecked = [];
  let changed = true;
  while (changed) {
    changed = false;
    prevChecked.forEach(function(tName) {
      if (clObj.talents.includes(tName) && !validChecked.includes(tName)) {
        if (isTalentEligible(tName, caracs, acquired2.concat(validChecked), 1, choicesMap)) {
          validChecked.push(tName);
          changed = true;
        }
      }
    });
  }

  const clDiv = document.getElementById('c-classe-talents');
  clDiv.innerHTML = '';
  clObj.talents.forEach(function(tName) {
    const isChecked = validChecked.includes(tName);
    const othersChecked = validChecked.filter(function(x) { return x !== tName; });
    const ok = isChecked || isTalentEligible(tName, caracs, acquired2.concat(othersChecked), 1, choicesMap);
    const tInfo = RULES.talents.find(function(x) { return x.nom === tName; });
    const lbl = el('label', 'border flex');
    lbl.style.background = ok ? '#fff' : '#f5f5f4';
    lbl.style.opacity = ok ? '1' : '0.5';
    lbl.style.fontSize = '12px';
    const chk = el('input', '');
    chk.type = 'checkbox'; chk.name = 'c-cl-talent'; chk.value = tName;
    chk.checked = isChecked; chk.disabled = !ok;
    chk.onchange = function() { onClassTalentToggle(chk); };
    const txt = el('div', ''); txt.style.flex = '1';
    txt.appendChild(el('strong', '', tName));
    txt.appendChild(el('div', '', tInfo ? tInfo.effet : ''));

    const clChoices = getChoicesForTalent(tName);
    if (isChecked && clChoices) {
      const usedForCl = choicesMap[tName] || [];
      const availCl = clChoices.filter(function(ch) { return !usedForCl.includes(ch); });
      if (!availCl.includes(CREATE_SUBCHOICES.classe[tName])) CREATE_SUBCHOICES.classe[tName] = availCl.at(0) || '';
      const sCl = el('select', ''); sCl.style.marginTop = '4px'; sCl.style.background = '#fef3c7';
      availCl.forEach(function(ch) {
        const o = el('option', '', 'Choix : ' + ch); o.value = ch;
        if (CREATE_SUBCHOICES.classe[tName] === ch) o.selected = true;
        sCl.appendChild(o);
      });
      sCl.onchange = function() { CREATE_SUBCHOICES.classe[tName] = sCl.value; };
      txt.appendChild(sCl);
    }

    lbl.appendChild(chk); lbl.appendChild(txt);
    clDiv.appendChild(lbl);
  });
}

async function saveNewCharacter() {
  const name = document.getElementById('c-name').value.trim();
  if (!name) return alert("Veuillez saisir un nom de personnage.");
  const used = Object.values(CREATE_CARACS).reduce(function(a, b) { return a + (b - 8); }, 0);
  if (used !== 14) return alert("Vous devez répartir exactement les 14 points de caractéristiques.");
  const pTalent = document.getElementById('c-peuple-talent').value;
  const cTalent = document.getElementById('c-culture-talent').value;
  const clTalents = Array.from(document.querySelectorAll('input[name="c-cl-talent"]:checked')).map(function(x) { return x.value; });
  if (clTalents.length !== 4) return alert("Veuillez sélectionner exactement 4 talents de classe.");

  const choicesLvl1 = {};
  const pushChoice = function(tName, val) {
    if (!val) return;
    if (!choicesLvl1[tName]) choicesLvl1[tName] = [];
    choicesLvl1[tName].push(val);
  };
  pushChoice(pTalent, CREATE_SUBCHOICES.peuple);
  pushChoice(cTalent, CREATE_SUBCHOICES.culture);
  clTalents.forEach(function(tName) { pushChoice(tName, CREATE_SUBCHOICES.classe[tName]); });

  const charData = {
    portrait: CREATE_PORTRAIT,
    desir: document.getElementById('c-desire').value,
    peuple: document.getElementById('c-peuple').value,
    peuple_carac: document.getElementById('c-peuple-carac').value,
    culture: document.getElementById('c-culture').value,
    culture_carac: document.getElementById('c-culture-carac').value,
    classe: document.getElementById('c-classe').value,
    base_caracs: Object.assign({}, CREATE_CARACS),
    talents_lvl1: [pTalent, cTalent].concat(clTalents),
    talent_choices_lvl1: choicesLvl1,
    sorts: [],
    level_caracs: {},
    level_talents: {},
    level_talent_choices: {},
    inventaire: [{ nom: "Poings", categorie: "Arme", famille: "Lutte", mains: 1, poids: 0, force_min: 5, degat: 0, portee: 0 }],
    worn: { MainPrincipale: 0 },
    blessures: {},
    fatigue: 0,
    emotion: "Aucune"
  };

  const res = await sb.from('characters').insert({
    owner_id: CURRENT_USER.id, owner_email: CURRENT_USER.email, name: name,
    is_public: document.getElementById('c-public').checked, level: 1, effective_level: 1, data: charData
  });
  if (res.error) return alert("Erreur : " + res.error.message);
  CREATE_PORTRAIT = '';
CREATE_SUBCHOICES = { peuple: '', culture: '', classe: {} };
document.getElementById('create-form-wrapper').classList.add('hidden');
alert("Personnage créé avec succès !");
await refreshAllData(true);
switchTab('play');
}


async function updateCharData(charId, newData) {
  await sb.from('characters').update({ data: newData }).eq('id', charId);
}

async function updateCharField(charId, field, value) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const d = Object.assign({}, char.data);
  d[field] = value;
  await updateCharData(charId, d);
}

async function togglePublic(charId) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  await sb.from('characters').update({ is_public: !char.is_public }).eq('id', charId);
}

async function deleteCharacter(charId) {
  if (!confirm("Supprimer définitivement ce personnage ?")) return;
  await sb.from('characters').delete().eq('id', charId);
}

async function transferCharacter(charId) {
  const email = prompt("Entrez l'adresse email du joueur qui recevra ce personnage :");
  if (!email) return;
  const target = CHARACTERS.find(function(c) { return c.owner_email && c.owner_email.toLowerCase() === email.trim().toLowerCase(); });
  if (!target) return alert("Cet utilisateur doit d'abord avoir créé au moins un personnage sur l'application.");
  await sb.from('characters').update({ owner_id: target.owner_id, owner_email: target.owner_email }).eq('id', charId);
  alert("Personnage transféré !");
}


function renderManageSheet() {
  const charId = document.getElementById('sheet-char-select').value;
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const container = document.getElementById('manage-sheet-container');
  container.innerHTML = '';
  if (!char) { container.textContent = "Aucun personnage sélectionné."; return; }

  const isOwner = char.owner_id === CURRENT_USER.id;
  const st = getEffectiveState(char);

  const header = el('div', 'flex justify-between border bg-stone-50');
  const titleBox = el('div', '');
  titleBox.appendChild(el('strong', '', char.name + (char.is_public ? '' : ' [Masqué]')));
  titleBox.appendChild(el('div', '', char.data.peuple + ' • ' + char.data.culture + ' • ' + char.data.classe + ' • Force : ' + st.caracs['Force'] + ' • Agi : ' + st.caracs['Agilité']));
  header.appendChild(titleBox);

  if (isOwner) {
    const ctrl = el('div', 'flex');
    ctrl.appendChild(el('strong', '', 'Niveau réel : ' + char.level));
    if (char.level > 1) {
      const bDown = el('button', '', '-1 Niv');
      bDown.onclick = function() { revertLastLevel(char.id); };
      ctrl.appendChild(bDown);
    }
    const selEff = el('select', '');
    for (let i = 1; i <= char.level; i++) {
      const o = el('option', '', 'Niveau effectif : ' + i); o.value = i;
      if (i === char.effective_level) o.selected = true;
      selEff.appendChild(o);
    }
    selEff.onchange = function() { setEffectiveLevel(char.id, selEff.value); };
    const bPub = el('button', '', char.is_public ? 'Masquer' : 'Rendre public'); bPub.onclick = function() { togglePublic(char.id); };
    const bTrans = el('button', '', 'Transférer'); bTrans.onclick = function() { transferCharacter(char.id); };
    const bDel = el('button', 'bg-rose-700', 'Supprimer'); bDel.onclick = function() { deleteCharacter(char.id); };
    ctrl.appendChild(selEff); ctrl.appendChild(bPub); ctrl.appendChild(bTrans); ctrl.appendChild(bDel);
    header.appendChild(ctrl);
  }
  container.appendChild(header);

  if (isOwner && char.level < 30) {
    renderLevelUpBox(char, container);
  }

  renderCareerHistory(char, container);

  const eqBox = el('div', 'border space-y-3');
  eqBox.appendChild(el('strong', '', 'Équipement porté & Transport (' + st.totalWeight + ' / ' + st.maxWeight + ' kg)' + (st.encumbered ? ' — ENCOMBRÉ !' : '')));

  const slotGrid = el('div', 'grid grid-cols-3');
  const slots = [
    { key: 'MainPrincipale', label: 'Main principale', filter: function(e) { return e.categorie === 'Arme' && e.nom !== 'Poings'; } },
    { key: 'MainSecondaire', label: 'Main secondaire', filter: function(e) { return (e.categorie === 'Arme' && e.nom !== 'Poings' && e.mains === 1) || e.categorie === 'Bouclier'; } },
    { key: 'Monture', label: 'Monture', filter: function(e) { return e.categorie === 'Monture'; } },
    { key: 'Tete', label: 'Tête', filter: function(e) { return e.slot === 'Tête'; } },
    { key: 'Torse', label: 'Torse', filter: function(e) { return e.slot === 'Torse'; } },
    { key: 'Bassin', label: 'Bassin', filter: function(e) { return e.slot === 'Bassin'; } },
    { key: 'Jambes', label: 'Jambes', filter: function(e) { return e.slot === 'Jambes'; } },
    { key: 'BrasDroit', label: 'Bras droit', filter: function(e) { return e.slot === 'Bras'; } },
    { key: 'BrasGauche', label: 'Bras gauche', filter: function(e) { return e.slot === 'Bras'; } }
  ];

  const mainEquipped = st.equipped['MainPrincipale'];
  const twoHandedLocked = mainEquipped && mainEquipped.mains === 2;

  slots.forEach(function(sl) {
    const locked = sl.key === 'MainSecondaire' && twoHandedLocked;
    const curItem = st.equipped[sl.key];
    const sCard = el('div', 'border bg-stone-50');
    sCard.appendChild(el('strong', '', sl.label));
    const sSel = el('select', '');
    sSel.style.width = '100%'; sSel.style.marginTop = '4px'; sSel.style.fontSize = '12px';
    sSel.disabled = !isOwner || locked;

    const optNone = el('option', '', locked ? '(Bloqué : arme 2 mains)' : (sl.key === 'MainPrincipale' ? 'Poings (0 kg)' : '— Aucun —'));
    optNone.value = '';
    sSel.appendChild(optNone);

    RULES.equipements.forEach(function(item, idx) {
      if (sl.filter(item)) {
        const reqForce = item.force_min || 0;
        const weak = reqForce > st.caracs['Force'];
        let label = item.nom + ' (' + item.poids + 'kg';
        if (item.categorie === 'Arme') label += ', Dég +' + item.degat + ', Portée ' + item.portee + ', F.' + reqForce;
        if (item.def) label += ', Déf +' + item.def;
        if (item.malus_agi) label += ', Agi -' + item.malus_agi;
        label += ')';
        if (weak) label += ' [Force insuffisante !]';

        const o = el('option', '', label);
        o.value = idx;
        if (curItem && curItem.nom === item.nom) o.selected = true;
        sSel.appendChild(o);
      }
    });
    sSel.onchange = function() { setEquippedCatalogItem(char.id, sl.key, sSel.value); };
    sCard.appendChild(sSel);
    slotGrid.appendChild(sCard);
  });
  eqBox.appendChild(slotGrid);

  const bagTop = el('div', 'flex justify-between');
  bagTop.style.borderTop = '1px solid #e7e5e4'; bagTop.style.paddingTop = '8px';
  bagTop.appendChild(el('strong', '', 'Équipement transporté en plus (Sac à dos) :'));
  if (isOwner) {
    const addWrap = el('div', 'flex');
    const inpFilter = el('input', ''); inpFilter.type = 'text'; inpFilter.placeholder = 'Filtrer...';
    const selEq = el('select', ''); selEq.id = 'add-equip-sel';
    const fillEquipOptions = function(term) {
      const q = (term || '').toLowerCase().trim();
      selEq.innerHTML = '';
      RULES.equipements.forEach(function(e, i) {
        if (e.nom !== 'Poings' && (!q || e.nom.toLowerCase().includes(q) || (e.categorie && e.categorie.toLowerCase().includes(q)))) {
          const o = el('option', '', e.nom + ' (' + e.poids + 'kg)'); o.value = i; selEq.appendChild(o);
        }
      });
    };
    fillEquipOptions('');
    inpFilter.oninput = function() { fillEquipOptions(inpFilter.value); };
    const bAddEq = el('button', 'bg-amber-800', '+ Sac'); bAddEq.onclick = function() { addEquipment(char.id); };
    addWrap.appendChild(inpFilter); addWrap.appendChild(selEq); addWrap.appendChild(bAddEq);
    bagTop.appendChild(addWrap);
  }
  eqBox.appendChild(bagTop);

  const invList = el('div', 'flex');
  st.inv.forEach(function(item, idx) {
    if (item.nom === 'Poings') return;
    const badge = el('span', 'border bg-stone-50', item.nom + ' (' + item.poids + 'kg) ');
    if (isOwner) {
      const rx = el('button', '', 'x'); rx.style.color = '#dc2626'; rx.style.padding = '1px 5px';
      rx.onclick = function() { removeEquipment(char.id, idx); };
      badge.appendChild(rx);
    }
    invList.appendChild(badge);
  });
  eqBox.appendChild(invList);
  container.appendChild(eqBox);
}
let LVL_DRAFT = { charId: null, carac: '', t1: '', t1Choice: '', t2: '', t2Choice: '', te: '', teChoice: '', spells: [] };

function renderLevelUpBox(char, container) {
  const nextLvl = char.level + 1;
  if (LVL_DRAFT.charId !== char.id) {
    LVL_DRAFT = { charId: char.id, carac: '', t1: '', t1Choice: '', t2: '', t2Choice: '', te: '', teChoice: '', spells: [] };
  }

  const fullChar = Object.assign({}, char, { effective_level: char.level });
  const baseSt = getEffectiveState(fullChar);
  const rawCaracs = Object.assign({}, baseSt.caracs);
  rawCaracs['Agilité'] += baseSt.armorMalusAgi;
  const baseChoicesMap = baseSt.talentChoices || {};

  const hasCaracChoice = (nextLvl % 5 === 0);
  const prevPalierCarac = (char.data.level_caracs || {})[nextLvl - 5] || '';
  const availCaracs = RULES.caracteristiques.filter(function(c) { return c !== prevPalierCarac; });
  if (hasCaracChoice && !availCaracs.includes(LVL_DRAFT.carac)) LVL_DRAFT.carac = '';
  if (hasCaracChoice && LVL_DRAFT.carac) rawCaracs[LVL_DRAFT.carac] += 1;

  const hasEpique = [15, 18, 21, 24, 27, 30].includes(nextLvl);

  const buildChoicesMap = function(excludeSlot) {
    const map = {};
    Object.keys(baseChoicesMap).forEach(function(k) { map[k] = baseChoicesMap[k].slice(); });
    const add = function(t, ch) {
      if (!t || !ch) return;
      if (!map[t]) map[t] = [];
      map[t].push(ch);
    };
    if (excludeSlot !== 't1') add(LVL_DRAFT.t1, LVL_DRAFT.t1Choice);
    if (excludeSlot !== 't2') add(LVL_DRAFT.t2, LVL_DRAFT.t2Choice);
    if (excludeSlot !== 'te') add(LVL_DRAFT.te, LVL_DRAFT.teChoice);
    return map;
  };

  const box = el('div', 'border bg-amber-50 space-y-3');
  box.appendChild(el('strong', '', 'Passage au Niveau ' + nextLvl + ' :'));
  const row = el('div', 'grid grid-cols-2');

  if (hasCaracChoice) {
    const cDiv = el('div', '');
    cDiv.appendChild(el('div', '', 'Caractéristique +1 (hors ' + (prevPalierCarac || 'aucune') + ') :'));
    const selC = el('select', ''); selC.style.width = '100%';
    const o0 = el('option', '', '— Choisir une caractéristique —'); o0.value = ''; selC.appendChild(o0);
    availCaracs.forEach(function(c) {
      const o = el('option', '', c + ' (' + (rawCaracs[c] - (LVL_DRAFT.carac === c ? 1 : 0)) + ' -> ' + (rawCaracs[c] + (LVL_DRAFT.carac === c ? 0 : 1)) + ')');
      o.value = c;
      if (LVL_DRAFT.carac === c) o.selected = true;
      selC.appendChild(o);
    });
    selC.onchange = function() { LVL_DRAFT.carac = selC.value; renderManageSheet(); };
    cDiv.appendChild(selC);
    row.appendChild(cDiv);
  }

  const mapForT1 = buildChoicesMap('t1');
  const acqForT1 = baseSt.talents.concat(LVL_DRAFT.t2 ? [LVL_DRAFT.t2] : []).concat(LVL_DRAFT.te ? [LVL_DRAFT.te] : []);
  const eligT1 = RULES.talents.filter(function(t) { return t.type === 'commun' && isTalentEligible(t.nom, rawCaracs, acqForT1, nextLvl, mapForT1); });
  if (LVL_DRAFT.t1 && !eligT1.some(function(t) { return t.nom === LVL_DRAFT.t1; })) { LVL_DRAFT.t1 = ''; LVL_DRAFT.t1Choice = ''; }

  const t1Div = el('div', 'space-y-2');
  t1Div.appendChild(el('div', '', 'Talent commun 1/2 :'));
  const selT1 = el('select', ''); selT1.style.width = '100%';
  const ot10 = el('option', '', '— Choisir le talent 1 —'); ot10.value = ''; selT1.appendChild(ot10);
  eligT1.forEach(function(t) {
    const o = el('option', '', t.nom + ' — ' + t.effet); o.value = t.nom;
    if (LVL_DRAFT.t1 === t.nom) o.selected = true;
    selT1.appendChild(o);
  });
  selT1.onchange = function() { LVL_DRAFT.t1 = selT1.value; LVL_DRAFT.t1Choice = ''; renderManageSheet(); };
  t1Div.appendChild(selT1);

  const t1ChoicesList = getChoicesForTalent(LVL_DRAFT.t1);
  if (t1ChoicesList) {
    const used1 = mapForT1[LVL_DRAFT.t1] || [];
    const avail1 = t1ChoicesList.filter(function(ch) { return !used1.includes(ch); });
    if (!avail1.includes(LVL_DRAFT.t1Choice)) LVL_DRAFT.t1Choice = avail1.at(0) || '';
    const selSub1 = el('select', ''); selSub1.style.width = '100%'; selSub1.style.background = '#fef3c7';
    avail1.forEach(function(ch) {
      const o = el('option', '', 'Spécialisation (' + LVL_DRAFT.t1 + ') : ' + ch); o.value = ch;
      if (LVL_DRAFT.t1Choice === ch) o.selected = true;
      selSub1.appendChild(o);
    });
    selSub1.onchange = function() { LVL_DRAFT.t1Choice = selSub1.value; renderManageSheet(); };
    t1Div.appendChild(selSub1);
  }
  row.appendChild(t1Div);

  const mapForT2 = buildChoicesMap('t2');
  const acqForT2 = baseSt.talents.concat(LVL_DRAFT.t1 ? [LVL_DRAFT.t1] : []).concat(LVL_DRAFT.te ? [LVL_DRAFT.te] : []);
  const eligT2 = RULES.talents.filter(function(t) { return t.type === 'commun' && isTalentEligible(t.nom, rawCaracs, acqForT2, nextLvl, mapForT2); });
  if (LVL_DRAFT.t2 && !eligT2.some(function(t) { return t.nom === LVL_DRAFT.t2; })) { LVL_DRAFT.t2 = ''; LVL_DRAFT.t2Choice = ''; }

  const t2Div = el('div', 'space-y-2');
  t2Div.appendChild(el('div', '', 'Talent commun 2/2 :'));
  const selT2 = el('select', ''); selT2.style.width = '100%';
  const ot20 = el('option', '', '— Choisir le talent 2 —'); ot20.value = ''; selT2.appendChild(ot20);
  eligT2.forEach(function(t) {
    const o = el('option', '', t.nom + ' — ' + t.effet); o.value = t.nom;
    if (LVL_DRAFT.t2 === t.nom) o.selected = true;
    selT2.appendChild(o);
  });
  selT2.onchange = function() { LVL_DRAFT.t2 = selT2.value; LVL_DRAFT.t2Choice = ''; renderManageSheet(); };
  t2Div.appendChild(selT2);

  const t2ChoicesList = getChoicesForTalent(LVL_DRAFT.t2);
  if (t2ChoicesList) {
    const used2 = mapForT2[LVL_DRAFT.t2] || [];
    const avail2 = t2ChoicesList.filter(function(ch) { return !used2.includes(ch); });
    if (!avail2.includes(LVL_DRAFT.t2Choice)) LVL_DRAFT.t2Choice = avail2.at(0) || '';
    const selSub2 = el('select', ''); selSub2.style.width = '100%'; selSub2.style.background = '#fef3c7';
    avail2.forEach(function(ch) {
      const o = el('option', '', 'Spécialisation (' + LVL_DRAFT.t2 + ') : ' + ch); o.value = ch;
      if (LVL_DRAFT.t2Choice === ch) o.selected = true;
      selSub2.appendChild(o);
    });
    selSub2.onchange = function() { LVL_DRAFT.t2Choice = selSub2.value; renderManageSheet(); };
    t2Div.appendChild(selSub2);
  }
  row.appendChild(t2Div);

  if (hasEpique) {
    const mapForTe = buildChoicesMap('te');
    const acqForTe = baseSt.talents.concat(LVL_DRAFT.t1 ? [LVL_DRAFT.t1] : []).concat(LVL_DRAFT.t2 ? [LVL_DRAFT.t2] : []);
    const eligTe = RULES.talents.filter(function(t) { return t.type === 'epique' && isTalentEligible(t.nom, rawCaracs, acqForTe, nextLvl, mapForTe); });
    if (LVL_DRAFT.te && !eligTe.some(function(t) { return t.nom === LVL_DRAFT.te; })) { LVL_DRAFT.te = ''; LVL_DRAFT.teChoice = ''; }

    const teDiv = el('div', 'space-y-2');
    teDiv.appendChild(el('div', '', 'Talent Épique (Palier ' + nextLvl + ') :'));
    const selTe = el('select', ''); selTe.style.width = '100%';
    const ote0 = el('option', '', '— Choisir un talent épique —'); ote0.value = ''; selTe.appendChild(ote0);
    eligTe.forEach(function(t) {
      const o = el('option', '', t.nom + ' — ' + t.effet); o.value = t.nom;
      if (LVL_DRAFT.te === t.nom) o.selected = true;
      selTe.appendChild(o);
    });
    selTe.onchange = function() { LVL_DRAFT.te = selTe.value; LVL_DRAFT.teChoice = ''; renderManageSheet(); };
    teDiv.appendChild(selTe);

    const teChoicesList = getChoicesForTalent(LVL_DRAFT.te);
    if (teChoicesList) {
      const usedE = mapForTe[LVL_DRAFT.te] || [];
      const availE = teChoicesList.filter(function(ch) { return !usedE.includes(ch); });
      if (!availE.includes(LVL_DRAFT.teChoice)) LVL_DRAFT.teChoice = availE.at(0) || '';
      const selSubE = el('select', ''); selSubE.style.width = '100%'; selSubE.style.background = '#fef3c7';
      availE.forEach(function(ch) {
        const o = el('option', '', 'Spécialisation (' + LVL_DRAFT.te + ') : ' + ch); o.value = ch;
        if (LVL_DRAFT.teChoice === ch) o.selected = true;
        selSubE.appendChild(o);
      });
      selSubE.onchange = function() { LVL_DRAFT.teChoice = selSubE.value; renderManageSheet(); };
      teDiv.appendChild(selSubE);
    }
    row.appendChild(teDiv);
  }
  box.appendChild(row);

  const chosenTalents = [LVL_DRAFT.t1, LVL_DRAFT.t2, LVL_DRAFT.te].filter(Boolean);
  const spellSlots = getSpellSlotsForTalents(chosenTalents);
  if (spellSlots.length > 0) {
    const spWrap = el('div', 'border bg-purple-50 space-y-2');
    spWrap.appendChild(el('strong', '', 'Choix des nouveaux sorts débloqués :'));
    spellSlots.forEach(function(slotLabel, idx) {
      if (!LVL_DRAFT.spells[idx]) LVL_DRAFT.spells[idx] = { voie: 'Air', nom: 'Ascension' };
      const sRow = el('div', 'flex');
      sRow.appendChild(el('span', '', slotLabel + ' :'));
      const selV = el('select', '');
      (RULES.voies_magiques || []).forEach(function(v) {
        const o = el('option', '', v.voie); o.value = v.voie;
        if (LVL_DRAFT.spells[idx].voie === v.voie) o.selected = true;
        selV.appendChild(o);
      });
      const selS = el('select', '');
      const vObj = (RULES.voies_magiques || []).find(function(x) { return x.voie === selV.value; });
      if (vObj) {
        if (!vObj.sorts.includes(LVL_DRAFT.spells[idx].nom)) LVL_DRAFT.spells[idx].nom = vObj.sorts.at(0);
        vObj.sorts.forEach(function(s) {
          const o = el('option', '', s); o.value = s;
          if (LVL_DRAFT.spells[idx].nom === s) o.selected = true;
          selS.appendChild(o);
        });
      }
      selV.onchange = function() { LVL_DRAFT.spells[idx] = { voie: selV.value, nom: '' }; renderManageSheet(); };
      selS.onchange = function() { LVL_DRAFT.spells[idx].nom = selS.value; };
      sRow.appendChild(selV); sRow.appendChild(selS);
      spWrap.appendChild(sRow);
    });
    box.appendChild(spWrap);
  } else {
    LVL_DRAFT.spells = [];
  }

  const btnVal = el('button', 'bg-amber-800', 'Valider le passage au Niveau ' + nextLvl);
  btnVal.style.width = '100%';
btnVal.onclick = function() { confirmLevelUp(char.id, nextLvl, hasCaracChoice, hasEpique, spellSlots.length); };
box.appendChild(btnVal);
container.appendChild(box);
}
function formatChoicesMap(cMap) {
if (!cMap) return '';
const parts = [];
Object.keys(cMap).forEach(function(t) {
if (cMap[t] && cMap[t].length > 0) parts.push(t + ' : ' + cMap[t].join(', '));
});
return parts.length > 0 ? ' [' + parts.join(' ; ') + ']' : '';
}
function renderCareerHistory(char, container) {
const histBox = el('div', 'border space-y-2');
histBox.appendChild(el('strong', '', 'Plan de carrière (du plus récent au niveau 1) :'));
const d = char.data;
for (let lvl = char.level; lvl >= 2; lvl--) {
const row = el('div', 'border bg-stone-50');
row.style.fontSize = '12px';
const cGain = (d.level_caracs || {})[lvl];
const tGains = (d.level_talents || {})[lvl] || [];
const chGains = (d.level_talent_choices || {})[lvl];
const sGains = (d.level_sorts || {})[lvl] || [];
let txt = 'Niveau ' + lvl + ' : ';
if (cGain) txt += '[+1 ' + cGain + '] ';
txt += 'Talents : ' + (tGains.join(', ') || '—') + formatChoicesMap(chGains);
if (sGains.length > 0) txt += ' | Sorts : ' + sGains.map(function(s) { return s.nom + ' (' + s.voie + ')'; }).join(', ');
row.textContent = txt;
histBox.appendChild(row);
}
const lvl1Row = el('div', 'border bg-stone-50');
lvl1Row.style.fontSize = '12px';
lvl1Row.textContent = 'Niveau 1 (Création) : ' + d.peuple + ' (+1 ' + d.peuple_carac + '), ' + d.culture + ' (+1 ' + d.culture_carac + '), ' + d.classe + ' | Talents : ' + (d.talents_lvl1 || []).join(', ') + formatChoicesMap(d.talent_choices_lvl1);
histBox.appendChild(lvl1Row);
container.appendChild(histBox);
}
async function confirmLevelUp(charId, nextLvl, hasCaracChoice, hasEpique, spellCount) {
if (hasCaracChoice && !LVL_DRAFT.carac) return alert("Veuillez choisir une caractéristique (+1).");
if (!LVL_DRAFT.t1 || !LVL_DRAFT.t2) return alert("Veuillez sélectionner les 2 talents communs.");
if (hasEpique && !LVL_DRAFT.te) return alert("Veuillez sélectionner un talent épique.");
const char = CHARACTERS.find(function(c) { return c.id === charId; });
const d = Object.assign({}, char.data);
if (hasCaracChoice) {
d.level_caracs = Object.assign({}, d.level_caracs || {});
d.level_caracs[nextLvl] = LVL_DRAFT.carac;
}
const gainedTalents = [LVL_DRAFT.t1, LVL_DRAFT.t2];
if (hasEpique) gainedTalents.push(LVL_DRAFT.te);
d.level_talents = Object.assign({}, d.level_talents || {});
d.level_talents[nextLvl] = gainedTalents;
const lvlChoices = {};
const pushChoice = function(t, ch) {
if (!t || !ch) return;
if (!lvlChoices[t]) lvlChoices[t] = [];
lvlChoices[t].push(ch);
};
pushChoice(LVL_DRAFT.t1, LVL_DRAFT.t1Choice);
pushChoice(LVL_DRAFT.t2, LVL_DRAFT.t2Choice);
if (hasEpique) pushChoice(LVL_DRAFT.te, LVL_DRAFT.teChoice);
d.level_talent_choices = Object.assign({}, d.level_talent_choices || {});
d.level_talent_choices[nextLvl] = lvlChoices;
if (spellCount > 0) {
d.level_sorts = Object.assign({}, d.level_sorts || {});
d.level_sorts[nextLvl] = LVL_DRAFT.spells.slice(0, spellCount);
}
LVL_DRAFT = { charId: null, carac: '', t1: '', t1Choice: '', t2: '', t2Choice: '', te: '', teChoice: '', spells: [] };
await sb.from('characters').update({ level: nextLvl, effective_level: nextLvl, data: d }).eq('id', charId);
alert("Passage au Niveau " + nextLvl + " validé !");
}
async function revertLastLevel(charId) {
const char = CHARACTERS.find(function(c) { return c.id === charId; });
if (!char || char.level <= 1) return;
if (!confirm("Annuler le niveau " + char.level + " et revenir au niveau " + (char.level - 1) + " ?")) return;
const oldLvl = char.level;
const newLvl = oldLvl - 1;
const d = Object.assign({}, char.data);
if (d.level_caracs) delete d.level_caracs[oldLvl];
if (d.level_talents) delete d.level_talents[oldLvl];
if (d.level_talent_choices) delete d.level_talent_choices[oldLvl];
if (d.level_sorts) delete d.level_sorts[oldLvl];
LVL_DRAFT = { charId: null, carac: '', t1: '', t1Choice: '', t2: '', t2Choice: '', te: '', teChoice: '', spells: [] };
await sb.from('characters').update({ level: newLvl, effective_level: Math.min(char.effective_level, newLvl), data: d }).eq('id', charId);
}
  


async function setEffectiveLevel(charId, lvl) {
  await sb.from('characters').update({ effective_level: parseInt(lvl) }).eq('id', charId);
}

async function setEquippedCatalogItem(charId, slot, idxStr) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const equipped = Object.assign({}, char.data.equipped || {});
  if (idxStr === "") {
    delete equipped[slot];
  } else {
    const item = Object.assign({}, RULES.equipements.at(parseInt(idxStr)));
    equipped[slot] = item;
    if (slot === 'MainPrincipale' && item.mains === 2) {
      delete equipped['MainSecondaire'];
    }
  }
  await updateCharField(charId, 'equipped', equipped);
}

async function changeFatigue(charId, delta) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const st = getEffectiveState(char);
  const maxFat = st.caracs['Santé'] || 10;
  const infectedCount = Object.values(char.data.blessures || {}).filter(function(b) { return b && b.infectee; }).length;
  const newFat = Math.min(maxFat, Math.max(infectedCount, (char.data.fatigue || 0) + delta));
  await updateCharField(charId, 'fatigue', newFat);
}

async function addEquipment(charId) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const idx = parseInt(document.getElementById('add-equip-sel').value);
  const item = Object.assign({}, RULES.equipements.at(idx));
  const inv = (char.data.inventaire || []).concat([item]);
  await updateCharField(charId, 'inventaire', inv);
}

async function removeEquipment(charId, idx) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const inv = (char.data.inventaire || []).slice();
  inv.splice(idx, 1);
  await updateCharField(charId, 'inventaire', inv);
}

async function setWoundLevel(charId, loc, gravite) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const blessures = Object.assign({}, char.data.blessures || {});
  if (gravite === 0) delete blessures[loc];
  else {
    const mult = [0, 1, 2, 4, 8, 12, 16].at(gravite) || 1;
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const baseDice = gravite === 6 ? (d1 + d2 + Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1) : (d1 + d2);
    const jours = baseDice * mult;
    blessures[loc] = { gravite: gravite, infectee: false, jours: jours };
  }
  await updateCharField(charId, 'blessures', blessures);
}

async function rollRandomWound(charId, type) {
  const locs = ['Tête', 'Torse', 'Ventre/Bassin', 'Bras droit', 'Bras gauche', 'Jambe(s)'];
  const loc = locs.at(Math.floor(Math.random() * 6));
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  let grav = d1;
  if (type === 'legere') grav = Math.min(d1, d2);
  if (type === 'grave') grav = Math.max(d1, d2);
  await setWoundLevel(charId, loc, grav);
  alert("Blessure " + type + " localisée : " + loc + " (Gravité " + grav + ")");
}

async function rollFeverTest(charId) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const st = getEffectiveState(char);
  const comp = RULES.competences.find(function(c) { return c.nom === 'Résistance'; });
  const mod = computeSkillModifier(char, st, comp).total;
  const roll = (Math.floor(Math.random() * 6) + 1) + (Math.floor(Math.random() * 6) + 1) + (Math.floor(Math.random() * 6) + 1);
  const total = roll + mod;
  const success = total >= 10;
  await sb.from('roll_history').insert({
    character_id: char.id, owner_id: CURRENT_USER.id, character_name: char.name,
    is_public: char.is_public, skill_name: 'Test de Fièvre (D10)', total: total,
    details: '3d6 (' + roll + ') + Résistance (' + mod + ') = ' + total + ' -> ' + (success ? 'Réussi' : 'Échec (Infection !)')
  });
  if (!success) {
    const blessures = Object.assign({}, char.data.blessures || {});
    const keys = Object.keys(blessures);
    if (keys.length > 0) blessures[keys.at(0)].infectee = true;
    else blessures['Torse'] = { gravite: 1, infectee: true, jours: 7 };
    const infCount = Object.values(blessures).filter(function(b) { return b.infectee; }).length;
    const newFat = Math.max(char.data.fatigue || 0, infCount);
    const d = Object.assign({}, char.data, { blessures: blessures, fatigue: newFat });
    await updateCharData(charId, d);
  }
}

async function takeRest(charId, type) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const medChk = document.getElementById('rest-med-' + charId);
  const medOk = medChk ? medChk.checked : false;
  const blessures = Object.assign({}, char.data.blessures || {});
  const infectedCount = Object.values(blessures).filter(function(b) { return b && b.infectee; }).length;
  const newFat = Math.max(infectedCount, (char.data.fatigue || 0) - 2);
  if (type === 'long') {
    const dec = medOk ? 2 : 1;
    Object.keys(blessures).forEach(function(loc) {
      if (blessures[loc].infectee && medOk) blessures[loc].infectee = false;
      if (!blessures[loc].infectee) {
        blessures[loc].jours = Math.max(0, blessures[loc].jours - dec);
        if (blessures[loc].jours === 0) delete blessures[loc];
      }
    });
  }
  const d = Object.assign({}, char.data, { fatigue: newFat, emotion: 'Aucune', blessures: blessures });
  await updateCharData(charId, d);
  alert("Repos " + type + " effectué !");
}

async function startCombat(type) {
  await sb.from('combat_state').update({
    status: 'phase1', combat_type: type, participants: [], roll_camp_a: null, roll_camp_b: null, phase1_result: null, phase2_result: null
  }).eq('id', 1);
}

async function resetCombat() {
  await sb.from('combat_state').update({
    status: 'inactif', participants: [], roll_camp_a: null, roll_camp_b: null, phase1_result: null, phase2_result: null
  }).eq('id', 1);
}

async function addToCombat(camp) {
  const charId = document.getElementById('combat-add-char').value;
  if (!charId || COMBAT.status === 'inactif') return alert("Démarrez d'abord un combat.");
  const parts = (COMBAT.participants || []).slice();
  if (parts.some(function(p) { return p.char_id === charId; })) return alert("Ce personnage est déjà dans le combat.");
  parts.push({ char_id: charId, camp: camp, posture: 'Défensif', manoeuvre: 'Pas de manœuvre initiale', temp_att: 0, temp_def: 0 });
  await sb.from('combat_state').update({ participants: parts }).eq('id', 1);
}

async function updateCombatParticipant(charId, field, value) {
  const parts = COMBAT.participants.map(function(p) {
    if (p.char_id !== charId) return p;
    const copy = Object.assign({}, p);
    copy[field] = value;
    return copy;
  });
  await sb.from('combat_state').update({ participants: parts }).eq('id', 1);
}

async function removeFromCombat(charId) {
  const parts = COMBAT.participants.filter(function(p) { return p.char_id !== charId; });
  await sb.from('combat_state').update({ participants: parts }).eq('id', 1);
}

function computeCombatStats(char, p) {
  const st = getEffectiveState(char);
  const posObj = RULES.postures.find(function(x) { return x.nom === p.posture; }) || RULES.postures.at(0);
  const mList = COMBAT.status === 'phase2' ? RULES.manoeuvres_finales : RULES.manoeuvres_initiales;
  const manObj = mList.find(function(x) { return x.nom === p.manoeuvre; }) || { att: 0, def: 0 };

  const defaultFists = { nom: "Poings", categorie: "Arme", famille: "Lutte", mains: 1, poids: 0, force_min: 5, degat: 0, portee: 0 };
  const mainWeapon = st.equipped['MainPrincipale'] || st.inv.at(st.worn['MainPrincipale']) || defaultFists;
  const secItem = st.equipped['MainSecondaire'] || st.inv.at(st.worn['MainSecondaire']) || null;

  const isRanged = ['Arcs', 'Arbalètes', 'Frondes', 'Armes de jet'].includes(mainWeapon.famille);
  const cov = getCoverTotals();

  let attCarac = (st.caracs['Force'] || 10) - 10;
  if (st.talents.includes('Finesse') && st.caracs['Force'] >= (mainWeapon.force_min || 5) + 1) {
attCarac = Math.max(attCarac, (st.caracs['Agilité'] || 10) - 10);
}
let att = attCarac + (mainWeapon.degat || 0) + posObj.att + (manObj.att || 0) + st.emotionObj.att - st.fatigue - st.maxWoundMalus + (parseInt(p.temp_att) || 0);
if (st.caracs['Force'] < (mainWeapon.force_min || 5)) att -= ((mainWeapon.force_min || 5) - st.caracs['Force']);
if (secItem) {
if (secItem.categorie === 'Arme') att += (secItem.degat || 0);
if (!st.talents.includes('Ambidextrie')) att -= 2;
}
if (st.talents.includes('Entraînement aux armes')) att += 1;
if (st.talents.includes('Balayage') && mainWeapon.mains === 2 && !isRanged) att += 2;
if (st.talents.includes('Charge') && p.posture === 'Agressif') att += 1;
if (st.talents.includes('Tirailleur') && p.posture === 'Repli' && isRanged) att += 1;
if (st.talents.includes('Acuité') && isRanged) att += 1;
if (st.talents.includes('Rage') && p.posture === 'Agressif' && !isRanged) att += 2;
if (posObj.couv_att === 'malus') att += cov.malus;
if (posObj.couv_att === 'bonus') att += cov.bonus * (st.talents.includes('Opportunisme') ? 2 : 1);
att = Math.max(0, att);
let def = ((st.caracs['Agilité'] || 10) - 10) + st.armorDef + posObj.def + (manObj.def || 0) + st.emotionObj.def - st.fatigue - st.maxWoundMalus + (parseInt(p.temp_def) || 0);
if (!posObj.sans_portee) def += (mainWeapon.portee || 0);
if (secItem && secItem.categorie === 'Bouclier') def += (secItem.def || 0);
if (st.talents.includes('Esquive')) def += 1;
if (st.talents.includes('Parade') && !isRanged && mainWeapon.nom !== 'Poings') def += 1;
if (st.talents.includes('Rempart') && p.posture === 'Défensif') def += 1;
if (st.talents.includes('Volée') && p.posture === 'Défensif' && ['Arcs', 'Arbalètes', 'Frondes'].includes(mainWeapon.famille)) def += 1;
if (st.talents.includes('Tirailleur') && p.posture === 'Repli' && isRanged) def += 1;
if (st.talents.includes('Acuité') && isRanged) def += 1;
if (st.talents.includes('Ténacité') && p.posture === 'Défensif' && !isRanged) def += 2;
if (posObj.couv_def === 'malus') def += cov.malus;
if (posObj.couv_def === 'bonus') def += cov.bonus * (st.talents.includes('Opportunisme') ? 2 : 1);
def = Math.max(0, def);
return { att: att, def: def };
}
async function rollCombatCamp(camp) {
const dieMax = COMBAT.combat_type === 'duel' ? 12 : 20;
const roll = Math.floor(Math.random() * dieMax) + 1;
const updateObj = camp === 'A' ? { roll_camp_a: roll } : { roll_camp_b: roll };
const rollA = camp === 'A' ? roll : COMBAT.roll_camp_a;
const rollB = camp === 'B' ? roll : COMBAT.roll_camp_b;
if (rollA !== null && rollB !== null) {
let attA = 0, defA = 0, attB = 0, defB = 0;
COMBAT.participants.forEach(function(p) {
const char = CHARACTERS.find(function(c) { return c.id === p.char_id; });
if (!char) return;
const stats = computeCombatStats(char, p);
if (p.camp === 'A') { attA += stats.att; defA += stats.def; }
else { attB += stats.att; defB += stats.def; }
});
const scoreA = Math.max(0, (attA + rollA) - defB);
const scoreB = Math.max(0, (attB + rollB) - defA);
const woundsToB = Math.floor(scoreA / 8);
const woundsToA = Math.floor(scoreB / 8);
const res = { attA: attA, defA: defA, rollA: rollA, scoreA: scoreA, woundsToB: woundsToB, attB: attB, defB: defB, rollB: rollB, scoreB: scoreB, woundsToA: woundsToA };
if (COMBAT.status === 'phase1') updateObj.phase1_result = res;
else updateObj.phase2_result = res;
}
await sb.from('combat_state').update(updateObj).eq('id', 1);
}
async function nextCombatPhase() {
const parts = COMBAT.participants.map(function(p) {
return Object.assign({}, p, { manoeuvre: 'Pas de manœuvre finale', temp_att: 0, temp_def: 0 });
});
await sb.from('combat_state').update({ status: 'phase2', participants: parts, roll_camp_a: null, roll_camp_b: null }).eq('id', 1);
}
function renderCombat() {
const statusEl = document.getElementById('combat-status-banner');
const resBox = document.getElementById('combat-results-box');
if (!COMBAT || COMBAT.status === 'inactif') {
statusEl.textContent = "Aucun combat en cours.";
document.getElementById('combat-list-a').innerHTML = '';
document.getElementById('combat-list-b').innerHTML = '';
resBox.classList.add('hidden');
return;
}
statusEl.textContent = 'Combat (' + COMBAT.combat_type.toUpperCase() + ') — ' + (COMBAT.status === 'phase1' ? 'PHASE INITIALE' : 'PHASE FINALE');
document.getElementById('btn-roll-a').disabled = COMBAT.roll_camp_a !== null;
document.getElementById('btn-roll-b').disabled = COMBAT.roll_camp_b !== null;
['A', 'B'].forEach(function(camp) {
const listEl = document.getElementById(camp === 'A' ? 'combat-list-a' : 'combat-list-b');
listEl.innerHTML = '';
const campParts = (COMBAT.participants || []).filter(function(p) { return p.camp === camp; });
campParts.forEach(function(p) {
const char = CHARACTERS.find(function(c) { return c.id === p.char_id; });
if (!char) return;
const isOwner = char.owner_id === CURRENT_USER.id;
const visible = char.is_public || isOwner;
const stats = computeCombatStats(char, p);
const mList = COMBAT.status === 'phase2' ? RULES.manoeuvres_finales : RULES.manoeuvres_initiales;
const card = el('div', 'border bg-stone-50 space-y-2');
const top = el('div', 'flex justify-between');
top.appendChild(el('strong', '', char.name + (visible ? ' (Att: ' + stats.att + ' | Déf: ' + stats.def + ')' : ' (Masqué)')));
if (isOwner) {
const bRem = el('button', '', 'Retirer'); bRem.style.color = '#dc2626'; bRem.style.fontSize = '11px';
bRem.onclick = function() { removeFromCombat(char.id); };
top.appendChild(bRem);
}
card.appendChild(top);
if (isOwner) {
const ctrl = el('div', 'flex');
const selPos = el('select', '');
RULES.postures.forEach(function(pos) {
const o = el('option', '', pos.nom); o.value = pos.nom;
if (p.posture === pos.nom) o.selected = true;
selPos.appendChild(o);
});
selPos.onchange = function() { updateCombatParticipant(char.id, 'posture', selPos.value); };
const selMan = el('select', '');
mList.forEach(function(m) {
const o = el('option', '', m.nom); o.value = m.nom;
if (p.manoeuvre === m.nom) o.selected = true;
selMan.appendChild(o);
});
selMan.onchange = function() { updateCombatParticipant(char.id, 'manoeuvre', selMan.value); };
const inpAtt = el('input', ''); inpAtt.type = 'number'; inpAtt.value = p.temp_att || 0; inpAtt.style.width = '50px';
inpAtt.onchange = function() { updateCombatParticipant(char.id, 'temp_att', inpAtt.value); };
const inpDef = el('input', ''); inpDef.type = 'number'; inpDef.value = p.temp_def || 0; inpDef.style.width = '50px';
inpDef.onchange = function() { updateCombatParticipant(char.id, 'temp_def', inpDef.value); };
ctrl.appendChild(selPos); ctrl.appendChild(selMan); ctrl.appendChild(inpAtt); ctrl.appendChild(inpDef);
card.appendChild(ctrl);
} else {
card.appendChild(el('div', '', 'Posture : ' + p.posture + (visible ? ' | Manœuvre : ' + p.manoeuvre : '')));
}
listEl.appendChild(card);
});
});
const res = COMBAT.status === 'phase2' && COMBAT.phase2_result ? COMBAT.phase2_result : COMBAT.phase1_result;
if (res) {
resBox.classList.remove('hidden');
resBox.innerHTML = '';
const isInitial = COMBAT.status === 'phase1' && !COMBAT.phase2_result;
const winner = res.scoreA > res.scoreB ? 'Camp A' : (res.scoreB > res.scoreA ? 'Camp B' : 'Égalité');
const box = el('div', 'border bg-amber-50 space-y-2');
box.appendChild(el('strong', '', 'Résultat ' + (isInitial ? 'Phase Initiale' : 'Phase Finale') + ' :'));
box.appendChild(el('div', '', 'Camp A : Attaque ' + res.attA + ' + Dé (' + res.rollA + ') - Déf B (' + res.defB + ') = Score ' + res.scoreA + ' -> ' + res.woundsToB + ' blessure(s) infligée(s) au Camp B'));
box.appendChild(el('div', '', 'Camp B : Attaque ' + res.attB + ' + Dé (' + res.rollB + ') - Déf A (' + res.defA + ') = Score ' + res.scoreB + ' -> ' + res.woundsToA + ' blessure(s) infligée(s) au Camp A'));
box.appendChild(el('div', '', isInitial ? 'Tour initial : chaque camp répartit les blessures qu’il inflige à l’adversaire.' : 'Tour final : chaque camp répartit entre ses membres les blessures qu’il subit.'));
if (!isInitial || COMBAT.combat_type === 'escarmouche') {
box.appendChild(el('strong', '', 'Vainqueur : ' + winner + ' (Score de Victoire : ' + Math.abs(res.scoreA - res.scoreB) + ')'));
}
resBox.appendChild(box);
} else {
resBox.classList.add('hidden');
}
}
init();
