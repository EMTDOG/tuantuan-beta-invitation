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
let mail = null;
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

function requireToday(date) {
  const today = todayInBeijing();
  if (date < today) throw new Error('这张邀请码已过期，请向邀请人领取今天的码。');
  if (date > today) throw new Error('这张邀请码从北京时间 ' + date + ' 起可用，请当天回来。');
}

// Only the operator's local importer has the key and records previously accepted tickets.
function readTicket(ticket) {
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
  if (data?.v !== 1 || !hasId) {
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
  return { ticket, day: data.day, date: data.date, minutes: data.minutes };
}

function discardMail() {
  mail = null;
  description.hidden = false;
  letter.hidden = true;
  byId('subject').textContent = '';
  byId('body-text').value = '';
  byId('compose').removeAttribute('href');
  byId('manual').open = false;
}

function reset() {
  clearTimeout(dateTimer);
  invitation = null;
  discardMail();
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
  if (!invitation) return false;
  clearTimeout(dateTimer);
  try {
    requireToday(invitation.date);
  } catch (error) {
    discardMail();
    feedback.hidden = false;
    byId('generate').disabled = true;
    message(error.message + ' 当前回答仍留在本页。', true);
    return false;
  }
  byId('generate').disabled = false;
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

function openTicket(ticket) {
  try {
    const next = readTicket(ticket);
    if (invitation?.ticket === ticket || !mayReplaceDraft()) return;
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
    heading.focus();
  } catch (error) {
    message(error.message, true);
  }
}

login.addEventListener('submit', event => {
  event.preventDefault();
  openTicket(codeInput.value.trim());
});
feedback.addEventListener('input', ({ target }) => {
  target.setCustomValidity('');
  discardMail();
});
feedback.addEventListener('submit', event => {
  event.preventDefault();
  if (!checkDate()) return;
  const answers = [];
  for (const field of fields.querySelectorAll('textarea')) {
    if (!field.value.trim()) {
      field.setCustomValidity('请写下这道题的回答。');
      field.reportValidity();
      return;
    }
    answers.push(field.value.trim());
  }
  const { day, date, ticket } = invitation;
  const payload = new TextEncoder().encode(JSON.stringify({ ticket, answers }));
  const marker = 'TTFB1.' + base64url(payload);
  const subject = 'TTFB1 Day ' + day;
  mail = {
    body: '心度团队好，以下是我' + dayNames[day - 1] + '的体验反馈。\r\n\r\n' + marker,
    filename: 'TTFB1-Day-' + day + '-' + date + '.txt'
  };
  byId('body-text').value = mail.body;
  byId('subject').textContent = subject;
  // Keep the ticket and answers out of URLs, including links to the player's mail app.
  byId('compose').href = 'mailto:' + byId('recipient').textContent + '?subject=' + encodeURIComponent(subject);
  feedback.hidden = true;
  description.hidden = true;
  letter.hidden = false;
  message();
  byId('letter-title').focus();
});

byId('copy').addEventListener('click', async () => {
  if (!checkDate() || !mail) return;
  const draft = mail;
  try {
    await navigator.clipboard.writeText(draft.body);
  } catch {
    if (mail !== draft) return;
    byId('manual').open = true;
    const body = byId('body-text');
    body.focus();
    body.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { /* The selected text remains available for manual copy. */ }
    if (!copied) {
      message('正文已选中，请使用系统的复制功能，再粘贴到邮件中。');
      return;
    }
  }
  if (draft === mail) message('完整正文已复制。请在邮箱中粘贴，再点「发送」。');
});
byId('download').addEventListener('click', () => {
  if (!checkDate() || !mail) return;
  const url = URL.createObjectURL(new Blob([mail.body], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = mail.filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  message('请将下载的 .txt 文件添加为邮件附件，再点「发送」。');
});
byId('compose').addEventListener('click', event => {
  if (!checkDate() || !mail) event.preventDefault();
});
byId('edit').addEventListener('click', () => {
  discardMail();
  feedback.hidden = false;
  message();
  checkDate();
  fields.querySelector('textarea').focus();
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
