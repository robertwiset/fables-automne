const SUPABASE_URL = "https://tmfzrjeaknwvkdhsqmuu.supabase.co";
const SUPABASE_KEY = "sb_publishable_Zx28ISJOTOmc-Hkmdpj-iQ_dP6kHgCC";
let AUTH_TOKEN = localStorage.getItem('fa_token') || null;
let AUTH_USER = JSON.parse(localStorage.getItem('fa_user') || 'null');

function apiHeaders() {
  const h = { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) h['Authorization'] = 'Bearer ' + AUTH_TOKEN;
  return h;
}

const sb = {
  auth: {
    getSession: async function() {
      return { data: { session: AUTH_USER ? { user: AUTH_USER } : null } };
    },
    signInWithPassword: async function(creds) {
      const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(creds) });
      const d = await r.json();
      if (!r.ok) return { error: { message: d.error_description || d.msg || 'Identifiants incorrects' } };
      AUTH_TOKEN = d.access_token; AUTH_USER = d.user;
      localStorage.setItem('fa_token', AUTH_TOKEN); localStorage.setItem('fa_user', JSON.stringify(AUTH_USER));
      return { data: { user: d.user } };
    },
    signUp: async function(creds) {
      const r = await fetch(SUPABASE_URL + '/auth/v1/signup', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(creds) });
      const d = await r.json();
      if (!r.ok) return { error: { message: d.msg || d.error_description || 'Erreur création compte' } };
      AUTH_TOKEN = d.access_token; AUTH_USER = d.user;
      if (AUTH_TOKEN) { localStorage.setItem('fa_token', AUTH_TOKEN); localStorage.setItem('fa_user', JSON.stringify(AUTH_USER)); }
      return { data: { user: d.user } };
    },
    signOut: async function() {
      localStorage.removeItem('fa_token'); localStorage.removeItem('fa_user');
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
        const r = await fetch(url, { headers: h });
        const d = await r.json().catch(function() { return null; });
        resolve(r.ok ? { data: d } : { error: d });
      },
      insert: async function(payload) {
        const r = await fetch(SUPABASE_URL + '/rest/v1/' + table, { method: 'POST', headers: Object.assign({}, apiHeaders(), { 'Prefer': 'return=representation' }), body: JSON.stringify(payload) });
        const d = await r.json().catch(function() { return null; });
        return r.ok ? { data: d } : { error: { message: (d && d.message) || 'Erreur insertion' } };
      },
      update: function(payload) {
        return {
          eq: async function(col, val) {
            const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + col + '=eq.' + encodeURIComponent(val), { method: 'PATCH', headers: apiHeaders(), body: JSON.stringify(payload) });
            if (r.ok && typeof refreshAllData === 'function') setTimeout(refreshAllData, 200);
            return r.ok ? { data: true } : { error: { message: 'Erreur mise à jour' } };
          }
        };
      },
      delete: function() {
        return {
          eq: async function(col, val) {
            const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + col + '=eq.' + encodeURIComponent(val), { method: 'DELETE', headers: apiHeaders() });
            if (r.ok && typeof refreshAllData === 'function') setTimeout(refreshAllData, 200);
            return r.ok ? { data: true } : { error: { message: 'Erreur suppression' } };
          }
        };
      }
    };
    return q;
  },
  channel: function() {
    setInterval(function() { if (typeof refreshAllData === 'function' && CURRENT_USER) refreshAllData(); }, 4000);
    return { on: function() { return this; }, subscribe: function() {} };
  }
};


let RULES = null, CURRENT_USER = null, CHARACTERS = [], SCENE = null, COMBAT = null, ROLLS = [];
let CREATE_CARACS = { Force: 8, Agilité: 8, Santé: 8, Connaissance: 8, Perception: 8, Présence: 8 };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
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
  await refreshAllData();
  subscribeRealtime();
}

async function refreshAllData() {
  const results = await Promise.all([
    sb.from('characters').select('*').order('created_at', { ascending: true }),
    sb.from('scene_state').select('*').eq('id', 1).single(),
    sb.from('roll_history').select('*').order('created_at', { ascending: false }).limit(40),
    sb.from('combat_state').select('*').eq('id', 1).single()
  ]);
  CHARACTERS = results[0].data || [];
  SCENE = results[1].data || { environment: 'Normal', cover_terrain: 'Aucun', cover_obstacle: 'Aucun', cover_noise: 'Normal', cover_light: 'Normale' };
  ROLLS = results[2].data || [];
  COMBAT = results[3].data || { status: 'inactif', participants: [] };

  syncSceneUI();
  syncCharacterDropdowns();
  renderSkillButtons();
  renderRollHistory();
  renderCharacterSheet();
  renderCombat();
}

function subscribeRealtime() {
  sb.channel('table-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'characters' }, refreshAllData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'scene_state' }, refreshAllData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'roll_history' }, refreshAllData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'combat_state' }, refreshAllData)
    .subscribe();
}

function switchTab(tab) {
  ['scene', 'combat', 'chars', 'create'].forEach(function(t) {
    document.getElementById('tab-' + t).classList.toggle('hidden', t !== tab);
    document.getElementById('tab-btn-' + t).className = (t === tab)
      ? 'px-3 py-1 rounded bg-amber-700 text-white text-sm'
      : 'px-3 py-1 rounded bg-stone-700 text-stone-200 text-sm';
  });
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
  let totalWeight = 0;
  inv.forEach(function(item) { totalWeight += (item.poids || 0); });

  let armorDef = 0;
  let rawArmorMalusAgi = 0;
  ['Tete', 'Torse', 'Bassin', 'BrasDroit', 'BrasGauche', 'Jambes'].forEach(function(slot) {
    const idx = worn[slot];
    if (idx !== undefined && idx !== null && inv[idx]) {
      armorDef += (inv[idx].def || 0);
      rawArmorMalusAgi += (inv[idx].malus_agi || 0);
    }
  });

  let armorMalusAgi = Math.floor(rawArmorMalusAgi);
  if (talents.includes('Entraînement aux armures légères')) armorMalusAgi = Math.max(0, armorMalusAgi - 2);
  if (talents.includes('Entraînement aux armures lourdes')) armorMalusAgi = Math.max(0, armorMalusAgi - 2);

  let maxWeight = caracs['Force'] * 2;
  if (talents.includes('Transport')) maxWeight += 8;
  if (talents.includes('Chargement')) maxWeight += 8;
  const encumbered = totalWeight > maxWeight;

  const emotionObj = RULES.emotions.find(function(e) { return e.nom === (d.emotion || 'Aucune'); }) || { comp: 0, att: 0, def: 0 };
  const fatigue = d.fatigue || 0;

  return { caracs: caracs, talents: talents, maxWoundMalus: maxWoundMalus, limbDisabled: limbDisabled, totalWeight: totalWeight, maxWeight: maxWeight, encumbered: encumbered, armorDef: armorDef, armorMalusAgi: armorMalusAgi, emotionObj: emotionObj, fatigue: fatigue, worn: worn, inv: inv, blessures: blessures };
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

function renderSkillButtons() {
  const charId = document.getElementById('active-char-select').value;
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const statusDiv = document.getElementById('active-char-status');
  const caracDiv = document.getElementById('carac-buttons');
  const skillDiv = document.getElementById('skill-buttons');
  caracDiv.innerHTML = '';
  skillDiv.innerHTML = '';
  if (!char) {
    statusDiv.textContent = "Créez d'abord un personnage dans l'onglet '+ Créer'.";
    return;
  }
  const st = getEffectiveState(char);
  statusDiv.textContent = 'Fatigue : ' + st.fatigue + ' | Émotion : ' + (char.data.emotion || 'Aucune') + ' | Malus blessure : -' + st.maxWoundMalus + ' | Malus armure Agi : -' + st.armorMalusAgi + (st.encumbered ? ' | ENCOMBRÉ !' : '');

  RULES.caracteristiques.forEach(function(cName) {
    const mod = (st.caracs[cName] || 10) - 10;
    const sign = mod >= 0 ? '+' : '';
    const btn = el('button', 'p-2 border rounded hover:bg-amber-50 text-xs font-medium', cName + ' (' + sign + mod + ')');
    btn.onclick = function() { rollTest(cName, true); };
    caracDiv.appendChild(btn);
  });

  RULES.competences.forEach(function(comp) {
    const mod = computeSkillModifier(char, st, comp).total;
    const sign = mod >= 0 ? '+' : '';
    const btn = el('button', 'p-2 border rounded hover:bg-amber-50 text-left text-xs flex justify-between');
    btn.appendChild(el('span', '', comp.nom));
    btn.appendChild(el('span', 'font-bold', sign + mod));
    btn.onclick = function() { rollTest(comp.nom, false); };
    skillDiv.appendChild(btn);
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

  if (st.talents.includes('Adaptation') && char.data.adaptation_milieu === SCENE.environment) {
    if (['Déplacement', 'Détection', 'Discrétion', 'Equilibre', 'Chasse', 'Orientation'].includes(comp.nom)) {
      total += 1;
      parts.push('Adaptation +1');
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
  if (comp.carac === 'Agilité' && st.armorMalusAgi > 0) {
    total -= st.armorMalusAgi;
    parts.push('Armure -' + st.armorMalusAgi);
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
    const card = el('div', 'p-2 border rounded bg-stone-50');
    const top = el('div', 'flex justify-between font-bold');
    top.appendChild(el('span', '', r.character_name + (r.is_public ? '' : ' [Masqué]') + ' — ' + r.skill_name));
    top.appendChild(el('span', 'text-amber-900 text-sm', r.total));
    card.appendChild(top);
    card.appendChild(el('div', 'text-stone-500 text-[11px]', r.details));
    list.appendChild(card);
  });
}
function initCreationForm() {
  const mount = document.getElementById('create-form-mount');
  mount.innerHTML = '';
  mount.appendChild(el('h2', 'font-bold text-amber-900 text-lg', "Création guidée d'un personnage (Niveau 1)"));

  const row1 = el('div', 'grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm');
  const colName = el('div', '');
  colName.appendChild(el('label', 'block text-xs text-stone-500', 'Nom du personnage *'));
  const inpName = el('input', 'w-full border rounded p-2');
  inpName.id = 'c-name';
  inpName.type = 'text';
  colName.appendChild(inpName);
  row1.appendChild(colName);

  const colDesire = el('div', '');
  colDesire.appendChild(el('label', 'block text-xs text-stone-500', 'Désir fondamental'));
  const selDesire = el('select', 'w-full border rounded p-2');
  selDesire.id = 'c-desire';
  RULES.desirs.forEach(function(d) { const o = el('option', '', d); o.value = d; selDesire.appendChild(o); });
  colDesire.appendChild(selDesire);
  row1.appendChild(colDesire);

  const colPub = el('div', 'flex items-end pb-2');
  const lblPub = el('label', 'flex items-center gap-2 text-xs');
  const chkPub = el('input', '');
  chkPub.id = 'c-public';
  chkPub.type = 'checkbox';
  chkPub.checked = true;
  lblPub.appendChild(chkPub);
  lblPub.appendChild(document.createTextNode(' Visible par tous les joueurs'));
  colPub.appendChild(lblPub);
  row1.appendChild(colPub);
  mount.appendChild(row1);

  const secCarac = el('div', 'border-t pt-3 space-y-2');
  const topCarac = el('div', 'flex justify-between items-center');
  topCarac.appendChild(el('h3', 'font-bold text-sm', '1. Caractéristiques de base (Base 8, max 12 avant bonus)'));
  const ptsBadge = el('span', 'text-xs font-bold bg-amber-100 text-amber-900 px-2 py-1 rounded', 'Points restants : 14');
  ptsBadge.id = 'c-points-left';
  topCarac.appendChild(ptsBadge);
  secCarac.appendChild(topCarac);

  const gridCarac = el('div', 'grid grid-cols-2 sm:grid-cols-6 gap-2');
  RULES.caracteristiques.forEach(function(c) {
    const box = el('div', 'border rounded p-2 text-center bg-stone-50');
    box.appendChild(el('div', 'text-xs font-bold', c));
    const ctrl = el('div', 'flex justify-center items-center gap-2 mt-1');
    const bMinus = el('button', 'px-2 bg-stone-200 rounded font-bold', '-');
    bMinus.onclick = function() { changeCreateCarac(c, -1); };
    const valSpan = el('span', 'font-bold text-sm', '8');
    valSpan.id = 'cc-' + c;
    const bPlus = el('button', 'px-2 bg-stone-200 rounded font-bold', '+');
    bPlus.onclick = function() { changeCreateCarac(c, 1); };
    ctrl.appendChild(bMinus);
    ctrl.appendChild(valSpan);
    ctrl.appendChild(bPlus);
    box.appendChild(ctrl);
    gridCarac.appendChild(box);
  });
  secCarac.appendChild(gridCarac);
  mount.appendChild(secCarac);

  const secOrigin = el('div', 'grid grid-cols-1 sm:grid-cols-2 gap-3 border-t pt-3 text-sm');
  const divP = el('div', 'space-y-1');
  divP.appendChild(el('h3', 'font-bold text-sm', '2. Peuple'));
  const selP = el('select', 'w-full border rounded p-2');
  selP.id = 'c-peuple';
  selP.onchange = updateCreationChoices;
  RULES.peuples.forEach(function(p) { const o = el('option', '', p.nom); o.value = p.nom; selP.appendChild(o); });
  const selPC = el('select', 'w-full border rounded p-2');
  selPC.id = 'c-peuple-carac';
  selPC.onchange = updateCreationTalents;
  const selPT = el('select', 'w-full border rounded p-2');
  selPT.id = 'c-peuple-talent';
  selPT.onchange = updateCreationTalents;
  divP.appendChild(selP); divP.appendChild(selPC); divP.appendChild(selPT);
  secOrigin.appendChild(divP);

  const divC = el('div', 'space-y-1');
  divC.appendChild(el('h3', 'font-bold text-sm', '3. Culture'));
  const selC = el('select', 'w-full border rounded p-2');
  selC.id = 'c-culture';
  selC.onchange = updateCreationChoices;
  RULES.cultures.forEach(function(c) { const o = el('option', '', c.nom); o.value = c.nom; selC.appendChild(o); });
  const selCC = el('select', 'w-full border rounded p-2');
  selCC.id = 'c-culture-carac';
  selCC.onchange = updateCreationTalents;
  const selCT = el('select', 'w-full border rounded p-2');
  selCT.id = 'c-culture-talent';
  selCT.onchange = updateCreationTalents;
  divC.appendChild(selC); divC.appendChild(selCC); divC.appendChild(selCT);
  secOrigin.appendChild(divC);
  mount.appendChild(secOrigin);

  const secCl = el('div', 'border-t pt-3 space-y-2 text-sm');
  secCl.appendChild(el('h3', 'font-bold text-sm', '4. Classe (Choisissez 4 talents éligibles)'));
  const selCl = el('select', 'w-full border rounded p-2');
  selCl.id = 'c-classe';
  selCl.onchange = updateCreationTalents;
  RULES.classes.forEach(function(c) { const o = el('option', '', c.nom); o.value = c.nom; selCl.appendChild(o); });
  secCl.appendChild(selCl);
  const clGrid = el('div', 'grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1');
  clGrid.id = 'c-classe-talents';
  secCl.appendChild(clGrid);
  mount.appendChild(secCl);

  const btnSave = el('button', 'w-full bg-amber-800 hover:bg-amber-700 text-white font-bold py-2.5 rounded-lg', 'Créer le personnage');
  btnSave.onclick = saveNewCharacter;
  mount.appendChild(btnSave);

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

function isTalentEligible(talentName, caracs, acquiredTalents) {
  const t = RULES.talents.find(function(x) { return x.nom === talentName; });
  if (!t) return false;
  if (t.niveau_min && t.niveau_min > 1) return false;
  if (!t.cumulable && acquiredTalents.includes(talentName)) return false;
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
    const ok = isTalentEligible(tName, caracs, []);
    const o = el('option', '', 'Talent Peuple : ' + tName + (ok ? '' : ' (Prérequis non remplis)'));
    o.value = tName;
    o.disabled = !ok;
    pSel.appendChild(o);
  });
  if (pObj.talents.includes(prevP)) pSel.value = prevP;
  const acquired1 = pSel.value && isTalentEligible(pSel.value, caracs, []) ? [pSel.value] : [];

  const cSel = document.getElementById('c-culture-talent');
  const prevC = cSel.value;
  cSel.innerHTML = '';
  cObj.talents.forEach(function(tName) {
    const ok = isTalentEligible(tName, caracs, acquired1);
    const o = el('option', '', 'Talent Culture : ' + tName + (ok ? '' : ' (Prérequis non remplis)'));
    o.value = tName;
    o.disabled = !ok;
    cSel.appendChild(o);
  });
  if (cObj.talents.includes(prevC)) cSel.value = prevC;
  const acquired2 = acquired1.slice();
  if (cSel.value && isTalentEligible(cSel.value, caracs, acquired1)) acquired2.push(cSel.value);

  let validChecked = [];
  let changed = true;
  while (changed) {
    changed = false;
    prevChecked.forEach(function(tName) {
      if (clObj.talents.includes(tName) && !validChecked.includes(tName)) {
        if (isTalentEligible(tName, caracs, acquired2.concat(validChecked))) {
          validChecked.push(tName);
          changed = true;
        }
      }
    });
  }

  const allAcquired = acquired2.concat(validChecked);
  const clDiv = document.getElementById('c-classe-talents');
  clDiv.innerHTML = '';
  clObj.talents.forEach(function(tName) {
    const isChecked = validChecked.includes(tName);
    const othersAcquired = allAcquired.filter(function(x) { return x !== tName; });
    const ok = isChecked || isTalentEligible(tName, caracs, othersAcquired);
    const tInfo = RULES.talents.find(function(x) { return x.nom === tName; });
    const lbl = el('label', 'p-2 border rounded flex items-start gap-2 text-xs ' + (ok ? 'bg-white cursor-pointer' : 'bg-stone-100 opacity-50'));
    const chk = el('input', 'mt-0.5');
    chk.type = 'checkbox';
    chk.name = 'c-cl-talent';
    chk.value = tName;
    chk.checked = isChecked;
    chk.disabled = !ok;
    chk.onchange = function() { onClassTalentToggle(chk); };
    const txt = el('div', '');
    txt.appendChild(el('div', 'font-bold', tName));
    txt.appendChild(el('div', 'text-stone-500', tInfo ? tInfo.effet : ''));
    lbl.appendChild(chk);
    lbl.appendChild(txt);
    clDiv.appendChild(lbl);
  });
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

async function saveNewCharacter() {
  const name = document.getElementById('c-name').value.trim();
  if (!name) return alert("Veuillez saisir un nom de personnage.");
const used = Object.values(CREATE_CARACS).reduce(function(a, b) { return a + (b - 8); }, 0);
if (used !== 14) return alert("Vous devez répartir exactement les 14 points de caractéristiques.");
const pTalent = document.getElementById('c-peuple-talent').value;
const cTalent = document.getElementById('c-culture-talent').value;
const clTalents = Array.from(document.querySelectorAll('input[name="c-cl-talent"]:checked')).map(function(x) { return x.value; });
if (clTalents.length !== 4) return alert("Veuillez sélectionner exactement 4 talents de classe.");
const charData = {
desir: document.getElementById('c-desire').value,
peuple: document.getElementById('c-peuple').value,
peuple_carac: document.getElementById('c-peuple-carac').value,
culture: document.getElementById('c-culture').value,
culture_carac: document.getElementById('c-culture-carac').value,
classe: document.getElementById('c-classe').value,
base_caracs: Object.assign({}, CREATE_CARACS),
talents_lvl1: [pTalent, cTalent].concat(clTalents),
adaptation_milieu: "Forêt",
level_caracs: {},
level_talents: {},
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
alert("Personnage créé avec succès !");
switchTab('chars');
}
function renderCharacterSheet() {
  const charId = document.getElementById('sheet-char-select').value;
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const container = document.getElementById('character-sheet-container');
  container.innerHTML = '';
  if (!char) { container.textContent = "Aucun personnage sélectionné."; return; }

  const isOwner = char.owner_id === CURRENT_USER.id;
  const st = getEffectiveState(char);

  const header = el('div', 'flex flex-wrap justify-between items-start gap-3 border-b pb-3');
  const titleBox = el('div', '');
  titleBox.appendChild(el('h3', 'text-xl font-bold text-amber-900', char.name + (char.is_public ? '' : ' [Masqué]')));
  titleBox.appendChild(el('p', 'text-xs text-stone-600', char.data.peuple + ' • ' + char.data.culture + ' • ' + char.data.classe + ' • Désir : ' + char.data.desir));
  header.appendChild(titleBox);

  if (isOwner) {
    const ctrl = el('div', 'flex flex-wrap items-center gap-1.5 text-xs');
    ctrl.appendChild(el('span', 'font-bold bg-stone-100 px-2 py-1 rounded', 'Niveau réel : ' + char.level));
    const bUp = el('button', 'bg-amber-700 text-white px-2 py-1 rounded', '+1 Niv');
    bUp.onclick = function() { changeLevel(char.id, 1); };
    const bDown = el('button', 'bg-stone-300 px-2 py-1 rounded', '-1 Niv');
    bDown.onclick = function() { changeLevel(char.id, -1); };
    const selEff = el('select', 'border rounded p-1');
    for (let i = 1; i <= char.level; i++) {
      const o = el('option', '', 'Niveau effectif : ' + i);
      o.value = i;
      if (i === char.effective_level) o.selected = true;
      selEff.appendChild(o);
    }
    selEff.onchange = function() { setEffectiveLevel(char.id, selEff.value); };
    const bPub = el('button', 'bg-blue-100 text-blue-900 px-2 py-1 rounded', char.is_public ? 'Masquer' : 'Rendre public');
    bPub.onclick = function() { togglePublic(char.id); };
    const bTrans = el('button', 'bg-purple-100 text-purple-900 px-2 py-1 rounded', 'Transférer');
    bTrans.onclick = function() { transferCharacter(char.id); };
    const bDel = el('button', 'bg-red-100 text-red-900 px-2 py-1 rounded', 'Supprimer');
    bDel.onclick = function() { deleteCharacter(char.id); };
    ctrl.appendChild(bUp); ctrl.appendChild(bDown); ctrl.appendChild(selEff); ctrl.appendChild(bPub); ctrl.appendChild(bTrans); ctrl.appendChild(bDel);
    header.appendChild(ctrl);
  } else {
    header.appendChild(el('span', 'text-xs bg-stone-100 px-2 py-1 rounded', 'Niveau effectif : ' + char.effective_level + ' / ' + char.level + ' (Lecture seule)'));
  }
  container.appendChild(header);

  const caracGrid = el('div', 'grid grid-cols-2 sm:grid-cols-6 gap-2');
  RULES.caracteristiques.forEach(function(c) {
    const val = st.caracs[c] || 10;
    const mod = val - 10;
    const box = el('div', 'border rounded p-2 text-center bg-amber-50');
    box.appendChild(el('div', 'text-xs text-stone-500', c));
    box.appendChild(el('div', 'font-bold text-base', val + ' (' + (mod >= 0 ? '+' + mod : mod) + ')'));
    caracGrid.appendChild(box);
  });
  container.appendChild(caracGrid);

  const healthBox = el('div', 'border rounded-lg p-3 bg-stone-50 space-y-2 text-xs');
  healthBox.appendChild(el('h4', 'font-bold text-sm text-amber-900', 'État psychologique, Fatigue & Repos'));
  const hRow = el('div', 'flex flex-wrap items-center gap-3');
  const selEmo = el('select', 'border rounded p-1.5');
  selEmo.disabled = !isOwner;
  RULES.emotions.forEach(function(e) {
    const o = el('option', '', e.nom + ' (Comp ' + e.comp + ', Att ' + e.att + ', Déf ' + e.def + ')');
    o.value = e.nom;
    if ((char.data.emotion || 'Aucune') === e.nom) o.selected = true;
    selEmo.appendChild(o);
  });
  selEmo.onchange = function() { updateCharField(char.id, 'emotion', selEmo.value); };
  hRow.appendChild(selEmo);

  const fatWrap = el('div', 'flex items-center gap-1.5 bg-white border rounded px-2 py-1');
  fatWrap.appendChild(el('span', '', 'Fatigue (Max ' + st.caracs['Santé'] + ') :'));
  if (isOwner) { const bFm = el('button', 'px-1.5 bg-stone-200 rounded font-bold', '-'); bFm.onclick = function() { changeFatigue(char.id, -1); }; fatWrap.appendChild(bFm); }
  fatWrap.appendChild(el('strong', 'text-sm', st.fatigue));
  if (isOwner) { const bFp = el('button', 'px-1.5 bg-stone-200 rounded font-bold', '+'); bFp.onclick = function() { changeFatigue(char.id, 1); }; fatWrap.appendChild(bFp); }
  hRow.appendChild(fatWrap);

  if (isOwner) {
    const lblMed = el('label', 'flex items-center gap-1');
    const chkMed = el('input', ''); chkMed.type = 'checkbox'; chkMed.id = 'rest-med-' + char.id;
    lblMed.appendChild(chkMed); lblMed.appendChild(document.createTextNode('Soin/Médecine'));
    hRow.appendChild(lblMed);
    const bRc = el('button', 'bg-emerald-700 text-white px-2 py-1 rounded', 'Repos court (2h)');
    bRc.onclick = function() { takeRest(char.id, 'court'); };
    const bRl = el('button', 'bg-emerald-800 text-white px-2 py-1 rounded', 'Repos long (10h)');
    bRl.onclick = function() { takeRest(char.id, 'long'); };
    const bFiev = el('button', 'bg-orange-700 text-white px-2 py-1 rounded', 'Test Fièvre (D10)');
    bFiev.onclick = function() { rollFeverTest(char.id); };
    hRow.appendChild(bRc); hRow.appendChild(bRl); hRow.appendChild(bFiev);
  }
  healthBox.appendChild(hRow);
  container.appendChild(healthBox);

  const woundBox = el('div', 'border rounded-lg p-3 space-y-2 text-xs');
  const wTop = el('div', 'flex flex-wrap justify-between items-center gap-2');
  wTop.appendChild(el('h4', 'font-bold text-sm text-amber-900', 'Blessures localisées'));
  if (isOwner) {
    const wBtns = el('div', 'flex gap-1');
    ['legere', 'moyenne', 'grave'].forEach(function(tp) {
      const b = el('button', 'bg-rose-700 text-white px-2 py-1 rounded capitalize', '+ ' + tp);
      b.onclick = function() { rollRandomWound(char.id, tp); };
      wBtns.appendChild(b);
    });
    wTop.appendChild(wBtns);
  }
  woundBox.appendChild(wTop);

  const wGrid = el('div', 'grid grid-cols-1 sm:grid-cols-3 gap-2');
  ['Tête', 'Torse', 'Ventre/Bassin', 'Bras droit', 'Bras gauche', 'Jambe(s)'].forEach(function(loc) {
    const b = st.blessures[loc] || { gravite: 0, infectee: false, jours: 0 };
    const card = el('div', 'p-2 border rounded ' + (b.gravite > 0 ? 'bg-rose-50 border-rose-300' : 'bg-white'));
    card.appendChild(el('div', 'font-bold', loc + (b.infectee ? ' [INFECTÉE]' : '')));
    card.appendChild(el('div', 'text-stone-600', b.gravite > 0 ? 'Gravité ' + b.gravite + ' (' + b.jours + 'j)' : 'Indemne'));
    if (isOwner) {
      const gRow = el('div', 'flex gap-1 mt-1');
      [0,1,2,3,4,5,6].forEach(function(g) {
        const gb = el('button', 'px-1.5 py-0.5 border rounded ' + (b.gravite === g ? 'bg-rose-800 text-white' : 'bg-stone-100'), 'G' + g);
        gb.onclick = function() { setWoundLevel(char.id, loc, g); };
        gRow.appendChild(gb);
      });
      card.appendChild(gRow);
    }
    wGrid.appendChild(card);
  });
  woundBox.appendChild(wGrid);
  container.appendChild(woundBox);

  const eqBox = el('div', 'border rounded-lg p-3 space-y-2 text-xs');
  const eqTop = el('div', 'flex flex-wrap justify-between items-center gap-2');
  eqTop.appendChild(el('h4', 'font-bold text-sm text-amber-900', 'Équipement (' + st.totalWeight + ' / ' + st.maxWeight + ' kg)'));
  if (isOwner) {
    const addWrap = el('div', 'flex gap-1');
    const selEq = el('select', 'border rounded p-1'); selEq.id = 'add-equip-sel';
    RULES.equipements.forEach(function(e, i) { const o = el('option', '', e.nom + ' (' + e.poids + 'kg)'); o.value = i; selEq.appendChild(o); });
    const bAddEq = el('button', 'bg-amber-800 text-white px-2 py-1 rounded', 'Ajouter');
    bAddEq.onclick = function() { addEquipment(char.id); };
    addWrap.appendChild(selEq); addWrap.appendChild(bAddEq);
    eqTop.appendChild(addWrap);
  }
  eqBox.appendChild(eqTop);

  const slotGrid = el('div', 'grid grid-cols-1 sm:grid-cols-3 gap-2');
  const slots = [
    { key: 'MainPrincipale', label: 'Main principale', filter: function(e) { return e.categorie === 'Arme'; } },
    { key: 'MainSecondaire', label: 'Main secondaire', filter: function(e) { return e.categorie === 'Arme' || e.categorie === 'Bouclier'; } },
    { key: 'Tete', label: 'Tête', filter: function(e) { return e.slot === 'Tête'; } },
    { key: 'Torse', label: 'Torse', filter: function(e) { return e.slot === 'Torse'; } },
    { key: 'Bassin', label: 'Bassin', filter: function(e) { return e.slot === 'Bassin'; } },
    { key: 'BrasDroit', label: 'Bras droit', filter: function(e) { return e.slot === 'Bras'; } },
    { key: 'BrasGauche', label: 'Bras gauche', filter: function(e) { return e.slot === 'Bras'; } },
    { key: 'Jambes', label: 'Jambes', filter: function(e) { return e.slot === 'Jambes'; } },
    { key: 'Monture', label: 'Monture', filter: function(e) { return e.categorie === 'Monture'; } }
  ];
  slots.forEach(function(sl) {
    const mainItem = st.inv[st.worn['MainPrincipale']];
    const locked = sl.key === 'MainSecondaire' && mainItem && mainItem.mains === 2;
    const sCard = el('div', 'p-2 border rounded bg-stone-50');
    sCard.appendChild(el('div', 'font-bold text-stone-600', sl.label));
    const sSel = el('select', 'w-full border rounded p-1 mt-1');
    sSel.disabled = !isOwner || locked;
    const optNone = el('option', '', locked ? '(Bloqué : arme 2 mains)' : '— Aucun —'); optNone.value = '';
    sSel.appendChild(optNone);
    st.inv.forEach(function(item, idx) {
      if (sl.filter(item)) {
        const o = el('option', '', item.nom); o.value = idx;
        if (st.worn[sl.key] === idx) o.selected = true;
        sSel.appendChild(o);
      }
    });
    sSel.onchange = function() { equipSlot(char.id, sl.key, sSel.value); };
    sCard.appendChild(sSel);
    slotGrid.appendChild(sCard);
  });
  eqBox.appendChild(slotGrid);

  const invList = el('div', 'flex flex-wrap gap-1.5 pt-2 border-t');
st.inv.forEach(function(item, idx) {
const badge = el('span', 'bg-stone-100 border px-2 py-1 rounded flex items-center gap-1', item.nom + ' (' + item.poids + 'kg)');
if (isOwner && idx > 0) {
const rx = el('button', 'text-red-600 font-bold ml-1', 'x');
rx.onclick = function() { removeEquipment(char.id, idx); };
badge.appendChild(rx);
}
invList.appendChild(badge);
});
eqBox.appendChild(invList);
container.appendChild(eqBox);
const talBox = el('div', 'border rounded-lg p-3 space-y-2 text-xs');
const talTop = el('div', 'flex justify-between items-center');
talTop.appendChild(el('h4', 'font-bold text-sm text-amber-900', 'Talents actifs (' + st.talents.length + ')'));
if (isOwner && st.talents.includes('Adaptation')) {
const selAd = el('select', 'border rounded p-1');
['Forêt', 'Désert', 'Montagne', 'Froid', 'Chaleur', 'Mer'].forEach(function(m) {
const o = el('option', '', 'Adaptation : ' + m); o.value = m;
if (char.data.adaptation_milieu === m) o.selected = true;
selAd.appendChild(o);
});
selAd.onchange = function() { updateCharField(char.id, 'adaptation_milieu', selAd.value); };
talTop.appendChild(selAd);
}
talBox.appendChild(talTop);
const talGrid = el('div', 'grid grid-cols-1 sm:grid-cols-2 gap-1.5');
st.talents.forEach(function(tName) {
const tObj = RULES.talents.find(function(x) { return x.nom === tName; });
const tc = el('div', 'p-2 border rounded bg-stone-50');
tc.appendChild(el('div', 'font-bold', tName));
tc.appendChild(el('div', 'text-stone-600', tObj ? tObj.effet : ''));
talGrid.appendChild(tc);
});
talBox.appendChild(talGrid);
container.appendChild(talBox);
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
  if (!target) return alert("Cet utilisateur doit d'abord avoir créé au moins un personnage sur l'application pour être trouvé.");
  await sb.from('characters').update({ owner_id: target.owner_id, owner_email: target.owner_email }).eq('id', charId);
  alert("Personnage transféré !");
}

async function changeLevel(charId, delta) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const newLvl = char.level + delta;
  if (newLvl < 1 || newLvl > 30) return;
  const d = Object.assign({}, char.data);
  if (delta > 0) {
    const tempChar = Object.assign({}, char, { effective_level: char.level });
    const st = getEffectiveState(tempChar);
    if (newLvl % 5 === 0) {
      const prevC = d.level_caracs ? d.level_caracs[newLvl - 5] : null;
      const availC = RULES.caracteristiques.filter(function(c) { return c !== prevC; });
      const choiceC = prompt("Niveau " + newLvl + " ! Choisissez une caractéristique +1 (" + availC.join(', ') + ") :");
      if (availC.includes(choiceC)) {
        d.level_caracs = Object.assign({}, d.level_caracs || {});
        d.level_caracs[newLvl] = choiceC;
        st.caracs[choiceC] += 1;
      } else {
        return alert("Caractéristique invalide ou identique au palier précédent.");
      }
    }
    const elig1 = RULES.talents.filter(function(t) { return t.type === 'commun' && isTalentEligible(t.nom, st.caracs, st.talents); }).map(function(t) { return t.nom; });
    const t1 = prompt("Niveau " + newLvl + " — Talent 1/2 parmi :\n" + elig1.join(', '));
    if (!elig1.includes(t1)) return alert("Talent 1 invalide.");
    const elig2 = RULES.talents.filter(function(t) { return t.type === 'commun' && isTalentEligible(t.nom, st.caracs, st.talents.concat([t1])); }).map(function(t) { return t.nom; });
    const t2 = prompt("Niveau " + newLvl + " — Talent 2/2 parmi :\n" + elig2.join(', '));
    if (!elig2.includes(t2)) return alert("Talent 2 invalide.");
    const gained = [t1, t2];
    if ([15, 18, 21, 24, 27, 30].includes(newLvl)) {
      const epiques = RULES.talents.filter(function(t) { return t.type === 'epique' && !st.talents.includes(t.nom); }).map(function(t) { return t.nom; });
      const te = prompt("Palier Épique ! Choisissez 1 talent épique :\n" + epiques.join(', '));
      if (!epiques.includes(te)) return alert("Talent épique invalide.");
      gained.push(te);
    }
    d.level_talents = Object.assign({}, d.level_talents || {});
    d.level_talents[newLvl] = gained;
  }
  await sb.from('characters').update({ level: newLvl, effective_level: newLvl, data: d }).eq('id', charId);
}

async function setEffectiveLevel(charId, lvl) {
  await sb.from('characters').update({ effective_level: parseInt(lvl) }).eq('id', charId);
}

async function changeFatigue(charId, delta) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const infectedCount = Object.values(char.data.blessures || {}).filter(function(b) { return b && b.infectee; }).length;
  const newFat = Math.max(infectedCount, (char.data.fatigue || 0) + delta);
  await updateCharField(charId, 'fatigue', newFat);
}

async function addEquipment(charId) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const idx = parseInt(document.getElementById('add-equip-sel').value);
  const item = Object.assign({}, RULES.equipements[idx]);
  const inv = (char.data.inventaire || []).concat([item]);
  await updateCharField(charId, 'inventaire', inv);
}

async function removeEquipment(charId, idx) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const inv = (char.data.inventaire || []).slice();
  inv.splice(idx, 1);
  const worn = Object.assign({}, char.data.worn || {});
  Object.keys(worn).forEach(function(k) {
    if (worn[k] === idx) delete worn[k];
    else if (worn[k] > idx) worn[k] -= 1;
  });
  const d = Object.assign({}, char.data, { inventaire: inv, worn: worn });
  await updateCharData(charId, d);
}

async function equipSlot(charId, slot, idxStr) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const worn = Object.assign({}, char.data.worn || {});
  if (idxStr === "") delete worn[slot];
  else {
    const idx = parseInt(idxStr);
    worn[slot] = idx;
    if (slot === 'MainPrincipale' && char.data.inventaire[idx] && char.data.inventaire[idx].mains === 2) {
      delete worn['MainSecondaire'];
    }
  }
  await updateCharField(charId, 'worn', worn);
}

async function setWoundLevel(charId, loc, gravite) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const blessures = Object.assign({}, char.data.blessures || {});
  if (gravite === 0) delete blessures[loc];
  else {
    const mult = [0, 1, 2, 4, 5, 10, 20][gravite] || 1;
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
  const loc = locs[Math.floor(Math.random() * 6)];
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
    if (keys.length > 0) blessures[keys[0]].infectee = true;
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
  parts.push({
    char_id: charId, camp: camp, posture: 'Défensif', manoeuvre: 'Pas de manœuvre initiale', temp_att: 0, temp_def: 0
  });
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
  const posObj = RULES.postures.find(function(x) { return x.nom === p.posture; }) || RULES.postures[0];
  const mList = COMBAT.status === 'phase2' ? RULES.manoeuvres_finales : RULES.manoeuvres_initiales;
  const manObj = mList.find(function(x) { return x.nom === p.manoeuvre; }) || { att: 0, def: 0 };
  const mainWeapon = st.inv[st.worn['MainPrincipale']] || { degat: 0, portee: 0, mains: 1, force_min: 5 };
  const secItem = st.inv[st.worn['MainSecondaire']];

  let attCarac = (st.caracs['Force'] || 10) - 10;
  if (st.talents.includes('Finesse') && st.caracs['Force'] >= (mainWeapon.force_min || 5) + 1) {
    attCarac = Math.max(attCarac, (st.caracs['Agilité'] || 10) - 10);
  }
  let att = attCarac + (mainWeapon.degat || 0) + posObj.att + (manObj.att || 0) + st.emotionObj.att - st.fatigue - st.maxWoundMalus + (parseInt(p.temp_att) || 0);
  if (secItem) {
    if (secItem.categorie === 'Arme') att += (secItem.degat || 0);
    if (!st.talents.includes('Ambidextrie')) att -= 2;
  }
  att = Math.max(0, att);

  let def = ((st.caracs['Agilité'] || 10) - 10) - st.armorMalusAgi + st.armorDef + posObj.def + (manObj.def || 0) + st.emotionObj.def - st.fatigue - st.maxWoundMalus + (parseInt(p.temp_def) || 0);
  if (!posObj.sans_portee) def += (mainWeapon.portee || 0);
  if (secItem && secItem.categorie === 'Bouclier') def += (secItem.def || 0);
  if (st.talents.includes('Esquive')) def += 1;
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

      const card = el('div', 'p-2 border rounded bg-stone-50 text-sm space-y-1');
      const top = el('div', 'flex justify-between font-bold');
      top.appendChild(el('span', '', char.name + (visible ? ' (Att: ' + stats.att + ' | Déf: ' + stats.def + ')' : ' (Masqué)')));
      if (isOwner) {
        const bRem = el('button', 'text-red-600 text-xs', 'Retirer');
        bRem.onclick = function() { removeFromCombat(char.id); };
        top.appendChild(bRem);
      }
      card.appendChild(top);

      if (isOwner) {
        const ctrl = el('div', 'flex flex-wrap gap-1');
        const selPos = el('select', 'border rounded p-1 text-xs');
        RULES.postures.forEach(function(pos) {
          const o = el('option', '', pos.nom); o.value = pos.nom;
          if (p.posture === pos.nom) o.selected = true;
          selPos.appendChild(o);
        });
        selPos.onchange = function() { updateCombatParticipant(char.id, 'posture', selPos.value); };

        const selMan = el('select', 'border rounded p-1 text-xs');
        mList.forEach(function(m) {
          const o = el('option', '', m.nom); o.value = m.nom;
          if (p.manoeuvre === m.nom) o.selected = true;
          selMan.appendChild(o);
        });
        selMan.onchange = function() { updateCombatParticipant(char.id, 'manoeuvre', selMan.value); };

        const inpAtt = el('input', 'border rounded p-1 w-14 text-xs');
        inpAtt.type = 'number'; inpAtt.value = p.temp_att || 0; inpAtt.placeholder = 'Att';
        inpAtt.onchange = function() { updateCombatParticipant(char.id, 'temp_att', inpAtt.value); };

        const inpDef = el('input', 'border rounded p-1 w-14 text-xs');
        inpDef.type = 'number'; inpDef.value = p.temp_def || 0; inpDef.placeholder = 'Déf';
        inpDef.onchange = function() { updateCombatParticipant(char.id, 'temp_def', inpDef.value); };

        ctrl.appendChild(selPos); ctrl.appendChild(selMan); ctrl.appendChild(inpAtt); ctrl.appendChild(inpDef);
        card.appendChild(ctrl);
      } else {
        card.appendChild(el('div', 'text-xs text-stone-600', 'Posture : ' + p.posture + (visible ? ' | Manœuvre : ' + p.manoeuvre : '')));
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
    const box = el('div', 'p-3 bg-amber-50 border border-amber-300 rounded text-sm space-y-1');
    box.appendChild(el('div', 'font-bold', 'Résultat ' + (isInitial ? 'Phase Initiale' : 'Phase Finale') + ' :'));
    box.appendChild(el('div', '', 'Camp A : Attaque ' + res.attA + ' + Dé (' + res.rollA + ') - Déf B (' + res.defB + ') = Score ' + res.scoreA + ' -> ' + res.woundsToB + ' blessure(s) infligée(s) au Camp B'));
    box.appendChild(el('div', '', 'Camp B : Attaque ' + res.attB + ' + Dé (' + res.rollB + ') - Déf A (' + res.defA + ') = Score ' + res.scoreB + ' -> ' + res.woundsToA + ' blessure(s) infligée(s) au Camp A'));
    box.appendChild(el('div', 'text-xs text-stone-700 italic', isInitial ? 'Tour initial : chaque camp répartit les blessures qu’il inflige à l’adversaire.' : 'Tour final : chaque camp répartit entre ses membres les blessures qu’il subit.'));
    if (!isInitial || COMBAT.combat_type === 'escarmouche') {
      box.appendChild(el('div', 'font-bold text-green-800 pt-1', 'Vainqueur : ' + winner + ' (Score de Victoire : ' + Math.abs(res.scoreA - res.scoreB) + ')'));
    }
    resBox.appendChild(box);
  } else {
    resBox.classList.add('hidden');
  }
}

init();
