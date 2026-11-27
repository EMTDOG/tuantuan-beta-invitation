'use strict';

const byId = id => document.getElementById(id);
const login = byId('login');
const codeInput = byId('code');
const session = byId('session');
const fields = byId('fields');
const feedback = byId('feedback');
const letter = byId('letter');
const heading = byId('entry-title');
const description = byId('description');
const welcome = description.textContent;
const notice = byId('notice');
const dayNames = ['第一天', '第二天', '第三天'];
const dayMs = 86400000;
const beijingOffset = 8 * 3600000;
let invitation = null;
let sending = false;
let completed = false;
let dateTimer;

function message(text = '', error = false) {
  notice.textContent = text;
  notice.classList.toggle('error', error);
}

function todayInBeijing() {
  return new Date(Date.now() + beijingOffset).toISOString().slice(0, 10);
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const decode64 = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const utf8 = new TextEncoder();

async function sealAnswers(invite, answers) {
  const slot = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(invite.grant)));
  const aad = utf8.encode(Array.from(slot, b => b.toString(16).padStart(2,'0')).join(''));
  const params = {name:'ECDH', namedCurve:'P-256'};
  const recipient = await crypto.subtle.importKey('raw', decode64(invite.key), params, false, []);
  const ephemeral = await crypto.subtle.generateKey(params, true, ['deriveBits']);
  const shared = await crypto.subtle.deriveBits({name:'ECDH',public:recipient},ephemeral.privateKey,256);
  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:slot,info:utf8.encode('tuantuan-feedback-envelope-v1')},
    material, {name:'AES-GCM',length:256}, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},aes,utf8.encode(JSON.stringify(answers)));
  const epk = await crypto.subtle.exportKey('raw',ephemeral.publicKey);
  return {v:1,epk:base64url(new Uint8Array(epk)),iv:base64url(iv),ct:base64url(new Uint8Array(ct))};
}

function requireToday(date) {
  const today = todayInBeijing();
  if (date < today) throw new Error('这张邀请码已过期，请向邀请人领取今天的码。');
  if (date > today) throw new Error('这张邀请码从北京时间 ' + date + ' 起可用，请当天回来。');
}

// The receiver verifies the signature and checks today's minutes before showing the questions.
async function readTicket(ticket) {
  const parts = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(ticket);
  if (!parts) throw new Error('邀请码格式有误，请完整复制团队发给你的当日码。');
  let data;
  try {
    const binary = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    if (base64url(bytes) !== parts[1]) throw new Error();
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('邀请码内容无法读取，请重新复制完整邀请码。');
  }
  const id = data?.id;
  const hasId = typeof id === 'string' ? id.trim().length > 0 : Number.isSafeInteger(id);
  if (![1,2].includes(data?.v) || !hasId) {
    throw new Error('邀请码版本或玩家编号有误，请联系邀请人。');
  }
  if (!Number.isInteger(data.day) || data.day < 1 || data.day > 3) {
    throw new Error('邀请码的体验日序有误，请向邀请人核对。');
  }
  if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
      !Number.isFinite(Date.parse(data.date)) || new Date(data.date).toISOString().slice(0, 10) !== data.date) {
    throw new Error('邀请码日期有误，请向邀请人核对。');
  }
  if (!Number.isSafeInteger(data.minutes) || data.minutes < 30) {
    throw new Error('需由团队核对满 30 分钟后签发当日码。遇到 BUG 或急事可直接私信邀请人。');
  }
  requireToday(data.date);
  const cloud = data.v === 2;
  const validRoute = cloud
    ? /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(data.inbox) &&
      /^[0-9a-f]{64}$/.test(data.grant) && /^[A-Za-z0-9_-]{87}$/.test(data.key)
    : /^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(data.inbox);
  if (!validRoute || !/^[A-Za-z0-9_-]{86}$/.test(data.proof)) {
    throw new Error('请向邀请人重新领取个人链接。');
  }
  const signer = await crypto.subtle.importKey('raw', decode64('BEqt-HIiZE6aZF8S0j_CYkaY2bqkquMGfrDnFqiExYEzrUAPKe75P4zz1iWh9dsQfSWNa8ThHuDSzgPCF2OSkCc'),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const signed = cloud ? [data.v,data.id,data.day,data.date,data.minutes,data.inbox,data.key,data.grant].join('\n') : data.inbox;
  const valid = await crypto.subtle.verify({name:'ECDSA', hash:'SHA-256'}, signer,
    decode64(data.proof), utf8.encode(signed));
  if (!valid) throw new Error('收件地址未通过验证，请重新复制邀请人发来的链接。');
  return { ticket, cloud, grant:data.grant, key:data.key, inbox:data.inbox, id:data.id, day: data.day, date: data.date, minutes: data.minutes };
}

function showReceipt() {
  completed = true;
  clearTimeout(dateTimer);
  fields.replaceChildren();
  description.hidden = feedback.hidden = true;
  letter.hidden = false;
  byId('receipt-detail').textContent = invitation.cloud
    ? '已安全收件。你的回答已加密保存，团队电脑上线后会自动取回。可以关闭本页了。'
    : '你的五个回答已存入团队的电脑，可以关闭本页了。';
  message('');
  byId('letter-title').focus();
}

async function post(inbox, route, payload) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 12000);
  try {
    const response = await fetch(inbox + '/api/feedback/' + route, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload), cache:'no-store', credentials:'omit', redirect:'error', signal:abort.signal
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '提交未成功，请重试。');
    return result;
  } catch (err) {
    if (err instanceof TypeError || err instanceof SyntaxError || err.name === 'AbortError')
      throw new Error('暂时联系不上收件服务。请保留本页，稍后重试；如果邀请人重发了链接，可将它粘贴到邀请码栏继续。');
    throw err;
  } finally { clearTimeout(timer); }
}

function reset() {
  clearTimeout(dateTimer);
  invitation = null;
  completed = false;
  description.hidden = false;
  letter.hidden = true;
  fields.replaceChildren();
  codeInput.value = '';
  session.hidden = feedback.hidden = true;
  login.hidden = false;
  byId('generate').disabled = false;
  byId('facts').textContent = '';
  document.body.classList.remove('opened');
  heading.textContent = '打开今日手记';
  description.textContent = welcome;
  message();
}

function checkDate() {
  if (!invitation || completed) return false;
  clearTimeout(dateTimer);
  try {
    requireToday(invitation.date);
  } catch (error) {
    letter.hidden = true;
    feedback.hidden = false;
    byId('generate').disabled = true;
    message(error.message + ' 当前回答仍留在本页。', true);
    return false;
  }
  byId('generate').disabled = sending;
  dateTimer = setTimeout(checkDate, dayMs - (Date.now() + beijingOffset) % dayMs + 50);
  return true;
}

function addQuestion(question, index) {
  const row = document.createElement('div');
  row.className = 'question';
  const label = document.createElement('label');
  const number = document.createElement('b');
  number.textContent = String(index + 1).padStart(2, '0');
  label.append(number, document.createTextNode(question));
  const answer = document.createElement('textarea');
  answer.id = label.htmlFor = 'answer-' + (index + 1);
  answer.required = true;
  answer.maxLength = 1200;
  answer.autocomplete = 'off';
  answer.spellcheck = false;
  answer.placeholder = '写下你的体验…';
  row.append(label, answer);
  fields.append(row);
}

function mayReplaceDraft() {
  return !Array.from(fields.querySelectorAll('textarea')).some(field => field.value) ||
    window.confirm('更换邀请码会清空本页回答。确定更换吗？');
}

async function openTicket(ticket) {
  if (sending) return;
  sending = true;
  byId('open').disabled = true;
  try {
    if (ticket.startsWith('https://')) {
      const link = new URL(ticket);
      ticket = new URLSearchParams(link.hash.slice(1)).get('code') || '';
    }
    const next = await readTicket(ticket);
    const sameDay = invitation && next.day === invitation.day && next.date === invitation.date && next.id === invitation.id;
    if (invitation?.ticket === ticket || (!sameDay && !mayReplaceDraft())) return;
    const state = await post(next.inbox, 'status', next.cloud ? {grant:next.grant} : {ticket});
    if (typeof state.submitted !== 'boolean') throw new Error('未能核实邀请码，请重试。');
    if (sameDay && !state.submitted) {
      invitation = next;
      login.hidden = true;
      message('已重新连接，刚才写的回答还在，可以提交了。');
      return;
    }
    reset();
    invitation = next;
    login.hidden = true;
    session.hidden = feedback.hidden = false;
    document.body.classList.add('opened');
    heading.textContent = dayNames[next.day - 1] + '的手记';
    description.textContent = '请写下今天的五个回答，每题最多 1200 字。';
    Array.from(document.querySelectorAll('.days li')).forEach((el, i) => {
      if (i + 1 === next.day) el.setAttribute('aria-current', 'step');
      else el.removeAttribute('aria-current');
    });
    byId('facts').textContent = '北京时间 ' + next.date + ' · 当天体验 ' + next.minutes + ' 分钟';
    questions[next.day - 1].forEach(addQuestion);
    checkDate();
    if (state.submitted) showReceipt();
    else heading.focus();
  } catch (error) {
    message(error.message, true);
  } finally {
    sending = false;
    byId('open').disabled = false;
    if (invitation && !completed) checkDate();
  }
}

login.addEventListener('submit', event => {
  event.preventDefault();
  openTicket(codeInput.value.trim());
});
feedback.addEventListener('input', ({ target }) => {
  target.setCustomValidity('');
});
feedback.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || !checkDate()) return;
  const inputs = [...fields.querySelectorAll('textarea')];
  const answers = inputs.map(field => field.value.trim());
  const empty = answers.indexOf('');
  if (empty >= 0) {
    inputs[empty].setCustomValidity('请写下这道题的回答。');
    inputs[empty].reportValidity();
    return;
  }
  const current = invitation;
  sending = true;
  inputs.forEach(field => field.readOnly = true);
  byId('change').disabled = byId('generate').disabled = true;
  message(current.cloud ? '正在加密并提交…' : '正在提交到团队的电脑…');
  try {
    let payload;
    if (current.cloud) {
      const draft = JSON.stringify(answers);
      if (current.lastDraft !== draft) {
        current.envelope = await sealAnswers(current, answers);
        current.lastDraft = draft;
      }
      payload = {grant:current.grant, envelope:current.envelope};
    } else {
      payload = {ticket:current.ticket, answers};
    }
    const result = await post(current.inbox, 'submit', payload);
    if (result.saved !== true) throw new Error('尚未确认保存，请重试。');
    if (invitation === current) showReceipt();
  } catch (err) {
    if (invitation === current) {
      message(err.message, true);
      login.hidden = false;
    }
  } finally {
    sending = false;
    inputs.forEach(field => field.readOnly = false);
    byId('change').disabled = false;
    if (!completed) checkDate();
  }
});
byId('change').addEventListener('click', () => {
  if (!mayReplaceDraft()) return;
  reset();
  codeInput.focus();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkDate();
});

function readInvitationLink() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.has('code')) return;
  const ticket = fragment.get('code').trim();
  history.replaceState(history.state, '', location.href.split('#')[0]);
  openTicket(ticket);
}
window.addEventListener('hashchange', readInvitationLink);
window.addEventListener('pagehide', reset);
reset();
byId('open').disabled = false;
readInvitationLink();
