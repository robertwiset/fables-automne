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
  new Array('play', 'combat', 'manage', 'destiny').forEach(function(t) {
    document.getElementById('tab-' + t).classList.toggle('hidden', t !== tab);
    const btn = document.getElementById('tab-btn-' + t);
    if (btn) {
      btn.className = (t === tab) ? 'bg-amber-700' : '';
      btn.style.background = (t === tab) ? '#92400e' : '#57534e';
      btn.style.color = '#fff';
    }
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
    sb.from('roll_history').select('*').order('created_at', { ascending: false }).limit(500),
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
  renderDestiny();
}

function getEffectiveState(char) {
  const d = char.data;
  const effLvl = char.effective_level || char.level;
  const caracs = Object.assign({}, d.base_caracs);
  if (d.peuple_carac) caracs[d.peuple_carac] = (caracs[d.peuple_carac] || 8) + 1;
  if (d.culture_carac) caracs[d.culture_carac] = (caracs[d.culture_carac] || 8) + 1;

  const lvlUpCaracs = d.level_caracs || {};

  const companions = { suivant: null, familier: null };
  const lvlCompanions = d.level_companions || {};
  Object.keys(lvlCompanions).sort(function(a, b) { return parseInt(a) - parseInt(b); }).forEach(function(lvl) {
    if (parseInt(lvl) <= effLvl) {
      const act = lvlCompanions[lvl];
      if (act.type === 'gain_suivant') companions.suivant = { nom: act.nom || 'Suivant', ameliore: false };
      if (act.type === 'gain_familier') companions.familier = { nom: act.nom || 'Familier', ameliore: false };
      if (act.type === 'upgrade_suivant' && companions.suivant) companions.suivant.ameliore = true;
      if (act.type === 'upgrade_familier' && companions.familier) companions.familier.ameliore = true;
    }
  });


  
  Object.keys(lvlUpCaracs).forEach(function(lvl) {
    if (parseInt(lvl) <= effLvl && lvlUpCaracs[lvl]) {
      caracs[lvlUpCaracs[lvl]] = (caracs[lvlUpCaracs[lvl]] || 8) + 1;
    }
  });

  let talents = (d.talents_lvl1 || new Array()).slice();
  const lvlUpTalents = d.level_talents || {};
  Object.keys(lvlUpTalents).forEach(function(lvl) {
    if (parseInt(lvl) <= effLvl) {
      talents = talents.concat(lvlUpTalents[lvl] || new Array());
    }
  });

  let sorts = (d.sorts || new Array()).slice();
  const lvlUpSorts = d.level_sorts || {};
  Object.keys(lvlUpSorts).forEach(function(lvl) {
    if (parseInt(lvl) <= effLvl) {
      sorts = sorts.concat(lvlUpSorts[lvl] || new Array());
    }
  });

  let talentChoices = Object.assign({}, d.talent_choices_lvl1 || {});
  const lvlUpChoices = d.level_talent_choices || {};
  Object.keys(lvlUpChoices).forEach(function(lvl) {
    if (parseInt(lvl) <= effLvl) {
      Object.keys(lvlUpChoices[lvl] || {}).forEach(function(tKey) {
        talentChoices[tKey] = (talentChoices[tKey] || new Array()).concat(lvlUpChoices[lvl][tKey]);
      });
    }
  });
  if (d.adaptation_milieu) {
    if (!talentChoices['Adaptation']) talentChoices['Adaptation'] = new Array();
    if (!talentChoices['Adaptation'].includes(d.adaptation_milieu)) talentChoices['Adaptation'].push(d.adaptation_milieu);
  }

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

  const inv = d.inventaire || new Array();
  const worn = d.worn || {};
  const equipped = d.equipped || {};
  let totalWeight = 0;
  inv.forEach(function(item) { totalWeight += (item.poids || 0); });

  let armorDef = 0;
  let rawArmorMalusAgi = 0;
  new Array('Tete', 'Torse', 'Bassin', 'BrasDroit', 'BrasGauche', 'Jambes').forEach(function(slot) {
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

  new Array('MainPrincipale', 'MainSecondaire', 'Monture').forEach(function(slot) {
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

  return { companions: companions, caracs: caracs, talents: talents, sorts: sorts, talentChoices: talentChoices, normTalents: normTalents, maxWoundMalus: maxWoundMalus, limbDisabled: limbDisabled, totalWeight: totalWeight, maxWeight: maxWeight, encumbered: encumbered, armorDef: armorDef, armorMalusAgi: armorMalusAgi, emotionObj: emotionObj, fatigue: fatigue, worn: worn, equipped: equipped, inv: inv, blessures: blessures };
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

let PLAY_SHOW_ALL = false;

function togglePlayScope() {
  PLAY_SHOW_ALL = !PLAY_SHOW_ALL;
  const btn = document.getElementById('btn-toggle-play-scope');
  if (btn) btn.textContent = PLAY_SHOW_ALL ? 'Tous les personnages visibles' : 'Mes personnages';
  syncCharacterDropdowns();
  renderPlaySheet();
}

function syncCharacterDropdowns() {
  const myChars = CHARACTERS.filter(function(c) { return c.owner_id === CURRENT_USER.id; });
  const visibleChars = CHARACTERS.filter(function(c) { return c.owner_id === CURRENT_USER.id || c.is_public; });
  const playPool = PLAY_SHOW_ALL ? visibleChars : myChars;

  const activeSel = document.getElementById('active-char-select');
  const prevActive = activeSel.value;
  activeSel.innerHTML = '';
  playPool.forEach(function(c) {
    const isMine = c.owner_id === CURRENT_USER.id;
    const ownerTag = isMine ? (c.is_public ? '' : ' [Masqué]') : (' — ' + (c.owner_email || 'Joueur'));
    const opt = el('option', '', c.name + ' (Niv.' + c.effective_level + ')' + ownerTag);
    opt.value = c.id;
    activeSel.appendChild(opt);
  });
  if (playPool.some(function(c) { return c.id === prevActive; })) activeSel.value = prevActive;

  const sheetSel = document.getElementById('sheet-char-select');
  const prevSheet = sheetSel.value;
  sheetSel.innerHTML = '';
  myChars.forEach(function(c) {
    const opt = el('option', '', c.name + ' (Niv.' + c.effective_level + ')' + (c.is_public ? '' : ' [Masqué]'));
    opt.value = c.id;
    sheetSel.appendChild(opt);
  });
  if (myChars.some(function(c) { return c.id === prevSheet; })) sheetSel.value = prevSheet;

  const combatSel = document.getElementById('combat-add-char');
  combatSel.innerHTML = '';
  visibleChars.forEach(function(c) {
    const isMine = c.owner_id === CURRENT_USER.id;
    const tag = isMine ? (c.is_public ? '' : ' [Masqué]') : (' — ' + (c.owner_email || 'Joueur'));
    const opt = el('option', '', c.name + tag);
    opt.value = c.id;
    combatSel.appendChild(opt);
  });

}


function onSelectPlayChar() {
  ACTIVE_RITUELS = getDefaultRituelState();
  renderPlaySheet();
}

function renderPlaySheet() {
  const savedScrollY = window.scrollY;
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
  document.getElementById('play-portrait').src = char.data.portrait || 'data:image/svg+xml;utf8,<svg xmlns="http://w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%23d6d3d1"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="24" fill="%2357534e">?</text></svg>';
  document.getElementById('play-char-badge').textContent = 'Niv. ' + char.effective_level + (char.effective_level !== char.level ? ' / ' + char.level : '');
  document.getElementById('play-char-subtitle').textContent = char.data.peuple + ' • ' + char.data.culture + ' • ' + char.data.classe + ' • Désir : ' + char.data.desir;

  let compTxt = '';
  if (st.companions.suivant) compTxt += ' | Suivant : ' + st.companions.suivant.nom + (st.companions.suivant.ameliore ? ' (Amélioré)' : '');
  if (st.companions.familier) compTxt += ' | Familier : ' + st.companions.familier.nom + (st.companions.familier.ameliore ? ' (Amélioré)' : '');
  document.getElementById('play-char-subtitle').textContent += compTxt;

  
  statusDiv.textContent = 'Fatigue : ' + st.fatigue + '/' + st.caracs['Santé'] + ' | Émotion : ' + (char.data.emotion || 'Aucune') + ' | Blessure max : -' + st.maxWoundMalus + ' | Armure Agi : -' + st.armorMalusAgi + (st.encumbered ? ' | ENCOMBRÉ !' : '');

  const isOwner = char.owner_id === CURRENT_USER.id;

  RULES.caracteristiques.forEach(function(cName) {
    const val = st.caracs[cName] || 10;
    const mod = val - 10;
    const sign = mod >= 0 ? '+' : '';
    const col = el('div', 'border bg-stone-50 space-y-2');
    const cBtn = el('button', 'bg-amber-800', cName + ' : ' + val + ' (' + sign + mod + ')');
    cBtn.style.width = '100%';
    cBtn.disabled = !isOwner;
    if (isOwner) cBtn.onclick = function() { rollTest(cName, true); };
    col.appendChild(cBtn);

    const listWrap = el('div', 'space-y-2');
    RULES.competences.filter(function(cp) { return cp.carac === cName; }).forEach(function(comp) {
      const sMod = computeSkillModifier(char, st, comp).total;
      const sSign = sMod >= 0 ? '+' : '';
      const sBtn = el('button', 'flex justify-between', '');
      sBtn.style.width = '100%';
      sBtn.style.background = '#fff';
      sBtn.style.fontSize = '12px';
      sBtn.disabled = !isOwner;
      sBtn.appendChild(el('span', '', comp.nom));
      sBtn.appendChild(el('strong', '', sSign + sMod));
      if (isOwner) sBtn.onclick = function() { rollTest(comp.nom, false); };
      listWrap.appendChild(sBtn);
    });
    col.appendChild(listWrap);
    colsDiv.appendChild(col);
  });

  renderHealthBlock(char, st, healthMount, isOwner);
  renderMagicBlock(char, st, magicMount, isOwner);
  window.scrollTo(0, savedScrollY);
}


function getDefaultRituelState() {
  return {
    formule: false, incant_time: false, invoc_name: false,
    gestuelle: false, danse_music: false, sol_time: false, sol_costume: false,
    inscription: false, horo_birth: false, mom_time: false, mom_astro: false,
    catalyseur: false, consec_talisman: false, talisman_metal: 0,
    ingredient: false, potion_tier: 0,
    transe: false, transe_conc: false, ferveur_lvl: 0, med_time: false, med_daily: false, ext_fumi: false, ext_psycho: false, sacrifice_lvl: 0,
    voeu_hum_1: false, voeu_hum_2: false,
    voeu_pac_1: false, voeu_pac_2: false,
    voeu_pau_1: false, voeu_pau_2: false,
    voeu_pur_1: false, voeu_pur_2: false
  };
}

function ensureRituelState() {
  if (!ACTIVE_RITUELS || typeof ACTIVE_RITUELS.formule !== 'boolean') {
    ACTIVE_RITUELS = getDefaultRituelState();
  }
  return ACTIVE_RITUELS;
}

function computeMagicPower(char, st, spellObj) {
  const r = ensureRituelState();
  let parts = new Array();
  let extraTimeDice = 0;
  let stealthMalus = 0;

  let bonusCon = Math.max(0, (st.caracs['Connaissance'] || 10) - 10);
  let bonusPre = Math.max(0, (st.caracs['Présence'] || 10) - 10);
  if (st.talents.includes('Esotérisme') && bonusCon > 0) {
    bonusCon *= 2;
    parts.push('Connaissance x2 (Ésotérisme) +' + bonusCon);
  } else if (bonusCon > 0) {
    parts.push('Connaissance +' + bonusCon);
  }
  if (st.talents.includes('Mysticisme') && bonusPre > 0) {
    bonusPre *= 2;
    parts.push('Présence x2 (Mysticisme) +' + bonusPre);
  } else if (bonusPre > 0) {
    parts.push('Présence +' + bonusPre);
  }
  let base = bonusCon + bonusPre;
  if (base === 0) parts.push('Base +0');

  let total = base;
  if (st.talents.includes('Grand art')) { total += 1; parts.push('Grand art +1'); }

  let noSpellFatigue = false;
  if (spellObj) {
    const affVoies = (st.talentChoices && st.talentChoices['Affinité magique']) ? st.talentChoices['Affinité magique'] : new Array();
    if (st.talents.includes('Affinité magique') && affVoies.includes(spellObj.voie)) {
      total += 2;
      parts.push('Affinité magique (' + spellObj.voie + ') +2');
    }
    const specSorts = (st.talentChoices && st.talentChoices['Spécialisation magique']) ? st.talentChoices['Spécialisation magique'] : new Array();
    if (st.talents.includes('Spécialisation magique') && specSorts.includes(spellObj.nom)) {
      total += 3;
      parts.push('Spécialisation magique (' + spellObj.nom + ') +3');
    }
    const entSorts = (st.talentChoices && st.talentChoices['Entraînement magique']) ? st.talentChoices['Entraînement magique'] : new Array();
    if (st.talents.includes('Entraînement magique') && entSorts.includes(spellObj.nom)) {
      noSpellFatigue = true;
      parts.push('Entraînement magique (sans fatigue 10m)');
    }
  }

  const overtRituelActive = r.formule || r.gestuelle || r.inscription || r.ingredient;
  if (st.talents.includes('Subtilité') && !overtRituelActive) {
    total += 4; parts.push('Subtilité +4');
  }

  if (r.formule) {
    total += 1; parts.push('Formule +1'); stealthMalus += 1;
    if (st.talents.includes('Incantation')) {
      if (r.incant_time) { total += 1; extraTimeDice += 1; parts.push('Incantation (1d6×10m) +1'); }
      if (st.talents.includes('Musique')) { total += 1; parts.push('Incantation (Musique) +1'); }
    }
    if (st.talents.includes('Invocation')) {
      if (r.invoc_name) { total += 1; parts.push('Invocation (Nom véritable) +1'); }
      const hasDeadLang = st.talents.includes('Érudition') || st.talents.includes('Erudition') || st.talents.includes('Linguistique') || st.talents.includes('Arcane');
      if (hasDeadLang) { total += 1; parts.push('Invocation (Langue morte) +1'); }
    }
  }

  let solBonus = 0;
  if (r.gestuelle) {
    total += 1; parts.push('Gestuelle +1'); stealthMalus += 1;
    if (st.talents.includes('Danse sacrée')) {
      if (r.danse_music) { total += 1; parts.push('Danse sacrée (Musique) +1'); }
      if ((st.caracs['Agilité'] || 8) >= 11) { total += 1; parts.push('Danse sacrée (Agi ≥ 11) +1'); }
    }
    if (st.talents.includes('Solennité')) {
      if (r.sol_time) { solBonus += 1; extraTimeDice += 1; parts.push('Solennité (1d6×10m) +1'); }
      if (r.sol_costume) { solBonus += 1; parts.push('Solennité (Costume 5 écus) +1'); }
      total += solBonus;
    }
  }

  if (r.inscription) {
    total += 1; parts.push('Inscription +1'); stealthMalus += 1;
    if (st.talents.includes('Horoscope')) {
      if (r.horo_birth) { total += 1; parts.push('Horoscope (Date naissance) +1'); }
      if (st.talents.includes('Ingénierie')) { total += 1; parts.push('Horoscope (Ingénierie) +1'); }
    }
    if (st.talents.includes('Momentum')) {
      if (r.mom_time) { total += 1; extraTimeDice += 1; parts.push('Momentum (1d6×10m) +1'); }
      if (r.mom_astro) { total += 1; parts.push('Momentum (Astrolabe 5 écus) +1'); }
    }
  }

  if (r.catalyseur) {
    total += 1; parts.push('Catalyseur +1');
    if (st.talents.includes('Consécration') && r.consec_talisman && solBonus > 0) {
      total += solBonus; parts.push('Consécration (Solennité doublée) +' + solBonus);
    }
    if (st.talents.includes('Talisman') && parseInt(r.talisman_metal) > 0) {
      const tVal = parseInt(r.talisman_metal);
      total += tVal; parts.push('Talisman +' + tVal);
    }
  }

  if (r.ingredient) {
    total += 1; parts.push('Ingrédient +1');
    const pVal = parseInt(r.potion_tier) || 0;
    if (pVal > 0) {
      total += pVal; parts.push('Préparation ingérée +' + pVal);
    }
  }

  if (r.transe) {
    if (r.transe_conc) {
      total += 1; parts.push('Transe (Concentration) +1');
      if (st.talents.includes('Ferveur') && parseInt(r.ferveur_lvl) > 0) {
        const fVal = parseInt(r.ferveur_lvl) * 2;
        total += fVal; parts.push('Ferveur (' + r.ferveur_lvl + ' Fat.) +' + fVal);
      }
      if (st.talents.includes('Méditation')) {
        if (r.med_time) { total += 1; extraTimeDice += 1; parts.push('Méditation (1d6×10m) +1'); }
        if (r.med_daily) { total += 1; parts.push('Méditation quotidienne +1'); }
      }
    }
    if (st.talents.includes('Extase')) {
      if (r.ext_fumi) { total += 1; parts.push('Extase (Fumigation) +1'); }
      if (r.ext_psycho) { total += 1; parts.push('Extase (Psychotrope) +1'); }
    }
    if (st.talents.includes('Sacrifice') && parseInt(r.sacrifice_lvl) > 0) {
      const sVal = parseInt(r.sacrifice_lvl);
      total += sVal; parts.push('Sacrifice +' + sVal);
    }
  }

  if (st.talents.includes('Humilité')) {
    if (r.voeu_hum_1) { total += 1; parts.push('Humilité (Sans office ni serviteur) +1'); }
    if (r.voeu_hum_2) { total += 1; parts.push('Humilité (Sert un maître/institution) +1'); }
  }
  if (st.talents.includes('Pacifisme')) {
    if (r.voeu_pac_1) { total += 1; parts.push('Pacifisme (Sans arme/armure, Repli) +1'); }
    if (r.voeu_pac_2) { total += 1; parts.push('Pacifisme (Aucun sort dangereux) +1'); }
  }
  if (st.talents.includes('Pauvreté')) {
    if (r.voeu_pau_1) { total += 1; parts.push('Pauvreté (Ne possède que le transporté) +1'); }
    if (r.voeu_pau_2) { total += 1; parts.push('Pauvreté (Max 1 écu de biens) +1'); }
  }
  if (st.talents.includes('Pureté')) {
    if (r.voeu_pur_1) { total += 1; parts.push('Pureté (Toujours sincère) +1'); }
    if (r.voeu_pur_2) { total += 1; parts.push('Pureté (Abstinence) +1'); }
  }

  if (st.fatigue > 0) { total -= st.fatigue; parts.push('Fatigue -' + st.fatigue); }
  if (st.emotionObj.comp !== 0) { total += st.emotionObj.comp; parts.push('Émotion ' + st.emotionObj.comp); }
  return { total: total, parts: parts, extraTimeDice: extraTimeDice, stealthMalus: stealthMalus, noSpellFatigue: noSpellFatigue };
}




function makeRituelChk(labelText, stateKey, disabled) {
  const r = ensureRituelState();
  const lbl = el('label', 'flex');
  lbl.style.fontSize = '12px';
  if (disabled) lbl.style.opacity = '0.5';
  const chk = el('input', '');
  chk.type = 'checkbox';
  chk.checked = Boolean(r[stateKey]);
  chk.disabled = Boolean(disabled);
  chk.onchange = function() { r[stateKey] = chk.checked; renderPlaySheet(); };
  lbl.appendChild(chk);
  lbl.appendChild(document.createTextNode(labelText));
  return lbl;
}

function renderMagicBlock(char, st, mount, isOwner) {
  const r = ensureRituelState();
  const ritBox = el('div', 'bg-purple-50 border space-y-2');
  ritBox.appendChild(el('strong', '', 'Rituels & Préparations magiques :'));

  const addRituelCard = function(title, mainKey, buildSubFn) {
    const card = el('div', 'border space-y-2');
    card.style.background = '#fff';
    card.appendChild(makeRituelChk(title, mainKey, false));
    if (r[mainKey] && buildSubFn) {
      const sub = el('div', 'space-y-2');
      sub.style.paddingLeft = '18px';
      sub.style.borderLeft = '2px solid #d8b4fe';
      buildSubFn(sub);
      card.appendChild(sub);
    }
    ritBox.appendChild(card);
  };

  addRituelCard('Formule (+1 de base)', 'formule', function(sub) {
    if (st.talents.includes('Incantation')) {
      sub.appendChild(makeRituelChk('Incantation : Prendre 1d6 × 10 min supplémentaires (+1)', 'incant_time', false));
      const hasMus = st.talents.includes('Musique');
      const bMus = el('div', '', hasMus ? '✓ Bonus automatique Incantation : Talent Musique (+1)' : '• Incantation : Talent Musique non acquis (+0)');
      bMus.style.fontSize = '11px'; bMus.style.color = hasMus ? '#047857' : '#78716c';
      sub.appendChild(bMus);
    }
    if (st.talents.includes('Invocation')) {
      sub.appendChild(makeRituelChk('Invocation : Connaître le nom véritable de la cible (+1)', 'invoc_name', false));
      const hasDead = st.talents.includes('Érudition') || st.talents.includes('Erudition') || st.talents.includes('Linguistique') || st.talents.includes('Arcane');
      const bDead = el('div', '', hasDead ? '✓ Bonus automatique Invocation : Langue morte maîtrisée (+1)' : '• Invocation : Aucune langue morte maîtrisée (+0)');
      bDead.style.fontSize = '11px'; bDead.style.color = hasDead ? '#047857' : '#78716c';
      sub.appendChild(bDead);
    }
  });

  addRituelCard('Gestuelle (+1 de base)', 'gestuelle', function(sub) {
    if (st.talents.includes('Danse sacrée')) {
      sub.appendChild(makeRituelChk('Danse sacrée : Musique rythmée (+1)', 'danse_music', false));
      const hasAgi = (st.caracs['Agilité'] || 8) >= 11;
      const bAgi = el('div', '', hasAgi ? '✓ Bonus automatique Danse sacrée : Agilité ≥ 11 (+1)' : '• Danse sacrée : Agilité actuelle < 11 (+0)');
      bAgi.style.fontSize = '11px'; bAgi.style.color = hasAgi ? '#047857' : '#78716c';
      sub.appendChild(bAgi);
    }
    if (st.talents.includes('Solennité')) {
      sub.appendChild(makeRituelChk('Solennité : Prendre 1d6 × 10 min supplémentaires (+1)', 'sol_time', false));
      sub.appendChild(makeRituelChk('Solennité : Costume d’une valeur de 5 écus (+1)', 'sol_costume', false));
    }
  });

  addRituelCard('Inscription (+1 de base)', 'inscription', function(sub) {
    if (st.talents.includes('Horoscope')) {
      sub.appendChild(makeRituelChk('Horoscope : Connaître la date de naissance (+1)', 'horo_birth', false));
      const hasIng = st.talents.includes('Ingénierie');
      const bIng = el('div', '', hasIng ? '✓ Bonus automatique Horoscope : Talent Ingénierie (+1)' : '• Horoscope : Talent Ingénierie non acquis (+0)');
      bIng.style.fontSize = '11px'; bIng.style.color = hasIng ? '#047857' : '#78716c';
      sub.appendChild(bIng);
    }
    if (st.talents.includes('Momentum')) {
      sub.appendChild(makeRituelChk('Momentum : Prendre 1d6 × 10 min supplémentaires (+1)', 'mom_time', false));
      sub.appendChild(makeRituelChk('Momentum : Astrolabe d’une valeur de 5 écus (+1)', 'mom_astro', false));
    }
  });

  addRituelCard('Catalyseur (+1 de base)', 'catalyseur', function(sub) {
    if (st.talents.includes('Consécration')) {
      sub.appendChild(makeRituelChk('Consécration : Talisman gravé/préparé (double le bonus de Solennité)', 'consec_talisman', false));
    }
    if (st.talents.includes('Talisman')) {
      const rowT = el('div', 'flex');
      rowT.style.fontSize = '12px';
      rowT.appendChild(el('span', '', 'Talisman :'));
      const selT = el('select', '');
      new Array({ v: 0, l: 'Aucun (0)' }, { v: 1, l: 'Métal rare (+1)' }, { v: 2, l: 'Métal rare dans talisman (+2)' }).forEach(function(opt) {
        const o = el('option', '', opt.l); o.value = opt.v;
        if (parseInt(r.talisman_metal) === opt.v) o.selected = true;
        selT.appendChild(o);
      });
      selT.onchange = function() { r.talisman_metal = parseInt(selT.value); renderPlaySheet(); };
      rowT.appendChild(selT);
      sub.appendChild(rowT);
    }
  });

  addRituelCard('Ingrédient (+1 de base)', 'ingredient', function(sub) {
    const hasPot = st.talents.includes('Potion');
    const hasAlc = st.talents.includes('Alchimie');
    const hasEli = st.talents.includes('Elixir');
    if (hasPot || hasAlc || hasEli) {
      const rowP = el('div', 'flex');
      rowP.style.fontSize = '12px';
      rowP.appendChild(el('span', '', 'Préparation :'));
      const selP = el('select', '');
      const opts = new Array({ v: 0, l: 'Aucune (0)' });
      if (hasPot) opts.push({ v: 2, l: 'Potion 1 ingrédient (+2)' });
      if (hasAlc) opts.push({ v: 3, l: 'Potion 2 ingrédients (+3)' });
      if (hasEli) opts.push({ v: 4, l: 'Potion 4 ingrédients (+4)' });
      if (!opts.some(function(x) { return x.v === parseInt(r.potion_tier); })) r.potion_tier = 0;
      opts.forEach(function(opt) {
        const o = el('option', '', opt.l); o.value = opt.v;
        if (parseInt(r.potion_tier) === opt.v) o.selected = true;
        selP.appendChild(o);
      });
      selP.onchange = function() { r.potion_tier = parseInt(selP.value); renderPlaySheet(); };
      rowP.appendChild(selP);
      sub.appendChild(rowP);
    }
  });

  addRituelCard('Transe (+1 si Concentration réussie)', 'transe', function(sub) {
    sub.appendChild(makeRituelChk('Concentration réussie (+1)', 'transe_conc', false));
    if (st.talents.includes('Ferveur')) {
      const maxFatGain = Math.max(0, (st.caracs['Santé'] || 10) - st.fatigue);
      if (parseInt(r.ferveur_lvl) > maxFatGain) r.ferveur_lvl = maxFatGain;
      const rowF = el('div', 'flex');
      rowF.style.fontSize = '12px';
      if (!r.transe_conc) rowF.style.opacity = '0.5';
      rowF.appendChild(el('span', '', 'Ferveur (Fatigue dépensée : ' + r.ferveur_lvl + ' / ' + maxFatGain + ' → +' + (r.ferveur_lvl * 2) + ') :'));
      const rng = el('input', '');
      rng.type = 'range'; rng.min = 0; rng.max = maxFatGain; rng.value = r.ferveur_lvl || 0;
      rng.disabled = !r.transe_conc || maxFatGain === 0;
      rng.oninput = function() { r.ferveur_lvl = parseInt(rng.value); renderPlaySheet(); };
      rowF.appendChild(rng);
      sub.appendChild(rowF);
    }
    if (st.talents.includes('Méditation')) {
      sub.appendChild(makeRituelChk('Méditation : Prendre 1d6 × 10 min supplémentaires (+1)', 'med_time', !r.transe_conc));
      sub.appendChild(makeRituelChk('Méditation quotidienne (+1)', 'med_daily', !r.transe_conc));
    }
    if (st.talents.includes('Extase')) {
      sub.appendChild(makeRituelChk('Extase : Fumigation (+1)', 'ext_fumi', false));
      sub.appendChild(makeRituelChk('Extase : Psychotrope hallucinogène (+1)', 'ext_psycho', false));
    }
    if (st.talents.includes('Sacrifice')) {
      const rowS = el('div', 'flex');
      rowS.style.fontSize = '12px';
      rowS.appendChild(el('span', '', 'Sacrifice :'));
      const selS = el('select', '');
      new Array({ v: 0, l: 'Aucun (0)' }, { v: 1, l: 'Petit sacrifice (+1)' }, { v: 2, l: 'Grand sacrifice (+2)' }).forEach(function(opt) {
        const o = el('option', '', opt.l); o.value = opt.v;
        if (parseInt(r.sacrifice_lvl) === opt.v) o.selected = true;
        selS.appendChild(o);
      });
      selS.onchange = function() { r.sacrifice_lvl = parseInt(selS.value); renderPlaySheet(); };
      rowS.appendChild(selS);
      sub.appendChild(rowS);
    }
  });

  mount.appendChild(ritBox);

  const vowsDefs = new Array(
    {
      talent: 'Humilité',
      c1: 'Pas d’office à responsabilité ni de serviteur (+1)', k1: 'voeu_hum_1',
      c2: 'Sert un maître ou une institution (+1)', k2: 'voeu_hum_2'
    },
    {
      talent: 'Pacifisme',
      c1: 'Ni arme ni armure, et toujours posture Repli au combat (+1)', k1: 'voeu_pac_1',
      c2: 'Ne lance jamais un sort dangereux sur une cible (+1)', k2: 'voeu_pac_2'
    },
    {
      talent: 'Pauvreté',
      c1: 'Ne possède que ce qu’il transporte (+1)', k1: 'voeu_pau_1',
      c2: 'Ne transporte pas plus d’un écu de biens hors objets de culte (+1)', k2: 'voeu_pau_2'
    },
    {
      talent: 'Pureté',
      c1: 'Se montre toujours sincère (+1)', k1: 'voeu_pur_1',
      c2: 'Aucune relation sexuelle, psychotrope ou aliment carné (+1)', k2: 'voeu_pur_2'
    }
  );
  const ownedVows = vowsDefs.filter(function(v) { return st.talents.includes(v.talent); });
  if (ownedVows.length > 0) {
    const vowBox = el('div', 'bg-amber-50 border space-y-2');
    vowBox.appendChild(el('strong', '', 'Vœux du mage :'));
    ownedVows.forEach(function(v) {
      const vCard = el('div', 'border space-y-2');
      vCard.style.background = '#fff';
      vCard.appendChild(el('strong', '', 'Vœu : ' + v.talent));
      vCard.appendChild(makeRituelChk(v.c1, v.k1, false));
      vCard.appendChild(makeRituelChk(v.c2, v.k2, false));
      vowBox.appendChild(vCard);
    });
    mount.appendChild(vowBox);
  }

  const pow = computeMagicPower(char, st, null);
  const summary = el('div', 'border bg-stone-50');
  summary.style.fontSize = '11px';
  let sumTxt = 'Détail Pouvoir de base : ' + pow.parts.join(', ');
  if (pow.extraTimeDice > 0) sumTxt += ' | Temps supplémentaire : ' + pow.extraTimeDice + 'd6 × 10 min';
  if (pow.stealthMalus > 0) sumTxt += ' | Discrétion : -1';
  summary.textContent = sumTxt;
  mount.appendChild(summary);

  const pSign = pow.total >= 0 ? '+' : '';
  const pBtn = el('button', 'bg-purple-700', 'Test de Pouvoir brut (1d20 ' + pSign + pow.total + ')');
  pBtn.style.width = '100%';
  pBtn.disabled = !isOwner;
if (isOwner) pBtn.onclick = function() { rollMagicTest(char, 'Pouvoir brut', pow); };
mount.appendChild(pBtn);
const knownSpells = st.sorts || new Array();
const spBox = el('div', 'border space-y-2');
spBox.appendChild(el('strong', '', 'Sorts connus (' + knownSpells.length + ') :'));
if (knownSpells.length === 0) {
spBox.appendChild(el('div', '', 'Aucun sort appris (géré lors du passage de niveau).'));
} else {
const spGrid = el('div', 'grid grid-cols-2');
knownSpells.forEach(function(sp) {
const spPow = computeMagicPower(char, st, sp);
const spSign = spPow.total >= 0 ? '+' : '';
const fatTag = spPow.noSpellFatigue ? ' [Sans fatigue]' : '';
const bCast = el('button', 'border bg-stone-50', sp.nom + ' (' + sp.voie + ') — 1d20 ' + spSign + spPow.total + fatTag);
bCast.style.textAlign = 'left';
bCast.disabled = !isOwner;
if (isOwner) bCast.onclick = function() { rollMagicTest(char, sp.nom + ' (' + sp.voie + ')', spPow); };
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
  const manageSheet = document.getElementById('manage-sheet-container');
  const sheetSelect = document.getElementById('sheet-char-select');
  const isOpening = wrap.classList.contains('hidden');
  if (isOpening) {
    resetCreationForm();
    wrap.classList.remove('hidden');
    if (manageSheet) manageSheet.classList.add('hidden');
    if (sheetSelect) sheetSelect.disabled = true;
  } else {
    cancelCreation();
  }
}

function cancelCreation() {
  resetCreationForm();
  document.getElementById('create-form-wrapper').classList.add('hidden');
  const manageSheet = document.getElementById('manage-sheet-container');
  const sheetSelect = document.getElementById('sheet-char-select');
  if (manageSheet) manageSheet.classList.remove('hidden');
  if (sheetSelect) sheetSelect.disabled = false;
}



function resetCreationForm() {
  CREATE_CARACS = { Force: 8, Agilité: 8, Santé: 8, Connaissance: 8, Perception: 8, Présence: 8 };
  CREATE_PORTRAIT = '';
  if (RULES) initCreationForm();
}


function handlePortraitUpload(input) {
  const file = input.files.item(0);
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
  prevImg.src = 'data:image/svg+xml;utf8,<svg xmlns="http://w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%23d6d3d1"/></svg>';
 
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
    box.style.padding = '6px 4px';
    box.appendChild(el('div', '', c));
    const ctrl = el('div', 'flex');
    ctrl.style.justifyContent = 'center';
    ctrl.style.flexWrap = 'nowrap';
    ctrl.style.gap = '4px';
    ctrl.style.marginTop = '4px';
    const bMinus = el('button', '', '-');
    bMinus.style.padding = '2px 7px';
    bMinus.onclick = function() { changeCreateCarac(c, -1); };
    const valSpan = el('strong', '', '8');
    valSpan.id = 'cc-' + c;
    valSpan.style.display = 'inline-block';
    valSpan.style.minWidth = '20px';
    const bPlus = el('button', '', '+');
    bPlus.style.padding = '2px 7px';
    bPlus.onclick = function() { changeCreateCarac(c, 1); };
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

function getChoicesForTalent(tName, acquiredChoicesMap, knownSortsList) {
  const t = RULES.talents.find(function(x) { return x.nom === tName; });
  if (!t) return null;
  const chMap = acquiredChoicesMap || {};
  const sortsArr = knownSortsList || new Array();
  if (tName === 'Initiation magique') {
    return (RULES.voies_magiques || new Array()).map(function(v) { return v.voie; });
  }
  if (tName === 'Apprentissage magique') {
    return (chMap['Initiation magique'] || new Array()).slice();
  }
  if (tName === 'Maîtrise magique') {
    return (chMap['Apprentissage magique'] || new Array()).slice();
  }
  if (tName === 'Maîtrise artisanale') {
    return (chMap['Artisanat'] || new Array()).slice();
  }
  if (tName === 'Affinité magique') {
    const initV = chMap['Initiation magique'] || new Array();
    const sortV = sortsArr.map(function(s) { return s.voie; });
    const merged = new Array();
    initV.concat(sortV).forEach(function(v) { if (v && !merged.includes(v)) merged.push(v); });
    return merged;
  }
  if (tName === 'Spécialisation magique' || tName === 'Entraînement magique') {
    const names = new Array();
    sortsArr.forEach(function(s) { if (s && s.nom && !names.includes(s.nom)) names.push(s.nom); });
    return names;
  }
  if (t.choix && t.choix.length > 0) return t.choix;
  return null;
}

function isTalentEligible(talentName, caracs, acquiredTalents, targetLevel, acquiredChoicesMap, knownSortsList) {
  const lvl = targetLevel || 1;
  const t = RULES.talents.find(function(x) { return x.nom === talentName; });
  if (!t) return false;
  if (t.niveau_min && t.niveau_min > lvl) return false;

  const count = acquiredTalents.filter(function(x) { return x === talentName; }).length;
  const chMap = acquiredChoicesMap || {};
  const choicesList = getChoicesForTalent(talentName, chMap, knownSortsList);
  const allowMulti = Boolean(t.cumulable || choicesList);
  if (!allowMulti && count >= 1) return false;
  if (t.max_prises && count >= t.max_prises) return false;

  if (choicesList !== null) {
    const usedForThis = chMap[talentName] || new Array();
    const availForThis = choicesList.filter(function(ch) { return !usedForThis.includes(ch); });
    if (availForThis.length === 0) return false;
  }

  const reqC = t.caracs || {};
  for (const c of Object.keys(reqC)) {
    if ((caracs[c] || 0) < reqC[c]) return false;
  }
  const reqT = t.talents || new Array();
  for (let i = 0; i < reqT.length; i++) {
    if (!acquiredTalents.includes(reqT.at(i))) return false;
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
const manageSheet = document.getElementById('manage-sheet-container');
const sheetSelect = document.getElementById('sheet-char-select');
if (manageSheet) manageSheet.classList.remove('hidden');
if (sheetSelect) sheetSelect.disabled = false;

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

    const bEditCareer = el('button', 'bg-blue-700', CAREER_EDIT_CHAR_ID === char.id ? 'Fermer l’édition' : 'Éditer le plan de carrière');
    bEditCareer.onclick = function() { toggleCareerEdit(char); };
    ctrl.insertBefore(bEditCareer, ctrl.firstChild);

    
    header.appendChild(ctrl);
  }
  container.appendChild(header);

  if (isOwner && CAREER_EDIT_CHAR_ID === char.id) {
    renderCareerEditor(char, container);
    return;
  }

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




function formatChoicesMap(cMap) {
if (!cMap) return '';
const parts = [];
Object.keys(cMap).forEach(function(t) {
if (cMap[t] && cMap[t].length > 0) parts.push(t + ' : ' + cMap[t].join(', '));
});
return parts.length > 0 ? ' [' + parts.join(' ; ') + ']' : '';
}

function getSpellSlotsForDraft(draft) {
  let slots = new Array();
  const inspect = function(t, voie) {
    if (t === 'Initiation magique' && voie) {
      slots.push({ label: 'Initiation magique (' + voie + ') — Sort 1/1', voie: voie });
    }
    if (t === 'Apprentissage magique' && voie) {
      slots.push({ label: 'Apprentissage magique (' + voie + ') — Sort 1/2', voie: voie });
      slots.push({ label: 'Apprentissage magique (' + voie + ') — Sort 2/2', voie: voie });
    }
    if (t === 'Maîtrise magique' && voie) {
      slots.push({ label: 'Maîtrise magique (' + voie + ') — Sort 1/2', voie: voie });
      slots.push({ label: 'Maîtrise magique (' + voie + ') — Sort 2/2', voie: voie });
    }
  };
  inspect(draft.t1, draft.t1Choice);
  inspect(draft.t2, draft.t2Choice);
  inspect(draft.te, draft.teChoice);
  return slots;
}

let LVL_DRAFT = { charId: null, carac: '', compAction: '', compName: '', t1: '', t1Choice: '', t2: '', t2Choice: '', te: '', teChoice: '', spells: new Array() };

function renderLevelUpBox(char, container) {
  const nextLvl = char.level + 1;
  if (LVL_DRAFT.charId !== char.id) {
    LVL_DRAFT = { charId: char.id, carac: '', compAction: '', compName: '', t1: '', t1Choice: '', t2: '', t2Choice: '', te: '', teChoice: '', spells: new Array() };
  }

  const fullChar = Object.assign({}, char, { effective_level: char.level });
  const baseSt = getEffectiveState(fullChar);
  const rawCaracs = Object.assign({}, baseSt.caracs);
  rawCaracs['Agilité'] += baseSt.armorMalusAgi;
  const baseChoicesMap = baseSt.talentChoices || {};

  const isPalier5 = (nextLvl % 5 === 0);
  let prevPalierCarac = '';
  for (let l = nextLvl - 5; l >= 5; l -= 5) {
    if ((char.data.level_caracs || {})[l]) { prevPalierCarac = char.data.level_caracs[l]; break; }
  }
  const availCaracs = RULES.caracteristiques.filter(function(c) { return c !== prevPalierCarac; });

  const allTalentsSoFar = baseSt.talents.concat(new Array(LVL_DRAFT.t1, LVL_DRAFT.t2, LVL_DRAFT.te).filter(Boolean));
  const hasPrestige = allTalentsSoFar.includes('Prestige');
  const hasFamilier = allTalentsSoFar.includes('Familier');
  const honneurCount = allTalentsSoFar.filter(function(t) { return t === 'Honneur'; }).length;
  const upgradedCount = (baseSt.companions.suivant && baseSt.companions.suivant.ameliore ? 1 : 0) + (baseSt.companions.familier && baseSt.companions.familier.ameliore ? 1 : 0);

  const compOptions = new Array();
  if (isPalier5) {
    if (hasPrestige && !baseSt.companions.suivant) compOptions.push({ val: 'gain_suivant', label: 'Renoncer au +1 Carac → Obtenir un Suivant (Prestige)' });
    if (hasFamilier && !baseSt.companions.familier) compOptions.push({ val: 'gain_familier', label: 'Renoncer au +1 Carac → Obtenir un Familier (Familier)' });
    if (honneurCount > upgradedCount) {
      if (baseSt.companions.suivant && !baseSt.companions.suivant.ameliore) compOptions.push({ val: 'upgrade_suivant', label: 'Renoncer au +1 Carac → Améliorer le Suivant (Honneur)' });
      if (baseSt.companions.familier && !baseSt.companions.familier.ameliore) compOptions.push({ val: 'upgrade_familier', label: 'Renoncer au +1 Carac → Améliorer le Familier (Honneur)' });
    }
  }

  if (LVL_DRAFT.compAction && !compOptions.some(function(o) { return o.val === LVL_DRAFT.compAction; })) LVL_DRAFT.compAction = '';
  if (LVL_DRAFT.compAction) LVL_DRAFT.carac = '';
  if (isPalier5 && !LVL_DRAFT.compAction && !availCaracs.includes(LVL_DRAFT.carac)) LVL_DRAFT.carac = '';
  if (isPalier5 && !LVL_DRAFT.compAction && LVL_DRAFT.carac) rawCaracs[LVL_DRAFT.carac] += 1;

  const hasEpique = new Array(15, 18, 21, 24, 27, 30).includes(nextLvl);

  const buildChoicesMap = function(excludeSlot) {
    const map = {};
    Object.keys(baseChoicesMap).forEach(function(k) { map[k] = baseChoicesMap[k].slice(); });
    const add = function(t, ch) {
      if (!t || !ch) return;
      if (!map[t]) map[t] = new Array();
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

  if (isPalier5) {
    const cDiv = el('div', 'space-y-2');
    cDiv.appendChild(el('div', '', 'Bonus de palier (Niveau ' + nextLvl + ') :'));
    const selC = el('select', ''); selC.style.width = '100%';
    const o0 = el('option', '', '— Choisir +1 Caractéristique ou Compagnon —'); o0.value = ''; selC.appendChild(o0);

    availCaracs.forEach(function(c) {
      const o = el('option', '', '+1 ' + c + ' (' + (rawCaracs[c] - (LVL_DRAFT.carac === c ? 1 : 0)) + ' -> ' + (rawCaracs[c] + (LVL_DRAFT.carac === c ? 0 : 1)) + ')');
      o.value = 'carac:' + c;
      if (!LVL_DRAFT.compAction && LVL_DRAFT.carac === c) o.selected = true;
      selC.appendChild(o);
    });

    compOptions.forEach(function(opt) {
      const o = el('option', '', opt.label);
      o.value = 'comp:' + opt.val;
      if (LVL_DRAFT.compAction === opt.val) o.selected = true;
      selC.appendChild(o);
    });

    selC.onchange = function() {
      if (selC.value.startsWith('comp:')) {
        LVL_DRAFT.compAction = selC.value.replace('comp:', '');
        LVL_DRAFT.carac = '';
      } else if (selC.value.startsWith('carac:')) {
        LVL_DRAFT.carac = selC.value.replace('carac:', '');
        LVL_DRAFT.compAction = '';
      } else {
        LVL_DRAFT.carac = ''; LVL_DRAFT.compAction = '';
      }
      renderManageSheet();
    };
    cDiv.appendChild(selC);

    if (LVL_DRAFT.compAction === 'gain_suivant' || LVL_DRAFT.compAction === 'gain_familier') {
      const inpComp = el('input', ''); inpComp.type = 'text'; inpComp.style.width = '95%';
      inpComp.placeholder = LVL_DRAFT.compAction === 'gain_suivant' ? 'Nom du Suivant...' : 'Nom du Familier...';
      inpComp.value = LVL_DRAFT.compName || '';
      inpComp.oninput = function() { LVL_DRAFT.compName = inpComp.value; };
      cDiv.appendChild(inpComp);
    }
    row.appendChild(cDiv);
  }

  const mapForT1 = buildChoicesMap('t1');
  const acqForT1 = baseSt.talents.concat(LVL_DRAFT.t2 ? new Array(LVL_DRAFT.t2) : new Array()).concat(LVL_DRAFT.te ? new Array(LVL_DRAFT.te) : new Array());
  const eligT1 = RULES.talents.filter(function(t) { return t.type === 'commun' && isTalentEligible(t.nom, rawCaracs, acqForT1, nextLvl, mapForT1, baseSt.sorts); });
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

  const t1ChoicesList = getChoicesForTalent(LVL_DRAFT.t1, mapForT1, baseSt.sorts);
  if (t1ChoicesList) {
    const used1 = mapForT1[LVL_DRAFT.t1] || new Array();
    const avail1 = t1ChoicesList.filter(function(ch) { return !used1.includes(ch); });
    if (!avail1.includes(LVL_DRAFT.t1Choice)) LVL_DRAFT.t1Choice = avail1.at(0) || '';
    const selSub1 = el('select', ''); selSub1.style.width = '100%'; selSub1.style.background = '#fef3c7';
    avail1.forEach(function(ch) {
      const o = el('option', '', 'Option (' + LVL_DRAFT.t1 + ') : ' + ch); o.value = ch;
      if (LVL_DRAFT.t1Choice === ch) o.selected = true;
      selSub1.appendChild(o);
    });
    selSub1.onchange = function() { LVL_DRAFT.t1Choice = selSub1.value; renderManageSheet(); };
    t1Div.appendChild(selSub1);
  }
  row.appendChild(t1Div);

  const mapForT2 = buildChoicesMap('t2');
  const acqForT2 = baseSt.talents.concat(LVL_DRAFT.t1 ? new Array(LVL_DRAFT.t1) : new Array()).concat(LVL_DRAFT.te ? new Array(LVL_DRAFT.te) : new Array());
  const eligT2 = RULES.talents.filter(function(t) { return t.type === 'commun' && isTalentEligible(t.nom, rawCaracs, acqForT2, nextLvl, mapForT2, baseSt.sorts); });
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

  const t2ChoicesList = getChoicesForTalent(LVL_DRAFT.t2, mapForT2, baseSt.sorts);
  if (t2ChoicesList) {
    const used2 = mapForT2[LVL_DRAFT.t2] || new Array();
    const avail2 = t2ChoicesList.filter(function(ch) { return !used2.includes(ch); });
    if (!avail2.includes(LVL_DRAFT.t2Choice)) LVL_DRAFT.t2Choice = avail2.at(0) || '';
    const selSub2 = el('select', ''); selSub2.style.width = '100%'; selSub2.style.background = '#fef3c7';
    avail2.forEach(function(ch) {
      const o = el('option', '', 'Option (' + LVL_DRAFT.t2 + ') : ' + ch); o.value = ch;
      if (LVL_DRAFT.t2Choice === ch) o.selected = true;
      selSub2.appendChild(o);
    });
    selSub2.onchange = function() { LVL_DRAFT.t2Choice = selSub2.value; renderManageSheet(); };
    t2Div.appendChild(selSub2);
  }
  row.appendChild(t2Div);

  if (hasEpique) {
    const mapForTe = buildChoicesMap('te');
    const acqForTe = baseSt.talents.concat(LVL_DRAFT.t1 ? new Array(LVL_DRAFT.t1) : new Array()).concat(LVL_DRAFT.t2 ? new Array(LVL_DRAFT.t2) : new Array());
    const eligTe = RULES.talents.filter(function(t) { return t.type === 'epique' && isTalentEligible(t.nom, rawCaracs, acqForTe, nextLvl, mapForTe, baseSt.sorts); });
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
const teChoicesList = getChoicesForTalent(LVL_DRAFT.te, mapForTe, baseSt.sorts);
if (teChoicesList) {
const usedE = mapForTe[LVL_DRAFT.te] || new Array();
const availE = teChoicesList.filter(function(ch) { return !usedE.includes(ch); });
if (!availE.includes(LVL_DRAFT.teChoice)) LVL_DRAFT.teChoice = availE.at(0) || '';
const selSubE = el('select', ''); selSubE.style.width = '100%'; selSubE.style.background = '#fef3c7';
availE.forEach(function(ch) {
const o = el('option', '', 'Option (' + LVL_DRAFT.te + ') : ' + ch); o.value = ch;
if (LVL_DRAFT.teChoice === ch) o.selected = true;
selSubE.appendChild(o);
});
selSubE.onchange = function() { LVL_DRAFT.teChoice = selSubE.value; renderManageSheet(); };
teDiv.appendChild(selSubE);
}
row.appendChild(teDiv);
}
box.appendChild(row);
const spellSlots = getSpellSlotsForDraft(LVL_DRAFT);
const alreadyKnownNames = (baseSt.sorts || new Array()).map(function(s) { return s.nom; });
if (spellSlots.length > 0) {
const spWrap = el('div', 'border bg-purple-50 space-y-2');
spWrap.appendChild(el('strong', '', 'Choix des nouveaux sorts débloqués :'));
const pickedThisLevel = new Array();
spellSlots.forEach(function(slotObj, idx) {
const vObj = (RULES.voies_magiques || new Array()).find(function(x) { return x.voie === slotObj.voie; });
const availSorts = vObj ? vObj.sorts.filter(function(s) { return !alreadyKnownNames.includes(s) && !pickedThisLevel.includes(s); }) : new Array();
if (!LVL_DRAFT.spells.at(idx) || LVL_DRAFT.spells.at(idx).voie !== slotObj.voie || !availSorts.includes(LVL_DRAFT.spells.at(idx).nom)) {
LVL_DRAFT.spells[idx] = { voie: slotObj.voie, nom: availSorts.at(0) || '' };
}
if (LVL_DRAFT.spells.at(idx).nom) pickedThisLevel.push(LVL_DRAFT.spells.at(idx).nom);
const sRow = el('div', 'flex');
sRow.appendChild(el('span', '', slotObj.label + ' :'));
const selS = el('select', '');
availSorts.forEach(function(s) {
const o = el('option', '', s); o.value = s;
if (LVL_DRAFT.spells.at(idx).nom === s) o.selected = true;
selS.appendChild(o);
});
selS.onchange = function() { LVL_DRAFT.spells[idx].nom = selS.value; renderManageSheet(); };
sRow.appendChild(selS);
spWrap.appendChild(sRow);
});
box.appendChild(spWrap);
} else {
LVL_DRAFT.spells = new Array();
}
const btnVal = el('button', 'bg-amber-800', 'Valider le passage au Niveau ' + nextLvl);
btnVal.style.width = '100%';
btnVal.onclick = function() { confirmLevelUp(char.id, nextLvl, isPalier5, hasEpique, spellSlots.length); };
box.appendChild(btnVal);
container.appendChild(box);
}

function renderCareerHistory(char, container) {
const histBox = el('div', 'border space-y-2');
histBox.appendChild(el('strong', '', 'Plan de carrière (du plus récent au niveau 1) :'));
const d = char.data;
for (let lvl = char.level; lvl >= 2; lvl--) {
const row = el('div', 'border bg-stone-50');
row.style.fontSize = '12px';
const cGain = (d.level_caracs || {})[lvl];
const compGain = (d.level_companions || {})[lvl];
const tGains = (d.level_talents || {})[lvl] || new Array();
const chGains = (d.level_talent_choices || {})[lvl];
const sGains = (d.level_sorts || {})[lvl] || new Array();
let txt = 'Niveau ' + lvl + ' : ';
if (cGain) txt += '[+1 ' + cGain + '] ';
if (compGain) {
if (compGain.type === 'gain_suivant') txt += '[Suivant obtenu : ' + compGain.nom + '] ';
if (compGain.type === 'gain_familier') txt += '[Familier obtenu : ' + compGain.nom + '] ';
if (compGain.type === 'upgrade_suivant') txt += '[Suivant amélioré] ';
if (compGain.type === 'upgrade_familier') txt += '[Familier amélioré] ';
}
txt += 'Talents : ' + (tGains.join(', ') || '—') + formatChoicesMap(chGains);
if (sGains.length > 0) txt += ' | Sorts : ' + sGains.map(function(s) { return s.nom + ' (' + s.voie + ')'; }).join(', ');
row.textContent = txt;
histBox.appendChild(row);
}
const lvl1Row = el('div', 'border bg-stone-50');
lvl1Row.style.fontSize = '12px';
lvl1Row.textContent = 'Niveau 1 (Création) : ' + d.peuple + ' (+1 ' + d.peuple_carac + '), ' + d.culture + ' (+1 ' + d.culture_carac + '), ' + d.classe + ' | Talents : ' + (d.talents_lvl1 || new Array()).join(', ') + formatChoicesMap(d.talent_choices_lvl1);
histBox.appendChild(lvl1Row);
container.appendChild(histBox);
}
async function confirmLevelUp(charId, nextLvl, isPalier5, hasEpique, spellCount) {
if (isPalier5 && !LVL_DRAFT.carac && !LVL_DRAFT.compAction) return alert("Veuillez choisir une caractéristique (+1) ou un compagnon (Suivant/Familier).");
if (!LVL_DRAFT.t1 || !LVL_DRAFT.t2) return alert("Veuillez sélectionner les 2 talents communs.");
if (hasEpique && !LVL_DRAFT.te) return alert("Veuillez sélectionner un talent épique.");
if (getChoicesForTalent(LVL_DRAFT.t1, {}) && !LVL_DRAFT.t1Choice) return alert("Veuillez choisir une option pour " + LVL_DRAFT.t1 + ".");
if (getChoicesForTalent(LVL_DRAFT.t2, {}) && !LVL_DRAFT.t2Choice) return alert("Veuillez choisir une option pour " + LVL_DRAFT.t2 + ".");
if (hasEpique && getChoicesForTalent(LVL_DRAFT.te, {}) && !LVL_DRAFT.teChoice) return alert("Veuillez choisir une option pour " + LVL_DRAFT.te + ".");
const char = CHARACTERS.find(function(c) { return c.id === charId; });
const d = Object.assign({}, char.data);
if (isPalier5) {
if (LVL_DRAFT.compAction) {
d.level_companions = Object.assign({}, d.level_companions || {});
const defaultName = LVL_DRAFT.compAction === 'gain_suivant' ? 'Suivant' : 'Familier';
d.level_companions[nextLvl] = { type: LVL_DRAFT.compAction, nom: (LVL_DRAFT.compName || '').trim() || defaultName };
} else if (LVL_DRAFT.carac) {
d.level_caracs = Object.assign({}, d.level_caracs || {});
d.level_caracs[nextLvl] = LVL_DRAFT.carac;
}
}
const gainedTalents = new Array(LVL_DRAFT.t1, LVL_DRAFT.t2);
if (hasEpique) gainedTalents.push(LVL_DRAFT.te);
d.level_talents = Object.assign({}, d.level_talents || {});
d.level_talents[nextLvl] = gainedTalents;
const lvlChoices = {};
const pushChoice = function(t, ch) {
if (!t || !ch) return;
if (!lvlChoices[t]) lvlChoices[t] = new Array();
lvlChoices[t].push(ch);
};
pushChoice(LVL_DRAFT.t1, LVL_DRAFT.t1Choice);
pushChoice(LVL_DRAFT.t2, LVL_DRAFT.t2Choice);
if (hasEpique) pushChoice(LVL_DRAFT.te, LVL_DRAFT.teChoice);
d.level_talent_choices = Object.assign({}, d.level_talent_choices || {});
d.level_talent_choices[nextLvl] = lvlChoices;
if (spellCount > 0) {
const picked = LVL_DRAFT.spells.slice(0, spellCount);
if (picked.some(function(s) { return !s || !s.nom; })) return alert("Veuillez sélectionner tous les sorts débloqués.");
d.level_sorts = Object.assign({}, d.level_sorts || {});
d.level_sorts[nextLvl] = picked;
}
LVL_DRAFT = { charId: null, carac: '', compAction: '', compName: '', t1: '', t1Choice: '', t2: '', t2Choice: '', te: '', teChoice: '', spells: new Array() };
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
if (d.level_companions) delete d.level_companions[oldLvl];
if (d.level_talents) delete d.level_talents[oldLvl];
if (d.level_talent_choices) delete d.level_talent_choices[oldLvl];
if (d.level_sorts) delete d.level_sorts[oldLvl];
LVL_DRAFT = { charId: null, carac: '', compAction: '', compName: '', t1: '', t1Choice: '', t2: '', t2Choice: '', te: '', teChoice: '', spells: new Array() };
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
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  if (!char) return;
  const locs = new Array('Tête', 'Torse', 'Ventre/Bassin', 'Bras droit', 'Bras gauche', 'Jambe(s)');
  const loc = locs.at(Math.floor(Math.random() * 6));
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  let grav = d1;
  if (type === 'legere') grav = Math.min(d1, d2);
  if (type === 'grave') grav = Math.max(d1, d2);

  const existing = (char.data.blessures || {})[loc];
  if (existing && existing.gravite >= grav) {
    alert("Blessure " + type + " localisée : " + loc + " (Gravité " + grav + ") — Aucun changement (blessure existante de gravité " + existing.gravite + " conservée).");
    return;
  }

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
  const parts = (COMBAT.participants || new Array()).slice();
  if (parts.some(function(p) { return p.char_id === charId; })) return alert("Ce personnage est déjà dans le combat.");
  parts.push({ char_id: charId, camp: camp, posture: 'Défensif', manoeuvre: 'Pas de manœuvre initiale', ready: false, temp_att: 0, temp_def: 0 });
  await sb.from('combat_state').update({ participants: parts }).eq('id', 1);
}

function getEligibleManoeuvres(char, posture, phaseStatus) {
  const st = getEffectiveState(char);
  const rawList = phaseStatus === 'phase2' ? (RULES.manoeuvres_finales || new Array()) : (RULES.manoeuvres_initiales || new Array());
  return rawList.filter(function(m) {
    if (m.postures && m.postures.length > 0 && !m.postures.includes(posture)) return false;
    if (m.talent && !st.talents.includes(m.talent)) return false;
    return true;
  });
}

function getAdjustedManoeuvreMods(st, manObj, posture) {
  let mAtt = manObj.att || 0;
  let mDef = manObj.def || 0;
  if (manObj.nom === 'Renversement' && st.talents.includes('Charge')) {
    mAtt = Math.min(0, mAtt + 2);
    mDef = Math.min(0, mDef + 2);
  }
  if (st.talents.includes('Prouesse')) {
    if (mAtt < 0) mAtt = Math.min(0, mAtt + 1);
    if (mDef < 0) mDef = Math.min(0, mDef + 1);
  }
  return { att: mAtt, def: mDef };
}


async function updateCombatParticipant(charId, field, value) {
  const char = CHARACTERS.find(function(c) { return c.id === charId; });
  const parts = COMBAT.participants.map(function(p) {
    if (p.char_id !== charId) return p;
    const copy = Object.assign({}, p);
    copy[field] = value;
    if (field === 'posture' && char) {
      const elig = getEligibleManoeuvres(char, value, COMBAT.status);
      if (!elig.some(function(m) { return m.nom === copy.manoeuvre; })) {
        copy.manoeuvre = elig.at(0) ? elig.at(0).nom : '';
      }
      copy.ready = false;
    }
    if (field === 'manoeuvre') {
      copy.ready = false;
    }
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
  const adjMan = getAdjustedManoeuvreMods(st, manObj, p.posture);

  const defaultFists = { nom: "Poings", categorie: "Arme", famille: "Lutte", mains: 1, poids: 0, force_min: 5, degat: 0, portee: 0 };
  const mainWeapon = st.equipped['MainPrincipale'] || st.inv.at(st.worn['MainPrincipale']) || defaultFists;
  const secItem = st.equipped['MainSecondaire'] || st.inv.at(st.worn['MainSecondaire']) || null;

  const isRanged = new Array('Arcs', 'Arbalètes', 'Frondes', 'Armes de jet').includes(mainWeapon.famille);
  const cov = getCoverTotals();

  const allies = (COMBAT && COMBAT.participants ? COMBAT.participants : new Array()).filter(function(other) {
    return other.camp === p.camp && other.char_id !== p.char_id;
  });
  const alliesSamePosture = allies.filter(function(other) { return other.posture === p.posture; });
  const alliesAggressive = allies.filter(function(other) { return other.posture === 'Agressif'; });
  const alliesDefensive = allies.filter(function(other) { return other.posture === 'Défensif'; });

  let attCarac = (st.caracs['Force'] || 10) - 10;
  const secWeaponReq = (secItem && secItem.categorie === 'Arme') ? (secItem.force_min || 5) : 0;
  const maxForceReq = Math.max(mainWeapon.force_min || 5, secWeaponReq);
  if (st.talents.includes('Finesse') && st.caracs['Force'] >= maxForceReq + 1) {
    attCarac = Math.max(attCarac, (st.caracs['Agilité'] || 10) - 10);
  }

  let att = attCarac + (mainWeapon.degat || 0) + posObj.att + adjMan.att + st.emotionObj.att - st.fatigue - st.maxWoundMalus + (parseInt(p.temp_att) || 0);

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

  if (st.talents.includes('Coordination tactique')) {
    att += Math.min(2, Math.floor(alliesSamePosture.length / 2));
  }
  if (st.talents.includes('Gloire') && alliesAggressive.length >= 2) {
    att += 1;
  }

  if (posObj.couv_att === 'malus') att += cov.malus;
  if (posObj.couv_att === 'bonus') att += cov.bonus * (st.talents.includes('Opportunisme') ? 2 : 1);
  att = Math.max(0, att);

  let def = ((st.caracs['Agilité'] || 10) - 10) + st.armorDef + posObj.def + adjMan.def + st.emotionObj.def - st.fatigue - st.maxWoundMalus + (parseInt(p.temp_def) || 0);
  if (!posObj.sans_portee) def += (mainWeapon.portee || 0);
  if (secItem && secItem.categorie === 'Bouclier') def += (secItem.def || 0);
  if (st.talents.includes('Esquive')) def += 1;
  if (st.talents.includes('Parade') && !isRanged && mainWeapon.nom !== 'Poings') def += 1;

  if (st.talents.includes('Rempart') && p.posture === 'Défensif' && !isRanged) {
    const hasShieldOrHast = (secItem && secItem.categorie === 'Bouclier') || mainWeapon.famille === "Arme d'hast";
    const allyHasRempartFormation = hasShieldOrHast && alliesDefensive.some(function(other) {
      const oChar = CHARACTERS.find(function(c) { return c.id === other.char_id; });
      if (!oChar) return false;
      const oSt = getEffectiveState(oChar);
      if (!oSt.talents.includes('Rempart')) return false;
      const oMain = oSt.equipped['MainPrincipale'] || oSt.inv.at(oSt.worn['MainPrincipale']) || defaultFists;
      const oSec = oSt.equipped['MainSecondaire'] || oSt.inv.at(oSt.worn['MainSecondaire']) || null;
      return (oSec && oSec.categorie === 'Bouclier') || oMain.famille === "Arme d'hast";
    });
    def += allyHasRempartFormation ? 2 : 1;
  }

  if (st.talents.includes('Entraînement tactique')) {
    def += Math.min(2, Math.floor(alliesSamePosture.length / 2));
  }
  if (st.talents.includes('Gloire') && alliesDefensive.length >= 2) {
    def += 1;
  }

  if (st.talents.includes('Volée') && p.posture === 'Défensif' && new Array('Arcs', 'Arbalètes', 'Frondes').includes(mainWeapon.famille)) def += 1;
  if (st.talents.includes('Tirailleur') && p.posture === 'Repli' && isRanged) def += 1;
  if (st.talents.includes('Acuité') && isRanged) def += 1;
  if (st.talents.includes('Ténacité') && p.posture === 'Défensif' && !isRanged) def += 2;

  if (posObj.couv_def === 'malus') def += cov.malus;
  if (posObj.couv_def === 'bonus') def += cov.bonus * (st.talents.includes('Opportunisme') ? 2 : 1);
  def = Math.max(0, def);

  return { att: att, def: def };
}


async function rollCombatCamp(camp) {
  const parts = COMBAT.participants || new Array();
  if (parts.length === 0) return alert("Ajoutez au moins un participant avant de lancer les dés.");
  if (!parts.every(function(p) { return p.ready; })) {
    return alert("Tous les personnages doivent être marqués 'Prêt' avant de lancer les dés.");
  }

  const dieMax = COMBAT.combat_type === 'duel' ? 12 : 20;
  const roll = Math.floor(Math.random() * dieMax) + 1;
  const updateObj = camp === 'A' ? { roll_camp_a: roll } : { roll_camp_b: roll };
  const rollA = camp === 'A' ? roll : COMBAT.roll_camp_a;
  const rollB = camp === 'B' ? roll : COMBAT.roll_camp_b;

  if (rollA !== null && rollB !== null) {
    let attA = 0, defA = 0, attB = 0, defB = 0;
    parts.forEach(function(p) {
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
  if (!COMBAT || COMBAT.status !== 'phase1') return;
  const parts = (COMBAT.participants || new Array()).map(function(p) {
    const char = CHARACTERS.find(function(c) { return c.id === p.char_id; });
    const elig = char ? getEligibleManoeuvres(char, p.posture, 'phase2') : new Array();
    const defaultMan = elig.at(0) ? elig.at(0).nom : 'Pas de manœuvre finale';
    return Object.assign({}, p, { manoeuvre: defaultMan, ready: false, temp_att: 0, temp_def: 0 });
  });
  await sb.from('combat_state').update({ status: 'phase2', participants: parts, roll_camp_a: null, roll_camp_b: null, phase2_result: null }).eq('id', 1);
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

  const allParts = COMBAT.participants || new Array();
  const readyCount = allParts.filter(function(p) { return p.ready; }).length;
  const allReady = allParts.length > 0 && readyCount === allParts.length;

  statusEl.textContent = 'Combat (' + COMBAT.combat_type.toUpperCase() + ') — ' + (COMBAT.status === 'phase1' ? 'PHASE INITIALE' : 'PHASE FINALE') + ' | Prêts : ' + readyCount + '/' + allParts.length;

  const btnA = document.getElementById('btn-roll-a');

const btnB = document.getElementById('btn-roll-b');
btnA.disabled = !allReady || COMBAT.roll_camp_a !== null;
btnB.disabled = !allReady || COMBAT.roll_camp_b !== null;
btnA.textContent = COMBAT.roll_camp_a !== null ? ('Dé Camp A : ' + COMBAT.roll_camp_a) : (allReady ? 'Lancer dé Camp A' : 'En attente des joueurs prêts');
btnB.textContent = COMBAT.roll_camp_b !== null ? ('Dé Camp B : ' + COMBAT.roll_camp_b) : (allReady ? 'Lancer dé Camp B' : 'En attente des joueurs prêts');
new Array('A', 'B').forEach(function(camp) {
const listEl = document.getElementById(camp === 'A' ? 'combat-list-a' : 'combat-list-b');
listEl.innerHTML = '';
const campParts = allParts.filter(function(p) { return p.camp === camp; });
campParts.forEach(function(p) {
const char = CHARACTERS.find(function(c) { return c.id === p.char_id; });
if (!char) return;
const isOwner = char.owner_id === CURRENT_USER.id;
const visible = char.is_public || isOwner;
const stats = computeCombatStats(char, p);
const eligList = getEligibleManoeuvres(char, p.posture, COMBAT.status);
const selManObj = eligList.find(function(m) { return m.nom === p.manoeuvre; }) || eligList.at(0) || { nom: '', comp: null, effet: '' };
const card = el('div', 'border space-y-2 ' + (p.ready ? 'bg-amber-50' : 'bg-stone-50'));
const top = el('div', 'flex justify-between');
top.appendChild(el('strong', '', char.name + (visible ? ' (Att: ' + stats.att + ' | Déf: ' + stats.def + ')' : ' (Masqué)')));
const rightCtrl = el('div', 'flex');
if (isOwner) {
const bReady = el('button', p.ready ? 'bg-emerald-700' : '', p.ready ? 'Prêt ✓' : 'Pas prêt');
bReady.style.fontSize = '11px';
bReady.onclick = function() { updateCombatParticipant(char.id, 'ready', !p.ready); };
const bRem = el('button', '', 'Retirer'); bRem.style.color = '#dc2626'; bRem.style.fontSize = '11px';
bRem.onclick = function() { removeFromCombat(char.id); };
rightCtrl.appendChild(bReady); rightCtrl.appendChild(bRem);
} else {
rightCtrl.appendChild(el('span', '', p.ready ? 'Prêt ✓' : 'En choix...'));
}
top.appendChild(rightCtrl);
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
eligList.forEach(function(m) {
const st = getEffectiveState(char);
const adj = getAdjustedManoeuvreMods(st, m, p.posture);
const o = el('option', '', m.nom + ' (Att ' + adj.att + ', Déf ' + adj.def + ')'); o.value = m.nom;
if (p.manoeuvre === m.nom) o.selected = true;
selMan.appendChild(o);
});
selMan.onchange = function() { updateCombatParticipant(char.id, 'manoeuvre', selMan.value); };
const inpAtt = el('input', ''); inpAtt.type = 'number'; inpAtt.value = p.temp_att || 0; inpAtt.style.width = '50px'; inpAtt.title = 'Bonus/Malus temporaire Attaque';
inpAtt.onchange = function() { updateCombatParticipant(char.id, 'temp_att', inpAtt.value); };
const inpDef = el('input', ''); inpDef.type = 'number'; inpDef.value = p.temp_def || 0; inpDef.style.width = '50px'; inpDef.title = 'Bonus/Malus temporaire Défense';
inpDef.onchange = function() { updateCombatParticipant(char.id, 'temp_def', inpDef.value); };
ctrl.appendChild(selPos); ctrl.appendChild(selMan); ctrl.appendChild(inpAtt); ctrl.appendChild(inpDef);
card.appendChild(ctrl);
if (selManObj && selManObj.effet) {
const infoBox = el('div', 'border space-y-2');
infoBox.style.background = '#fff'; infoBox.style.fontSize = '11px';
infoBox.appendChild(el('div', '', selManObj.effet));
card.appendChild(infoBox);
}
} else {
card.appendChild(el('div', '', 'Posture : ' + p.posture + (visible ? ' | Manœuvre : ' + p.manoeuvre : '')));
}
listEl.appendChild(card);
});
});
const res = COMBAT.status === 'phase2' ? COMBAT.phase2_result : COMBAT.phase1_result;
if (res) {
resBox.classList.remove('hidden');
resBox.innerHTML = '';
const isInitial = COMBAT.status === 'phase1';

const winner = res.scoreA > res.scoreB ? 'Camp A' : (res.scoreB > res.scoreA ? 'Camp B' : 'Égalité');
const box = el('div', 'border bg-amber-50 space-y-2');
box.appendChild(el('strong', '', 'Résultat ' + (isInitial ? 'Phase Initiale' : 'Phase Finale') + ' :'));
box.appendChild(el('div', '', 'Camp A : Attaque ' + res.attA + ' + Dé (' + res.rollA + ') - Déf B (' + res.defB + ') = Score ' + res.scoreA + ' -> ' + res.woundsToB + ' blessure(s) infligée(s) au Camp B'));
box.appendChild(el('div', '', 'Camp B : Attaque ' + res.attB + ' + Dé (' + res.rollB + ') - Déf A (' + res.defA + ') = Score ' + res.scoreB + ' -> ' + res.woundsToA + ' blessure(s) infligée(s) au Camp A'));
box.appendChild(el('div', '', isInitial ? 'Tour initial : chaque camp répartit les blessures qu’il inflige à l’adversaire. Cliquez ensuite sur "Phase Finale".' : 'Tour final : chaque camp répartit entre ses membres les blessures qu’il subit.'));
if (!isInitial || COMBAT.combat_type === 'escarmouche') {
box.appendChild(el('strong', '', 'Vainqueur : ' + winner + ' (Score de Victoire : ' + Math.abs(res.scoreA - res.scoreB) + ')'));
}
resBox.appendChild(box);
} else {
resBox.classList.add('hidden');
}
}

let FREE_CARACS = { Force: 10, Agilité: 10, Santé: 10, Connaissance: 10, Perception: 10, Présence: 10 };
let FREE_PORTRAIT = '';
let FREE_TALENTS = new Array();
let FREE_CHOICES = {};

function toggleFreeCreateForm() {
  const wrap = document.getElementById('free-create-wrapper');
  const normWrap = document.getElementById('create-form-wrapper');
  const manageSheet = document.getElementById('manage-sheet-container');
  const sheetSelect = document.getElementById('sheet-char-select');
  const isOpening = wrap.classList.contains('hidden');
  if (isOpening) {
    if (normWrap) normWrap.classList.add('hidden');
    FREE_CARACS = { Force: 10, Agilité: 10, Santé: 10, Connaissance: 10, Perception: 10, Présence: 10 };
    FREE_PORTRAIT = '';
    FREE_TALENTS = new Array();
    FREE_CHOICES = {};
    renderFreeCreationForm();
    wrap.classList.remove('hidden');
    if (manageSheet) manageSheet.classList.add('hidden');
    if (sheetSelect) sheetSelect.disabled = true;
  } else {
    cancelFreeCreation();
  }
}

function cancelFreeCreation() {
  document.getElementById('free-create-wrapper').classList.add('hidden');
  const manageSheet = document.getElementById('manage-sheet-container');
  const sheetSelect = document.getElementById('sheet-char-select');
  if (manageSheet) manageSheet.classList.remove('hidden');
  if (sheetSelect) sheetSelect.disabled = false;
}

function handleFreePortraitUpload(input) {
  const file = input.files.item(0);
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 128;
      canvas.getContext('2d').drawImage(img, 0, 0, 128, 128);
      FREE_PORTRAIT = canvas.toDataURL('image/jpeg', 0.75);
      const prev = document.getElementById('fc-portrait-preview');
      if (prev) prev.src = FREE_PORTRAIT;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function renderFreeCreationForm() {
  const mount = document.getElementById('free-create-mount');
  if (!mount || !RULES) return;
  const prevName = document.getElementById('fc-name') ? document.getElementById('fc-name').value : '';
  const prevType = document.getElementById('fc-type') ? document.getElementById('fc-type').value : 'PNJ / Créature';
  const prevPub = document.getElementById('fc-public') ? document.getElementById('fc-public').checked : true;
  const prevFilter = document.getElementById('fc-tal-filter') ? document.getElementById('fc-tal-filter').value : '';

  mount.innerHTML = '';
  mount.appendChild(el('h3', '', 'Création libre (PNJ, Animal, Créature)'));

  const row1 = el('div', 'grid grid-cols-3');
  const colName = el('div', '');
  colName.appendChild(el('div', '', 'Nom *'));
  const inpName = el('input', ''); inpName.id = 'fc-name'; inpName.type = 'text'; inpName.value = prevName; inpName.style.width = '90%';
  colName.appendChild(inpName);
  row1.appendChild(colName);

  const colType = el('div', '');
  colType.appendChild(el('div', '', 'Nature / Espèce (libre)'));
  const inpType = el('input', ''); inpType.id = 'fc-type'; inpType.type = 'text'; inpType.value = prevType; inpType.style.width = '90%';
  colType.appendChild(inpType);
  row1.appendChild(colType);

  const colPort = el('div', 'flex');
  const prevImg = el('img', 'portrait-img'); prevImg.id = 'fc-portrait-preview';
  prevImg.src = FREE_PORTRAIT || 'data:image/svg+xml;utf8,<svg xmlns="http://w3.org" width="64" height="64"><rect width="64" height="64" fill="%23d6d3d1"/></svg>';
  const inpFile = el('input', ''); inpFile.type = 'file'; inpFile.accept = 'image/*'; inpFile.style.fontSize = '11px';
  inpFile.onchange = function() { handleFreePortraitUpload(inpFile); };
  colPort.appendChild(prevImg); colPort.appendChild(inpFile);
  row1.appendChild(colPort);
  mount.appendChild(row1);

  const lblPub = el('label', 'flex');
  const chkPub = el('input', ''); chkPub.id = 'fc-public'; chkPub.type = 'checkbox'; chkPub.checked = prevPub;
  lblPub.appendChild(chkPub); lblPub.appendChild(document.createTextNode(' Visible par tous les joueurs'));
  mount.appendChild(lblPub);

  mount.appendChild(el('strong', '', '1. Caractéristiques libres (de 0 à 20)'));
  const gridCarac = el('div', 'grid grid-cols-6');
  RULES.caracteristiques.forEach(function(c) {
    const box = el('div', 'border bg-stone-50');
    box.style.textAlign = 'center'; box.style.padding = '6px 4px';
    box.appendChild(el('div', '', c));
    const ctrl = el('div', 'flex');
    ctrl.style.justifyContent = 'center'; ctrl.style.flexWrap = 'nowrap'; ctrl.style.gap = '4px'; ctrl.style.marginTop = '4px';
    const bMinus = el('button', '', '-'); bMinus.style.padding = '2px 7px';
    bMinus.onclick = function() { if (FREE_CARACS[c] > 0) { FREE_CARACS[c] -= 1; revalidateFreeTalents(); renderFreeCreationForm(); } };
    const valSpan = el('strong', '', String(FREE_CARACS[c]));
    valSpan.style.display = 'inline-block'; valSpan.style.minWidth = '20px';
    const bPlus = el('button', '', '+'); bPlus.style.padding = '2px 7px';
    bPlus.onclick = function() { if (FREE_CARACS[c] < 20) { FREE_CARACS[c] += 1; renderFreeCreationForm(); } };
    ctrl.appendChild(bMinus); ctrl.appendChild(valSpan); ctrl.appendChild(bPlus);
    box.appendChild(ctrl);
    gridCarac.appendChild(box);
  });
  mount.appendChild(gridCarac);

  mount.appendChild(el('strong', '', '2. Talents (filtrés automatiquement selon les prérequis)'));
  const addRow = el('div', 'flex');
  const inpFilter = el('input', ''); inpFilter.id = 'fc-tal-filter'; inpFilter.type = 'text'; inpFilter.placeholder = 'Filtrer un talent...'; inpFilter.value = prevFilter;
  const selTal = el('select', ''); selTal.id = 'fc-tal-sel'; selTal.style.maxWidth = '420px';
  const selSub = el('select', ''); selSub.id = 'fc-tal-sub'; selSub.classList.add('hidden'); selSub.style.background = '#fef3c7';

  const updateSubOptions = function() {
    const tName = selTal.value;
    const chList = getChoicesForTalent(tName, FREE_CHOICES);
    selSub.innerHTML = '';
    if (chList) {
      const used = FREE_CHOICES[tName] || new Array();
      const avail = chList.filter(function(ch) { return !used.includes(ch); });
      avail.forEach(function(ch) { const o = el('option', '', ch); o.value = ch; selSub.appendChild(o); });
      selSub.classList.remove('hidden');
    } else {
      selSub.classList.add('hidden');
    }
  };

  const fillFreeTalOptions = function() {
    const q = inpFilter.value.toLowerCase().trim();
    selTal.innerHTML = '';
    RULES.talents.forEach(function(t) {
      if (isTalentEligible(t.nom, FREE_CARACS, FREE_TALENTS, 30, FREE_CHOICES)) {
        if (!q || t.nom.toLowerCase().includes(q) || (t.effet && t.effet.toLowerCase().includes(q))) {
          const o = el('option', '', t.nom + (t.type === 'epique' ? ' [Épique]' : '') + ' — ' + t.effet);
          o.value = t.nom;
          selTal.appendChild(o);
        }
      }
    });
    updateSubOptions();
  };

  fillFreeTalOptions();
  inpFilter.oninput = fillFreeTalOptions;
  selTal.onchange = updateSubOptions;

  const bAddTal = el('button', 'bg-purple-700', '+ Ajouter talent');
  bAddTal.onclick = function() {
    const tName = selTal.value;
    if (!tName) return;
    FREE_TALENTS.push(tName);
    if (!selSub.classList.contains('hidden') && selSub.value) {
      if (!FREE_CHOICES[tName]) FREE_CHOICES[tName] = new Array();
      FREE_CHOICES[tName].push(selSub.value);
    }
    renderFreeCreationForm();
  };
  addRow.appendChild(inpFilter); addRow.appendChild(selTal); addRow.appendChild(selSub); addRow.appendChild(bAddTal);
  mount.appendChild(addRow);

  const acqWrap = el('div', 'flex');
  FREE_TALENTS.forEach(function(tName, idx) {
    const badge = el('span', 'border bg-stone-50', tName + ' ');
    badge.style.fontSize = '12px';
    const bDel = el('button', '', 'x'); bDel.style.color = '#dc2626'; bDel.style.padding = '1px 5px';
    bDel.onclick = function() {
      const removed = FREE_TALENTS.splice(idx, 1).at(0);
      if (FREE_CHOICES[removed]) FREE_CHOICES[removed].pop();
      revalidateFreeTalents();
      renderFreeCreationForm();
    };
    badge.appendChild(bDel);
    acqWrap.appendChild(badge);
  });
  if (Object.keys(FREE_CHOICES).length > 0) {
    const infoCh = el('div', '', 'Spécialisations actives' + formatChoicesMap(FREE_CHOICES));
    infoCh.style.fontSize = '11px'; infoCh.style.color = '#57534e';
    mount.appendChild(infoCh);
  }
  mount.appendChild(acqWrap);

  const btnRow = el('div', 'flex');
  const btnSave = el('button', 'bg-purple-700', 'Enregistrer la créature / le PNJ');
  btnSave.style.flex = '2';
  btnSave.onclick = saveFreeCharacter;
  const btnCancel = el('button', '', 'Annuler');
  btnCancel.style.flex = '1';
  btnCancel.onclick = cancelFreeCreation;
  btnRow.appendChild(btnSave); btnRow.appendChild(btnCancel);
  mount.appendChild(btnRow);
}

function revalidateFreeTalents() {
  let kept = new Array();
  let keptChoices = {};
  let changed = true;
  while (changed) {
    changed = false;
    FREE_TALENTS.forEach(function(tName, idx) {
      if (kept.includes(idx)) return;
      const acqNames = kept.map(function(i) { return FREE_TALENTS.at(i); });
      if (isTalentEligible(tName, FREE_CARACS, acqNames, 30, keptChoices)) {
        kept.push(idx);
        if (FREE_CHOICES[tName] && FREE_CHOICES[tName].length > 0) {
          const usedCount = (keptChoices[tName] || new Array()).length;
          if (FREE_CHOICES[tName].at(usedCount)) {
            if (!keptChoices[tName]) keptChoices[tName] = new Array();
            keptChoices[tName].push(FREE_CHOICES[tName].at(usedCount));
          }
        }
        changed = true;
      }
    });
  }
  FREE_TALENTS = kept.map(function(i) { return FREE_TALENTS.at(i); });
  FREE_CHOICES = keptChoices;
}

async function saveFreeCharacter() {
  const name = document.getElementById('fc-name').value.trim();
if (!name) return alert("Veuillez saisir un nom.");
const nature = document.getElementById('fc-type').value.trim() || 'PNJ / Créature';
const charData = {
portrait: FREE_PORTRAIT,
desir: 'Libre',
peuple: nature,
peuple_carac: '',
culture: 'Création libre',
culture_carac: '',
classe: 'PNJ / Créature',
base_caracs: Object.assign({}, FREE_CARACS),
talents_lvl1: FREE_TALENTS.slice(),
talent_choices_lvl1: Object.assign({}, FREE_CHOICES),
sorts: new Array(),
level_caracs: {},
level_talents: {},
level_talent_choices: {},
inventaire: new Array({ nom: "Poings", categorie: "Arme", famille: "Lutte", mains: 1, poids: 0, force_min: 5, degat: 0, portee: 0 }),
worn: { MainPrincipale: 0 },
blessures: {},
fatigue: 0,
emotion: "Aucune"
};
const res = await sb.from('characters').insert({
owner_id: CURRENT_USER.id, owner_email: CURRENT_USER.email, name: name,
is_public: document.getElementById('fc-public').checked, level: 1, effective_level: 1, data: charData
});
if (res.error) return alert("Erreur : " + res.error.message);
cancelFreeCreation();
alert(name + " créé avec succès !");
await refreshAllData(true);
switchTab('play');
}

async function toggleDestinyTracking(charId, isTracked) {
  await updateCharField(charId, 'track_destiny', isTracked);
}

function extractRaw3d6(detailsStr) {
  if (!detailsStr) return null;
  const match = detailsStr.match(/3d6\s*\(\d+\+\d+\+\d+=(\d+)\)/i);
  return match ? parseInt(match[1], 10) : null;
}

function renderDestiny() {
  const optBar = document.getElementById('destiny-optin-bar');
  const mount = document.getElementById('destiny-gauge-mount');
  if (!optBar || !mount) return;

  optBar.innerHTML = '';
  mount.innerHTML = '';

  const myChars = CHARACTERS.filter(function(c) { return c.owner_id === CURRENT_USER.id; });
  optBar.appendChild(el('strong', '', 'Mes personnages suivis :'));
  if (myChars.length === 0) {
    optBar.appendChild(el('span', '', 'Aucun personnage créé.'));
  } else {
    myChars.forEach(function(c) {
      const lbl = el('label', 'flex');
      lbl.style.background = '#fff'; lbl.style.padding = '3px 8px'; lbl.style.borderRadius = '6px'; lbl.style.border = '1px solid #d6d3d1';
      const chk = el('input', '');
      chk.type = 'checkbox';
      chk.checked = Boolean(c.data && c.data.track_destiny);
      chk.onchange = function() { toggleDestinyTracking(c.id, chk.checked); };
      lbl.appendChild(chk);
      lbl.appendChild(document.createTextNode(c.name));
      optBar.appendChild(lbl);
    });
  }

  const trackedChars = CHARACTERS.filter(function(c) { return c.data && c.data.track_destiny; });
  if (trackedChars.length === 0) {
    const emptyMsg = el('div', 'border bg-stone-50', 'Aucun personnage n’est actuellement inscrit au suivi du Destin. Cochez un personnage ci-dessus pour l’afficher sur la jauge.');
    emptyMsg.style.fontSize = '13px'; emptyMsg.style.color = '#57534e';
    mount.appendChild(emptyMsg);
    return;
  }

  const rangeMode = document.getElementById('destiny-range') ? document.getElementById('destiny-range').value : 'all';
  const cutoff24h = Date.now() - (24 * 60 * 60 * 1000);

  const rulerWrap = el('div', 'border bg-stone-50 space-y-3');
  rulerWrap.style.padding = '16px';

  const scaleHeader = el('div', 'flex justify-between');
  scaleHeader.style.fontSize = '11px'; scaleHeader.style.fontWeight = 'bold'; scaleHeader.style.color = '#78350f';
  scaleHeader.appendChild(el('span', '', '3 (Poisse absolue)'));
  scaleHeader.appendChild(el('span', '', '10,5 (Équilibre du Destin)'));
  scaleHeader.appendChild(el('span', '', '18 (Béni des dieux)'));
  rulerWrap.appendChild(scaleHeader);

  const gradBar = el('div', '');
  gradBar.style.position = 'relative';
  gradBar.style.height = '14px';
  gradBar.style.borderRadius = '999px';
  gradBar.style.background = 'linear-gradient(90deg, #be123c 0%, #f59e0b 50%, #047857 100%)';

  const midTick = el('div', '');
  midTick.style.position = 'absolute';
  midTick.style.left = '50%';
  midTick.style.top = '-4px';
  midTick.style.bottom = '-4px';
  midTick.style.width = '2px';
  midTick.style.background = '#1c1917';
  gradBar.appendChild(midTick);
  rulerWrap.appendChild(gradBar);

  const lanes = el('div', 'space-y-3');
  lanes.style.marginTop = '12px';

  trackedChars.forEach(function(char) {
    let charRolls = ROLLS.filter(function(r) {
      if (r.character_id !== char.id) return false;
      if (extractRaw3d6(r.details) === null) return false;
      if (rangeMode === '24h' && r.created_at) {
        return new Date(r.created_at).getTime() >= cutoff24h;
      }
      return true;
    });

    if (rangeMode === 'last10') {
      charRolls = charRolls.slice(0, 10);
    }

    const values = charRolls.map(function(r) { return extractRaw3d6(r.details); }).filter(function(v) { return v !== null; });
    const lane = el('div', 'border');
    lane.style.background = '#fff'; lane.style.position = 'relative'; lane.style.padding = '8px 12px';

    if (values.length === 0) {
      lane.style.fontSize = '12px'; lane.style.color = '#78716c';
      lane.textContent = char.name + ' — Aucun test 3D6 enregistré sur cette période.';
      lanes.appendChild(lane);
      return;
    }

    const sum = values.reduce(function(a, b) { return a + b; }, 0);
    const avg = sum / values.length;
    const pct = Math.max(0, Math.min(100, ((avg - 3) / 15) * 100));

    const track = el('div', '');
    track.style.position = 'relative';
    track.style.height = '44px';

    const guide = el('div', '');
    guide.style.position = 'absolute'; guide.style.left = '0'; guide.style.right = '0'; guide.style.top = '21px';
    guide.style.height = '2px'; guide.style.background = '#e7e5e4';
    track.appendChild(guide);

    const midLine = el('div', '');
    midLine.style.position = 'absolute'; midLine.style.left = '50%'; midLine.style.top = '6px'; midLine.style.bottom = '6px';
    midLine.style.width = '1px'; midLine.style.borderLeft = '1px dashed #a8a29e';
    track.appendChild(midLine);

    const marker = el('div', 'flex');
    marker.style.position = 'absolute';
    marker.style.left = pct.toFixed(1) + '%';
    marker.style.top = '4px';
    marker.style.transform = 'translateX(-' + pct.toFixed(1) + '%)';
    marker.style.flexWrap = 'nowrap';
    marker.style.background = '#fffbeb';
    marker.style.border = '2px solid #92400e';
    marker.style.borderRadius = '999px';
    marker.style.padding = '2px 10px 2px 3px';
    marker.style.whiteSpace = 'nowrap';
    marker.style.boxShadow = '0 1px 4px rgba(0,0,0,0.15)';
    marker.style.zIndex = '2';

    const avatar = el('img', '');
    avatar.src = char.data.portrait || 'data:image/svg+xml;utf8,<svg xmlns="http://w3.org" width="24" height="24"><rect width="24" height="24" fill="%23d6d3d1"/></svg>';
    avatar.style.width = '24px'; avatar.style.height = '24px'; avatar.style.borderRadius = '50%'; avatar.style.objectFit = 'cover'; avatar.style.flexShrink = '0';

    const label = el('span', '', char.name + ' : ' + avg.toFixed(2) + ' (' + values.length + (values.length > 1 ? ' jets)' : ' jet)'));
    label.style.fontSize = '12px'; label.style.fontWeight = 'bold';


    marker.appendChild(avatar);
    marker.appendChild(label);
    track.appendChild(marker);
    lane.appendChild(track);
    lanes.appendChild(lane);
  });

  rulerWrap.appendChild(lanes);
  mount.appendChild(rulerWrap);
}

let CAREER_EDIT_CHAR_ID = null;
let CAREER_DRAFT = null;

function toggleCareerEdit(char) {
  if (CAREER_EDIT_CHAR_ID === char.id) {
    CAREER_EDIT_CHAR_ID = null;
    CAREER_DRAFT = null;
  } else {
    CAREER_EDIT_CHAR_ID = char.id;
    CAREER_DRAFT = JSON.parse(JSON.stringify(char.data));
    CAREER_DRAFT._level = char.level;
    CAREER_DRAFT._isFree = (char.data.classe === 'PNJ / Créature');
  }
  renderManageSheet();
}

function getChoiceForInstance(choicesMap, tName, occurrenceIdx) {
  const arr = (choicesMap && choicesMap[tName]) ? choicesMap[tName] : new Array();
  return arr.at(occurrenceIdx) || '';
}

function validateAndCleanCareer(draft, maxLvl) {
  const issues = new Array();
  const isFree = Boolean(draft._isFree);
  const caracs = Object.assign({}, draft.base_caracs || {});
  const talents = new Array();
  const choicesMap = {};
  const knownSorts = new Array();
  const companions = { suivant: null, familier: null };

  const addChoice = function(t, ch) {
    if (!t || !ch) return;
    if (!choicesMap[t]) choicesMap[t] = new Array();
    choicesMap[t].push(ch);
  };

  if (!isFree) {
    if (draft.peuple_carac) caracs[draft.peuple_carac] = (caracs[draft.peuple_carac] || 8) + 1;
    if (draft.culture_carac) caracs[draft.culture_carac] = (caracs[draft.culture_carac] || 8) + 1;

    const lvl1Talents = (draft.talents_lvl1 || new Array()).slice();
    const lvl1Choices = draft.talent_choices_lvl1 || {};
    const newLvl1Talents = new Array();
    const newLvl1Choices = {};
    const occLvl1 = {};

    lvl1Talents.forEach(function(tName, idx) {
      const originLabel = idx === 0 ? 'Niveau 1 (Peuple)' : (idx === 1 ? 'Niveau 1 (Culture)' : 'Niveau 1 (Classe)');
      if (!tName) {
        newLvl1Talents.push('');
        return;
      }
      const occ = occLvl1[tName] || 0;
      occLvl1[tName] = occ + 1;
      const ch = getChoiceForInstance(lvl1Choices, tName, occ);

      if (!isTalentEligible(tName, caracs, talents, 1, choicesMap)) {
        issues.push(originLabel + ' : talent "' + tName + '" (prérequis non remplis)');
        newLvl1Talents.push('');
        return;
      }
      const chList = getChoicesForTalent(tName, choicesMap);
      if (chList) {
        const used = choicesMap[tName] || new Array();
        const avail = chList.filter(function(x) { return !used.includes(x); });
        const finalCh = avail.includes(ch) ? ch : (avail.at(0) || '');
        if (!finalCh) {
          issues.push(originLabel + ' : option manquante pour "' + tName + '"');
          newLvl1Talents.push('');
          return;
        }
        if (ch && ch !== finalCh) {
          issues.push(originLabel + ' : option "' + ch + '" de "' + tName + '" remplacée par "' + finalCh + '"');
        }
        addChoice(tName, finalCh);
        if (!newLvl1Choices[tName]) newLvl1Choices[tName] = new Array();
        newLvl1Choices[tName].push(finalCh);
      }
      talents.push(tName);
      newLvl1Talents.push(tName);
    });

    draft.talents_lvl1 = newLvl1Talents;
    draft.talent_choices_lvl1 = newLvl1Choices;
  } else {
    (draft.talents_lvl1 || new Array()).forEach(function(tName) { talents.push(tName); });
    Object.keys(draft.talent_choices_lvl1 || {}).forEach(function(k) {
      choicesMap[k] = (draft.talent_choices_lvl1[k] || new Array()).slice();
    });
  }

  let prevPalierCarac = '';
  for (let lvl = 2; lvl <= maxLvl; lvl++) {
    const isPalier5 = (lvl % 5 === 0);
    if (isPalier5) {
      const compAct = (draft.level_companions || {})[lvl];
      const cGain = (draft.level_caracs || {})[lvl];

      if (compAct) {
        const honneurCount = talents.filter(function(t) { return t === 'Honneur'; }).length;
        const upgradedCount = (companions.suivant && companions.suivant.ameliore ? 1 : 0) + (companions.familier && companions.familier.ameliore ? 1 : 0);
        let validComp = true;
        if (compAct.type === 'gain_suivant' && (!talents.includes('Prestige') || companions.suivant)) validComp = false;
        if (compAct.type === 'gain_familier' && (!talents.includes('Familier') || companions.familier)) validComp = false;
        if (compAct.type === 'upgrade_suivant' && (!companions.suivant || companions.suivant.ameliore || honneurCount <= upgradedCount)) validComp = false;
        if (compAct.type === 'upgrade_familier' && (!companions.familier || companions.familier.ameliore || honneurCount <= upgradedCount)) validComp = false;

        if (!validComp) {
          issues.push('Niveau ' + lvl + ' : bonus de compagnon (' + compAct.type + ') invalidé');
          delete draft.level_companions[lvl];
        } else {
          if (compAct.type === 'gain_suivant') companions.suivant = { nom: compAct.nom || 'Suivant', ameliore: false };
          if (compAct.type === 'gain_familier') companions.familier = { nom: compAct.nom || 'Familier', ameliore: false };
          if (compAct.type === 'upgrade_suivant') companions.suivant.ameliore = true;
          if (compAct.type === 'upgrade_familier') companions.familier.ameliore = true;
        }
      } else if (cGain) {
        if (cGain === prevPalierCarac) {
          issues.push('Niveau ' + lvl + ' : +1 ' + cGain + ' interdit deux paliers de suite');
          delete draft.level_caracs[lvl];
        } else {
          caracs[cGain] = (caracs[cGain] || 8) + 1;
          prevPalierCarac = cGain;
        }
      }
    }

    const lvlTalents = ((draft.level_talents || {})[lvl] || new Array()).slice();
    const lvlChoices = (draft.level_talent_choices || {})[lvl] || {};
    const validLvlTalents = new Array();
    const validLvlChoices = {};
    const occLvl = {};

    lvlTalents.forEach(function(tName, idx) {
      if (!tName) {
        validLvlTalents.push('');
        return;
      }
      const occ = occLvl[tName] || 0;
      occLvl[tName] = occ + 1;
      const ch = getChoiceForInstance(lvlChoices, tName, occ);

      if (!isTalentEligible(tName, caracs, talents, lvl, choicesMap)) {
        issues.push('Niveau ' + lvl + ' : talent "' + tName + '" (prérequis ou voie non remplis)');
        validLvlTalents.push('');
        return;
      }
      const chList = getChoicesForTalent(tName, choicesMap);
      if (chList) {
        const used = choicesMap[tName] || new Array();
        const avail = chList.filter(function(x) { return !used.includes(x); });
        const finalCh = avail.includes(ch) ? ch : (avail.at(0) || '');
        if (!finalCh) {
          issues.push('Niveau ' + lvl + ' : option manquante pour "' + tName + '"');
          validLvlTalents.push('');
          return;
        }
        if (ch && ch !== finalCh) {
          issues.push('Niveau ' + lvl + ' : option "' + ch + '" de "' + tName + '" remplacée par "' + finalCh + '"');
        }
        addChoice(tName, finalCh);
        if (!validLvlChoices[tName]) validLvlChoices[tName] = new Array();
        validLvlChoices[tName].push(finalCh);
      }
      talents.push(tName);
      validLvlTalents.push(tName);
    });

    if (!draft.level_talents) draft.level_talents = {};
    if (!draft.level_talent_choices) draft.level_talent_choices = {};
    draft.level_talents[lvl] = validLvlTalents;
    draft.level_talent_choices[lvl] = validLvlChoices;

    const neededSlots = new Array();
    const occSpell = {};
    validLvlTalents.forEach(function(tName) {
      if (!tName) return;
      const occ = occSpell[tName] || 0;
      occSpell[tName] = occ + 1;
      const voie = getChoiceForInstance(validLvlChoices, tName, occ);
      if (tName === 'Initiation magique' && voie) neededSlots.push(voie);
      if (tName === 'Apprentissage magique' && voie) { neededSlots.push(voie); neededSlots.push(voie); }
      if (tName === 'Maîtrise magique' && voie) { neededSlots.push(voie); neededSlots.push(voie); }
    });

    const oldSorts = ((draft.level_sorts || {})[lvl] || new Array()).slice();
    const newSorts = new Array();
    neededSlots.forEach(function(voie, idx) {
      const vObj = (RULES.voies_magiques || new Array()).find(function(x) { return x.voie === voie; });
      const availSorts = vObj ? vObj.sorts.filter(function(s) { return !knownSorts.includes(s); }) : new Array();
      const prevSp = oldSorts.at(idx);
      if (prevSp && prevSp.voie === voie && availSorts.includes(prevSp.nom)) {
        newSorts.push({ voie: voie, nom: prevSp.nom });
        knownSorts.push(prevSp.nom);
      } else {
        if (prevSp && prevSp.nom) {
          issues.push('Niveau ' + lvl + ' : sort "' + prevSp.nom + '" réinitialisé (voie modifiée)');
        }
        const pick = availSorts.at(0) || '';
        newSorts.push({ voie: voie, nom: pick });
        if (pick) knownSorts.push(pick);
      }
    });
    if (!draft.level_sorts) draft.level_sorts = {};
    if (newSorts.length > 0) draft.level_sorts[lvl] = newSorts;
    else delete draft.level_sorts[lvl];
  }

  return issues;
}

function applyCareerMutation(mutateFn) {
  const candidate = JSON.parse(JSON.stringify(CAREER_DRAFT));
  mutateFn(candidate);
  const issues = validateAndCleanCareer(candidate, CAREER_DRAFT._level);
  if (issues.length > 0) {
    const msg = "Attention : cette modification impacte des choix ultérieurs de la carrière :\n\n• " + issues.join("\n• ") + "\n\nVoulez-vous confirmer ce changement et réinitialiser ces choix impactés ?";
    if (!confirm(msg)) return;
  }
  CAREER_DRAFT = candidate;
  renderManageSheet();
}

function renderCareerEditor(char, container) {
  const d = CAREER_DRAFT;
  const maxLvl = d._level;
  const isFree = Boolean(d._isFree);

  const box = el('div', 'border bg-purple-50 space-y-4');
  const topBar = el('div', 'flex justify-between');
  topBar.appendChild(el('strong', '', 'Édition complète du plan de carrière — ' + char.name + ' (Niveaux 1 à ' + maxLvl + ')'));
  const actBtns = el('div', 'flex');
  const bSave = el('button', 'bg-emerald-800', 'Enregistrer les modifications');
  bSave.onclick = function() { saveCareerEdition(char.id); };
  const bCancel = el('button', '', 'Annuler');
bCancel.onclick = function() { toggleCareerEdit(char); };
actBtns.appendChild(bSave); actBtns.appendChild(bCancel);
topBar.appendChild(actBtns);
box.appendChild(topBar);
const lvl1Card = el('div', 'border space-y-3');
lvl1Card.style.background = '#fff';
lvl1Card.appendChild(el('strong', '', 'Niveau 1 — Création initiale'));
const cGrid = el('div', 'grid grid-cols-6');
const usedPts = Object.values(d.base_caracs || {}).reduce(function(a, b) { return a + (b - 8); }, 0);
RULES.caracteristiques.forEach(function(cName) {
const cell = el('div', 'border bg-stone-50');
cell.style.textAlign = 'center'; cell.style.padding = '4px';
cell.appendChild(el('div', '', cName));
const ctrl = el('div', 'flex');
ctrl.style.justifyContent = 'center'; ctrl.style.flexWrap = 'nowrap'; ctrl.style.gap = '4px';
const bM = el('button', '', '-'); bM.style.padding = '1px 6px';
bM.onclick = function() {
const minV = isFree ? 0 : 8;
if ((d.base_caracs[cName] || 8) <= minV) return;
applyCareerMutation(function(cand) { cand.base_caracs[cName] -= 1; });
};
const vSp = el('strong', '', String(d.base_caracs[cName] || 8));
const bP = el('button', '', '+'); bP.style.padding = '1px 6px';
bP.onclick = function() {
const maxV = isFree ? 20 : 12;
if ((d.base_caracs[cName] || 8) >= maxV) return;
if (!isFree && usedPts >= 14) return alert("Les 14 points de création sont déjà répartis (baissez d'abord une autre caractéristique).");
applyCareerMutation(function(cand) { cand.base_caracs[cName] += 1; });
};
ctrl.appendChild(bM); ctrl.appendChild(vSp); ctrl.appendChild(bP);
cell.appendChild(ctrl);
cGrid.appendChild(cell);
});
lvl1Card.appendChild(cGrid);
const curCaracs = Object.assign({}, d.base_caracs || {});
const curTalents = new Array();
const curChoices = {};
const pushCurChoice = function(t, ch) {
if (!t || !ch) return;
if (!curChoices[t]) curChoices[t] = new Array();
curChoices[t].push(ch);
};
if (!isFree) {
if (d.peuple_carac) curCaracs[d.peuple_carac] = (curCaracs[d.peuple_carac] || 8) + 1;
if (d.culture_carac) curCaracs[d.culture_carac] = (curCaracs[d.culture_carac] || 8) + 1;
const origGrid = el('div', 'grid grid-cols-3');
const pObj = RULES.peuples.find(function(p) { return p.nom === d.peuple; }) || RULES.peuples.at(0);
const pDiv = el('div', 'space-y-2');
pDiv.appendChild(el('strong', '', 'Peuple :'));
const selP = el('select', ''); selP.style.width = '100%';
RULES.peuples.forEach(function(p) { const o = el('option', '', p.nom); o.value = p.nom; if (d.peuple === p.nom) o.selected = true; selP.appendChild(o); });
selP.onchange = function() {
applyCareerMutation(function(cand) {
const np = RULES.peuples.find(function(x) { return x.nom === selP.value; });
cand.peuple = np.nom;
cand.peuple_carac = np.caracs.at(0);
cand.talents_lvl1[0] = np.talents.at(0);
});
};
const selPC = el('select', ''); selPC.style.width = '100%';
pObj.caracs.forEach(function(c) { const o = el('option', '', '+1 ' + c); o.value = c; if (d.peuple_carac === c) o.selected = true; selPC.appendChild(o); });
selPC.onchange = function() { applyCareerMutation(function(cand) { cand.peuple_carac = selPC.value; }); };
const pTal = (d.talents_lvl1 || new Array()).at(0) || '';
const selPT = el('select', ''); selPT.style.width = '100%';
const optP0 = el('option', '', '— Talent Peuple —'); optP0.value = ''; selPT.appendChild(optP0);
pObj.talents.forEach(function(tName) {
const ok = (tName === pTal) || isTalentEligible(tName, curCaracs, new Array(), 1, {});
const o = el('option', '', tName + (ok ? '' : ' (Prérequis non remplis)')); o.value = tName; o.disabled = !ok;
if (pTal === tName) o.selected = true;
selPT.appendChild(o);
});
selPT.onchange = function() { applyCareerMutation(function(cand) { cand.talents_lvl1[0] = selPT.value; }); };
pDiv.appendChild(selP); pDiv.appendChild(selPC); pDiv.appendChild(selPT);
const pChList = getChoicesForTalent(pTal, {});
if (pTal && pChList) {
const curPCh = getChoiceForInstance(d.talent_choices_lvl1, pTal, 0);
const selPSub = el('select', ''); selPSub.style.width = '100%'; selPSub.style.background = '#fef3c7';
pChList.forEach(function(ch) { const o = el('option', '', 'Option : ' + ch); o.value = ch; if (curPCh === ch) o.selected = true; selPSub.appendChild(o); });
selPSub.onchange = function() {
applyCareerMutation(function(cand) {
if (!cand.talent_choices_lvl1[pTal]) cand.talent_choices_lvl1[pTal] = new Array();
cand.talent_choices_lvl1[pTal][0] = selPSub.value;
});
};
pDiv.appendChild(selPSub);
pushCurChoice(pTal, curPCh);
}
if (pTal) curTalents.push(pTal);
origGrid.appendChild(pDiv);
const cObj = RULES.cultures.find(function(c) { return c.nom === d.culture; }) || RULES.cultures.at(0);
const cDiv = el('div', 'space-y-2');
cDiv.appendChild(el('strong', '', 'Culture :'));
const selC = el('select', ''); selC.style.width = '100%';
RULES.cultures.forEach(function(c) { const o = el('option', '', c.nom); o.value = c.nom; if (d.culture === c.nom) o.selected = true; selC.appendChild(o); });
selC.onchange = function() {
applyCareerMutation(function(cand) {
const nc = RULES.cultures.find(function(x) { return x.nom === selC.value; });
cand.culture = nc.nom;
cand.culture_carac = nc.caracs.at(0);
cand.talents_lvl1[1] = nc.talents.at(0);
});
};
const selCC = el('select', ''); selCC.style.width = '100%';
cObj.caracs.forEach(function(c) { const o = el('option', '', '+1 ' + c); o.value = c; if (d.culture_carac === c) o.selected = true; selCC.appendChild(o); });
selCC.onchange = function() { applyCareerMutation(function(cand) { cand.culture_carac = selCC.value; }); };
const cTal = (d.talents_lvl1 || new Array()).at(1) || '';
const selCT = el('select', ''); selCT.style.width = '100%';
const optC0 = el('option', '', '— Talent Culture —'); optC0.value = ''; selCT.appendChild(optC0);
cObj.talents.forEach(function(tName) {
const ok = (tName === cTal) || isTalentEligible(tName, curCaracs, curTalents, 1, curChoices);
const o = el('option', '', tName + (ok ? '' : ' (Prérequis non remplis)')); o.value = tName; o.disabled = !ok;
if (cTal === tName) o.selected = true;
selCT.appendChild(o);
});
selCT.onchange = function() { applyCareerMutation(function(cand) { cand.talents_lvl1[1] = selCT.value; }); };
cDiv.appendChild(selC); cDiv.appendChild(selCC); cDiv.appendChild(selCT);
const cChList = getChoicesForTalent(cTal, curChoices);
if (cTal && cChList) {
const occC = (cTal === pTal) ? 1 : 0;
const curCCh = getChoiceForInstance(d.talent_choices_lvl1, cTal, occC);
const usedC = curChoices[cTal] || new Array();
const selCSub = el('select', ''); selCSub.style.width = '100%'; selCSub.style.background = '#fef3c7';
cChList.filter(function(ch) { return ch === curCCh || !usedC.includes(ch); }).forEach(function(ch) {
const o = el('option', '', 'Option : ' + ch); o.value = ch; if (curCCh === ch) o.selected = true; selCSub.appendChild(o);
});
selCSub.onchange = function() {
applyCareerMutation(function(cand) {
if (!cand.talent_choices_lvl1[cTal]) cand.talent_choices_lvl1[cTal] = new Array();
cand.talent_choices_lvl1[cTal][occC] = selCSub.value;
});
};
cDiv.appendChild(selCSub);
pushCurChoice(cTal, curCCh);
}
if (cTal) curTalents.push(cTal);
origGrid.appendChild(cDiv);
const clObj = RULES.classes.find(function(c) { return c.nom === d.classe; }) || RULES.classes.at(0);
const clDiv = el('div', 'space-y-2');
clDiv.appendChild(el('strong', '', 'Classe (4 talents) :'));
const selCl = el('select', ''); selCl.style.width = '100%';
RULES.classes.forEach(function(c) { const o = el('option', '', c.nom); o.value = c.nom; if (d.classe === c.nom) o.selected = true; selCl.appendChild(o); });
selCl.onchange = function() {
applyCareerMutation(function(cand) {
cand.classe = selCl.value;
cand.talents_lvl1 = new Array(cand.talents_lvl1[0] || '', cand.talents_lvl1[1] || '', '', '', '', '');
});
};
clDiv.appendChild(selCl);
for (let slotIdx = 2; slotIdx < 6; slotIdx++) {
const slotTal = (d.talents_lvl1 || new Array()).at(slotIdx) || '';
const selSlot = el('select', ''); selSlot.style.width = '100%'; selSlot.style.fontSize = '12px';
const oEmpty = el('option', '', '— Talent Classe ' + (slotIdx - 1) + '/4 —'); oEmpty.value = ''; selSlot.appendChild(oEmpty);
clObj.talents.forEach(function(tName) {
const ok = (tName === slotTal) || isTalentEligible(tName, curCaracs, curTalents, 1, curChoices);
const o = el('option', '', tName + (ok ? '' : ' (Non éligible)')); o.value = tName; o.disabled = !ok;
if (slotTal === tName) o.selected = true;
selSlot.appendChild(o);
});
selSlot.onchange = function() {
applyCareerMutation(function(cand) { cand.talents_lvl1[slotIdx] = selSlot.value; });
};
clDiv.appendChild(selSlot);
if (slotTal) {
const clChList = getChoicesForTalent(slotTal, curChoices);
if (clChList) {
const occCl = curTalents.filter(function(x) { return x === slotTal; }).length;
const curClCh = getChoiceForInstance(d.talent_choices_lvl1, slotTal, occCl);
const usedCl = curChoices[slotTal] || new Array();
const selClSub = el('select', ''); selClSub.style.width = '100%'; selClSub.style.background = '#fef3c7'; selClSub.style.fontSize = '11px';
clChList.filter(function(ch) { return ch === curClCh || !usedCl.includes(ch); }).forEach(function(ch) {
const o = el('option', '', 'Option : ' + ch); o.value = ch; if (curClCh === ch) o.selected = true; selClSub.appendChild(o);
});
selClSub.onchange = function() {
applyCareerMutation(function(cand) {
if (!cand.talent_choices_lvl1[slotTal]) cand.talent_choices_lvl1[slotTal] = new Array();
cand.talent_choices_lvl1[slotTal][occCl] = selClSub.value;
});
};
clDiv.appendChild(selClSub);
pushCurChoice(slotTal, curClCh);
}
curTalents.push(slotTal);
}
}
origGrid.appendChild(clDiv);
lvl1Card.appendChild(origGrid);
}
box.appendChild(lvl1Card);
let prevPalierCarac = '';
const companions = { suivant: null, familier: null };
for (let lvl = 2; lvl <= maxLvl; lvl++) {
const lCard = el('div', 'border space-y-2');
lCard.style.background = '#fff';
lCard.appendChild(el('strong', '', 'Niveau ' + lvl));
const isPalier5 = (lvl % 5 === 0);
const hasEpique = new Array(15, 18, 21, 24, 27, 30).includes(lvl);
const lGrid = el('div', 'grid grid-cols-2');
if (isPalier5) {
const p5Div = el('div', 'space-y-2');
p5Div.appendChild(el('div', '', 'Bonus de palier (Niveau ' + lvl + ') :'));
const selP5 = el('select', ''); selP5.style.width = '100%';
const oP0 = el('option', '', '— Choisir bonus de palier —'); oP0.value = ''; selP5.appendChild(oP0);
const curComp = (d.level_companions || {})[lvl];
const curCaracGain = (d.level_caracs || {})[lvl];
RULES.caracteristiques.filter(function(c) { return c !== prevPalierCarac; }).forEach(function(c) {
const o = el('option', '', '+1 ' + c); o.value = 'carac:' + c;
if (!curComp && curCaracGain === c) o.selected = true;
selP5.appendChild(o);
});
const honneurCount = curTalents.filter(function(t) { return t === 'Honneur'; }).length;
const upgradedCount = (companions.suivant && companions.suivant.ameliore ? 1 : 0) + (companions.familier && companions.familier.ameliore ? 1 : 0);
if (curTalents.includes('Prestige') && !companions.suivant) {
const o = el('option', '', 'Obtenir un Suivant (Prestige)'); o.value = 'comp:gain_suivant';
if (curComp && curComp.type === 'gain_suivant') o.selected = true;
selP5.appendChild(o);
}
if (curTalents.includes('Familier') && !companions.familier) {
const o = el('option', '', 'Obtenir un Familier (Familier)'); o.value = 'comp:gain_familier';
if (curComp && curComp.type === 'gain_familier') o.selected = true;
selP5.appendChild(o);
}
if (honneurCount > upgradedCount) {
if (companions.suivant && !companions.suivant.ameliore) {
const o = el('option', '', 'Améliorer le Suivant (Honneur)'); o.value = 'comp:upgrade_suivant';
if (curComp && curComp.type === 'upgrade_suivant') o.selected = true;
selP5.appendChild(o);
}
if (companions.familier && !companions.familier.ameliore) {
const o = el('option', '', 'Améliorer le Familier (Honneur)'); o.value = 'comp:upgrade_familier';
if (curComp && curComp.type === 'upgrade_familier') o.selected = true;
selP5.appendChild(o);
}
}
selP5.onchange = function() {
applyCareerMutation(function(cand) {
if (!cand.level_caracs) cand.level_caracs = {};
if (!cand.level_companions) cand.level_companions = {};
delete cand.level_caracs[lvl];
delete cand.level_companions[lvl];
if (selP5.value.startsWith('carac:')) {
cand.level_caracs[lvl] = selP5.value.replace('carac:', '');
} else if (selP5.value.startsWith('comp:')) {
const tp = selP5.value.replace('comp:', '');
cand.level_companions[lvl] = { type: tp, nom: tp === 'gain_suivant' ? 'Suivant' : 'Familier' };
}
});
};
p5Div.appendChild(selP5);
if (curComp && (curComp.type === 'gain_suivant' || curComp.type === 'gain_familier')) {
const inpCN = el('input', ''); inpCN.type = 'text'; inpCN.value = curComp.nom || ''; inpCN.style.width = '95%';
inpCN.onchange = function() { d.level_companions[lvl].nom = inpCN.value; };
p5Div.appendChild(inpCN);
}
lGrid.appendChild(p5Div);
if (curComp) {
if (curComp.type === 'gain_suivant') companions.suivant = { nom: curComp.nom || 'Suivant', ameliore: false };
if (curComp.type === 'gain_familier') companions.familier = { nom: curComp.nom || 'Familier', ameliore: false };
if (curComp.type === 'upgrade_suivant' && companions.suivant) companions.suivant.ameliore = true;
if (curComp.type === 'upgrade_familier' && companions.familier) companions.familier.ameliore = true;
} else if (curCaracGain) {
curCaracs[curCaracGain] = (curCaracs[curCaracGain] || 8) + 1;
prevPalierCarac = curCaracGain;
}
}
const slotCount = hasEpique ? 3 : 2;
const lvlTalArr = (d.level_talents || {})[lvl] || new Array();
const lvlChObj = (d.level_talent_choices || {})[lvl] || {};
const occThisLvl = {};
const knownSortsSoFar = new Array();
    for (let prevL = 2; prevL < lvl; prevL++) {
      ((d.level_sorts || {})[prevL] || new Array()).forEach(function(s) { knownSortsSoFar.push(s); });
    }

    for (let sIdx = 0; sIdx < slotCount; sIdx++) {
      const isEpSlot = (sIdx === 2);
      const curT = lvlTalArr.at(sIdx) || '';
      const tDiv = el('div', 'space-y-2');
      tDiv.appendChild(el('div', '', isEpSlot ? 'Talent Épique :' : ('Talent commun ' + (sIdx + 1) + '/2 :')));
      const selT = el('select', ''); selT.style.width = '100%'; selT.style.fontSize = '12px';
      const oT0 = el('option', '', '— Choisir un talent —'); oT0.value = ''; selT.appendChild(oT0);

      RULES.talents.filter(function(t) { return isEpSlot ? t.type === 'epique' : t.type === 'commun'; }).forEach(function(t) {
        const ok = (t.nom === curT) || isTalentEligible(t.nom, curCaracs, curTalents, lvl, curChoices, knownSortsSoFar);
        if (ok) {
          const o = el('option', '', t.nom + ' — ' + t.effet); o.value = t.nom;
          if (curT === t.nom) o.selected = true;
          selT.appendChild(o);
        }
      });

      selT.onchange = function() {
        applyCareerMutation(function(cand) {
          if (!cand.level_talents[lvl]) cand.level_talents[lvl] = new Array();
          cand.level_talents[lvl][sIdx] = selT.value;
        });
      };
      tDiv.appendChild(selT);

      if (curT) {
        const occ = occThisLvl[curT] || 0;
        occThisLvl[curT] = occ + 1;
        const chList = getChoicesForTalent(curT, curChoices, knownSortsSoFar);
        if (chList) {
          const curCh = getChoiceForInstance(lvlChObj, curT, occ);
          const usedCh = curChoices[curT] || new Array();
          const selSub = el('select', ''); selSub.style.width = '100%'; selSub.style.background = '#fef3c7'; selSub.style.fontSize = '11px';
          chList.filter(function(ch) { return ch === curCh || !usedCh.includes(ch); }).forEach(function(ch) {
            const o = el('option', '', 'Option : ' + ch); o.value = ch; if (curCh === ch) o.selected = true; selSub.appendChild(o);
          });
          selSub.onchange = function() {
            applyCareerMutation(function(cand) {
              if (!cand.level_talent_choices[lvl]) cand.level_talent_choices[lvl] = {};
              if (!cand.level_talent_choices[lvl][curT]) cand.level_talent_choices[lvl][curT] = new Array();
              cand.level_talent_choices[lvl][curT][occ] = selSub.value;
            });
          };
          tDiv.appendChild(selSub);
          pushCurChoice(curT, curCh);
        }
        curTalents.push(curT);
      }
      lGrid.appendChild(tDiv);
    }
lCard.appendChild(lGrid);
const lvlSorts = (d.level_sorts || {})[lvl] || new Array();
if (lvlSorts.length > 0) {
const spDiv = el('div', 'border bg-purple-50 space-y-2');
spDiv.appendChild(el('strong', '', 'Sorts du niveau ' + lvl + ' :'));
const alreadySorts = new Array();
for (let prevL = 2; prevL < lvl; prevL++) {
((d.level_sorts || {})[prevL] || new Array()).forEach(function(s) { alreadySorts.push(s.nom); });
}
lvlSorts.forEach(function(spObj, spIdx) {
const vObj = (RULES.voies_magiques || new Array()).find(function(x) { return x.voie === spObj.voie; });
const sRow = el('div', 'flex');
sRow.appendChild(el('span', '', 'Voie ' + spObj.voie + ' :'));
const selS = el('select', '');
(vObj ? vObj.sorts : new Array()).filter(function(s) { return s === spObj.nom || !alreadySorts.includes(s); }).forEach(function(s) {
const o = el('option', '', s); o.value = s; if (spObj.nom === s) o.selected = true; selS.appendChild(o);
});
selS.onchange = function() {
applyCareerMutation(function(cand) { cand.level_sorts[lvl][spIdx].nom = selS.value; });
};
sRow.appendChild(selS);
spDiv.appendChild(sRow);
alreadySorts.push(spObj.nom);
});
lCard.appendChild(spDiv);
}
box.appendChild(lCard);
}
container.appendChild(box);
}
async function saveCareerEdition(charId) {
const cleanData = JSON.parse(JSON.stringify(CAREER_DRAFT));
delete cleanData._level;
delete cleanData._isFree;
if (!cleanData._isFree && (cleanData.talents_lvl1 || new Array()).some(function(t) { return !t; })) {
return alert("Veuillez vous assurer que tous les emplacements de talents du Niveau 1 sont remplis.");
}
for (let lvl = 2; lvl <= CAREER_DRAFT._level; lvl++) {
const tArr = (cleanData.level_talents || {})[lvl] || new Array();
if (tArr.some(function(t) { return !t; })) {
return alert("Veuillez remplir tous les emplacements de talents du Niveau " + lvl + " avant d'enregistrer.");
}
if (lvl % 5 === 0 && !(cleanData.level_caracs || {})[lvl] && !(cleanData.level_companions || {})[lvl]) {
return alert("Veuillez sélectionner le bonus de palier (Caractéristique ou Compagnon) du Niveau " + lvl + ".");
}
}
CAREER_EDIT_CHAR_ID = null;
CAREER_DRAFT = null;
await updateCharData(charId, cleanData);
alert("Plan de carrière mis à jour !");
}
  

init();
