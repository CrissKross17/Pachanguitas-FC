const { onValueCreated } = require('firebase-functions/v2/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

admin.initializeApp();

const APP_URL = 'https://pachanguitasfc.es';
const ICON = APP_URL + '/icon-v2-192.png';

function fechaLegible(dateStr) {
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  } catch (e) { return dateStr || ''; }
}

// Recoge los tokens de una lista de uids (o de todos si uids === null)
async function collectTokens(db, uids) {
  const tokensSnap = await db.ref('pfc_tokens').get();
  const tokensByUid = tokensSnap.val() || {};
  const tokens = [];
  const tokenOwners = {};
  Object.entries(tokensByUid).forEach(([uid, devices]) => {
    if (uids !== null && !uids.includes(uid)) return;
    Object.entries(devices || {}).forEach(([key, dev]) => {
      if (dev && dev.token) {
        tokens.push(dev.token);
        tokenOwners[dev.token] = { uid, key };
      }
    });
  });
  return { tokens, tokenOwners };
}

// Convierte ids de jugador (pids) en uids usando pfcv2/players
async function uidsFromPids(db, pids) {
  if (!pids || !pids.length) return [];
  const playersSnap = await db.ref('pfcv2/players').get();
  const players = Object.values(playersSnap.val() || []);
  return players.filter(p => p && p.uid && pids.includes(p.id)).map(p => p.uid);
}

async function sendPush(db, tokens, tokenOwners, title, body, tag, link) {
  if (tokens.length === 0) { console.log('Sin tokens a los que notificar'); return; }
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: {
      headers: { Urgency: 'high', TTL: '86400' },
      notification: { icon: ICON, badge: ICON, tag },
      fcmOptions: { link: link || (APP_URL + '/') }
    }
  });
  console.log(`Push [${tag}]: ${res.successCount} ok, ${res.failureCount} fallos de ${tokens.length}`);
  const removals = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error?.code || '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
        const owner = tokenOwners[tokens[i]];
        if (owner) removals.push(db.ref(`pfc_tokens/${owner.uid}/${owner.key}`).remove());
      }
    }
  });
  await Promise.all(removals);
}

// ── 1. Convocatoria nueva → avisar a TODO el grupo (incluido el creador) ──
exports.notifyConvocatoria = onValueCreated(
  {
    ref: '/pfcv2/matches/{idx}',
    instance: 'pachanguitas-fc-default-rtdb',
    region: 'europe-west1'
  },
  async (event) => {
    const match = event.data.val();
    if (!match || match.status !== 'convocatoria') return;
    const db = admin.database();
    const { tokens, tokenOwners } = await collectTokens(db, null);
    const fecha = fechaLegible(match.date);
    const body = `Partido el ${fecha}${match.time ? ' a las ' + match.time : ''}${match.place ? ' en ' + match.place : ''} — se buscan valientes`;
    await sendPush(db, tokens, tokenOwners, '⚽ ¡Nueva convocatoria!', body, 'convocatoria-' + (match.id || event.params.idx));
  }
);

// ── BUZÓN: la app deja una nota en pfc_push_outbox y aquí se envía ──
// Payload: { type, pids:[ids de jugador destinatarios], date, time, place, extra }
exports.pushOutbox = onValueCreated(
  {
    ref: '/pfc_push_outbox/{key}',
    instance: 'pachanguitas-fc-default-rtdb',
    region: 'europe-west1'
  },
  async (event) => {
    const msg = event.data.val();
    const db = admin.database();
    // Borrar la nota siempre (aunque falle el envío, no reintentar en bucle)
    const cleanup = () => db.ref('pfc_push_outbox/' + event.params.key).remove();
    if (!msg || !msg.type) { await cleanup(); return; }

    try {
      const uids = await uidsFromPids(db, msg.pids || []);
      const fecha = fechaLegible(msg.date);
      const lugar = msg.place ? ' en ' + msg.place : '';
      const hora = msg.time ? ' a las ' + msg.time : '';
      let title = '', body = '';

      switch (msg.type) {
        case 'completa': // → solo al creador
          title = '🔥 ¡Ya sois 10!';
          body = `La convocatoria del ${fecha} está completa — dale a sortear cuando quieras, míster`;
          break;
        case 'sorteo': // → a los convocados
          title = '⚪⚫ ¡Equipos sorteados!';
          body = `Ya hay equipos para el ${fecha} — entra y mira con quién te toca`;
          break;
        case 'cancelada': // → a los apuntados
          title = '😢 Se cae el partido';
          body = `El partido del ${fecha}${lugar} se ha cancelado`;
          break;
        case 'cambio': { // → a los implicados; el título dice qué cambió
          const changed = msg.extra?.changed || [];
          const partes = [];
          if (changed.includes('fecha')) partes.push('fecha');
          if (changed.includes('hora')) partes.push('hora');
          if (changed.includes('lugar')) partes.push('sitio');
          title = '📝 Cambio de ' + (partes.length ? partes.join(' y ') : 'plan');
          body = `El partido queda así: ${fecha}${hora}${lugar}`;
          break;
        }
        case 'votacion': // → a los que jugaron
          title = '⭐ ¡A votar!';
          body = `Partido terminado — vota ya`;
          break;
        case 'mvp': { // → a los que jugaron
          const mvpName = msg.extra?.mvp || '';
          const nota = msg.extra?.nota || '';
          title = '🏆 Votación cerrada';
          body = mvpName
            ? `${mvpName} es el MVP con un ${nota} — entra a ver todos los premios`
            : 'Ya están los resultados — entra a ver los premios';
          break;
        }
        default:
          console.log('Tipo de notificación desconocido:', msg.type);
          await cleanup();
          return;
      }

      const { tokens, tokenOwners } = await collectTokens(db, uids);
      // La de votación lleva al cuestionario del tirón
      const link = msg.type === 'votacion' && msg.matchId ? `${APP_URL}/#vote-${msg.matchId}` : null;
      await sendPush(db, tokens, tokenOwners, title, body, msg.type + '-' + (msg.matchId || event.params.key), link);
    } catch (e) {
      console.error('pushOutbox error:', e);
    }
    await cleanup();
  }
);

// ── RECORDATORIOS PROGRAMADOS (cada hora) ──
exports.recordatorioConvocatoria = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'europe-west1',
    timeZone: 'Europe/Madrid'
  },
  async () => {
    const db = admin.database();
    const matchesSnap = await db.ref('pfcv2/matches').get();
    const matches = matchesSnap.val() || [];
    const playersSnap = await db.ref('pfcv2/players').get();
    const players = Object.values(playersSnap.val() || []);
    const now = Date.now();

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (!m) continue;

      const matchTs = new Date(`${m.date}T${m.time || '20:00'}:00`).getTime();
      const hoursLeft = isNaN(matchTs) ? null : (matchTs - now) / 3600000;

      // 2. Convocatoria coja: <10h para el partido y aún no hay 10 — el mismo día igual sí te animas
      if (m.status === 'convocatoria' && !m.reminderSent && hoursLeft !== null && hoursLeft <= 10 && hoursLeft > 0) {
        const ins = Object.values(m.rsvp || {}).filter(v => v === 'in').length;
        if (ins < 10) {
          const pendingUids = players
            .filter(p => p && !p.isRandom && p.uid && (m.rsvp?.[p.id] === undefined))
            .map(p => p.uid);
          if (pendingUids.length) {
            const { tokens, tokenOwners } = await collectTokens(db, pendingUids);
            const faltan = 10 - ins;
            const body = `Faltan ${faltan} para hoy${m.time ? ' a las ' + m.time : ''}${m.place ? ' en ' + m.place : ''} — ¿te animas o qué?`;
            await sendPush(db, tokens, tokenOwners, '⏳ ¡Aún faltan jugadores!', body, 'recordatorio-' + (m.id || i));
          }
          await db.ref(`pfcv2/matches/${i}/reminderSent`).set(true);
        }
      }

      // 6. Hoy se juega: partido con equipos hechos, <12h — recordatorio a los convocados
      if (m.status === 'pending' && (m.players || []).length > 0 && !m.dayReminderSent && hoursLeft !== null && hoursLeft <= 12 && hoursLeft > 0) {
        const uids = players.filter(p => p && p.uid && (m.players || []).includes(p.id)).map(p => p.uid);
        if (uids.length) {
          const { tokens, tokenOwners } = await collectTokens(db, uids);
          const body = `Hoy${m.time ? ' a las ' + m.time : ''}${m.place ? ' en ' + m.place : ''}. No llegues tarde, tardón`;
          await sendPush(db, tokens, tokenOwners, '⚽ ¡Hoy se juega!', body, 'hoyjuegas-' + (m.id || i));
        }
        await db.ref(`pfcv2/matches/${i}/dayReminderSent`).set(true);
      }

      // 8. Te falta votar: partido cerrado hace >24h y aún sin todos los votos
      if (m.status === 'done' && m.closedAt && !m.voteReminderSent && (now - m.closedAt) > 24 * 3600000) {
        const eligible = players.filter(p => p && !p.isRandom && p.uid && (m.players || []).includes(p.id));
        const votedIds = Object.keys(m.votes || {});
        const missing = eligible.filter(p => !votedIds.includes(p.id));
        if (missing.length > 0) {
          const uids = missing.map(p => p.uid);
          const { tokens, tokenOwners } = await collectTokens(db, uids);
          const body = `Eres de los últimos sin votar el partido del ${fechaLegible(m.date)} — no nos dejes sin premios 👀`;
          await sendPush(db, tokens, tokenOwners, '👀 Te falta votar', body, 'faltavotar-' + (m.id || i), m.id ? `${APP_URL}/#vote-${m.id}` : null);
        }
        await db.ref(`pfcv2/matches/${i}/voteReminderSent`).set(true);
      }
    }
  }
);
