// public/app.js — Edu Seria LMS front-end
const API = '';
const store = {
  get token() { return localStorage.getItem('es_token'); },
  set token(v) { v ? localStorage.setItem('es_token', v) : localStorage.removeItem('es_token'); },
  get user() { try { return JSON.parse(localStorage.getItem('es_user')); } catch { return null; } },
  set user(v) { v ? localStorage.setItem('es_user', JSON.stringify(v)) : localStorage.removeItem('es_user'); },
};

// ---------- API helper ----------
async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (store.token) headers.Authorization = `Bearer ${store.token}`;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' err' : '');
  setTimeout(() => (t.className = 'toast hidden'), 2600);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// created_at comes back as a string (SQLite) or a Date (Azure SQL / Oracle); normalise to YYYY-MM-DD.
const fmtDate = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10); };

// ---------- Auth view ----------
function setupAuth() {
  const tabs = document.querySelectorAll('.tab');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const msg = document.getElementById('auth-msg');

  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    loginForm.classList.toggle('hidden', !isLogin);
    registerForm.classList.toggle('hidden', isLogin);
    msg.textContent = '';
  }));

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'msg';
    const f = new FormData(loginForm);
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } });
      store.token = data.token; store.user = data.user;
      enterApp();
    } catch (err) { msg.textContent = err.message; msg.className = 'msg error'; }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'msg';
    const f = new FormData(registerForm);
    try {
      const data = await api('/api/auth/register', { method: 'POST', body: {
        name: f.get('name'), email: f.get('email'), password: f.get('password'), role: f.get('role'),
      }});
      store.token = data.token; store.user = data.user;
      enterApp();
    } catch (err) { msg.textContent = err.message; msg.className = 'msg error'; }
  });
}

// ---------- App shell ----------
function enterApp() {
  document.getElementById('auth-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
  const user = store.user;
  document.getElementById('user-name').textContent = user.name;
  const roleEl = document.getElementById('user-role');
  roleEl.textContent = user.role;
  roleEl.className = 'badge ' + user.role;

  const nav = document.getElementById('nav');
  const tabs = user.role === 'educator'
    ? [['courses', 'My Courses'], ['participants', 'Participants'], ['profile', 'Profile']]
    : [['browse', 'Browse Courses'], ['enrolled', 'My Learning'], ['profile', 'Profile']];
  nav.innerHTML = tabs.map(([k, label]) => `<button data-view="${k}">${label}</button>`).join('');
  nav.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => render(b.dataset.view)));

  render(tabs[0][0]);
}

document.getElementById('logout').addEventListener('click', () => {
  store.token = null; store.user = null;
  location.reload();
});

function setActiveNav(view) {
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}

// ---------- Router ----------
async function render(view) {
  setActiveNav(view);
  const content = document.getElementById('content');
  content.innerHTML = '<div class="empty">Loading…</div>';
  try {
    if (view === 'courses') await viewEducatorCourses(content);
    else if (view === 'participants') await viewParticipants(content);
    else if (view === 'browse') await viewBrowse(content);
    else if (view === 'enrolled') await viewEnrolled(content);
    else if (view === 'profile') await viewProfile(content);
  } catch (err) {
    content.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

// ---------- Educator: My Courses (Create / Update / Delete) ----------
async function viewEducatorCourses(el) {
  const { courses } = await api('/api/courses');
  const mine = courses.filter((c) => c.educator_id === store.user.id);

  el.innerHTML = `
    <div class="panel">
      <h3>Create a course</h3>
      <div class="row">
        <label>Title<input id="c-title" placeholder="e.g. Cloud Computing Basics" /></label>
        <label>Category<input id="c-cat" placeholder="e.g. Technology" /></label>
      </div>
      <label>Description<textarea id="c-desc" rows="2" placeholder="What will learners get out of this course?"></textarea></label>
      <button class="btn primary" id="c-create" style="width:auto">Create course</button>
    </div>
    <div class="section-head"><h2>My courses (${mine.length})</h2></div>
    <div class="grid" id="course-grid">
      ${mine.length ? mine.map(courseCard).join('') : '<div class="empty">No courses yet. Create your first one above.</div>'}
    </div>`;

  document.getElementById('c-create').addEventListener('click', async () => {
    const title = document.getElementById('c-title').value.trim();
    if (!title) return toast('A title is required.', true);
    try {
      await api('/api/courses', { method: 'POST', body: {
        title, category: document.getElementById('c-cat').value.trim(), description: document.getElementById('c-desc').value.trim(),
      }});
      toast('Course created.');
      render('courses');
    } catch (err) { toast(err.message, true); }
  });

  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editCourseModal(mine.find((c) => c.id == b.dataset.edit))));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => deleteCourse(b.dataset.del)));
}

function courseCard(c) {
  return `<div class="card">
    ${c.category ? `<span class="cat">${esc(c.category)}</span>` : ''}
    <h3>${esc(c.title)}</h3>
    <p class="desc">${esc(c.description) || 'No description.'}</p>
    <div class="meta"><span>${c.enrolled_count ?? 0} enrolled</span></div>
    <div class="card-actions">
      <button class="btn ghost small" data-edit="${c.id}">Edit</button>
      <button class="btn danger small" data-del="${c.id}">Delete</button>
    </div>
  </div>`;
}

function editCourseModal(c) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">
    <h3>Edit course</h3>
    <label>Title<input id="e-title" value="${esc(c.title)}" /></label>
    <label>Category<input id="e-cat" value="${esc(c.category || '')}" /></label>
    <label>Description<textarea id="e-desc" rows="3">${esc(c.description || '')}</textarea></label>
    <div class="modal-actions">
      <button class="btn ghost" id="e-cancel">Cancel</button>
      <button class="btn primary" id="e-save">Save changes</button>
    </div>
  </div>`;
  document.body.appendChild(bg);
  bg.querySelector('#e-cancel').addEventListener('click', () => bg.remove());
  bg.querySelector('#e-save').addEventListener('click', async () => {
    try {
      await api(`/api/courses/${c.id}`, { method: 'PUT', body: {
        title: document.getElementById('e-title').value.trim(),
        category: document.getElementById('e-cat').value.trim(),
        description: document.getElementById('e-desc').value.trim(),
      }});
      bg.remove(); toast('Course updated.'); render('courses');
    } catch (err) { toast(err.message, true); }
  });
}

async function deleteCourse(id) {
  if (!confirm('Delete this course and its enrolments?')) return;
  try { await api(`/api/courses/${id}`, { method: 'DELETE' }); toast('Course deleted.'); render('courses'); }
  catch (err) { toast(err.message, true); }
}

// ---------- Educator: Participants ----------
async function viewParticipants(el) {
  const { users } = await api('/api/users?role=learner');
  el.innerHTML = `
    <div class="section-head"><h2>Learners (${users.length})</h2></div>
    <div class="panel">
      ${users.length ? `<table>
        <thead><tr><th>Name</th><th>Email</th><th>Joined</th></tr></thead>
        <tbody>${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(fmtDate(u.created_at))}</td></tr>`).join('')}</tbody>
      </table>` : '<div class="empty">No learners registered yet.</div>'}
    </div>`;
}

// ---------- Learner: Browse & enrol ----------
async function viewBrowse(el) {
  const [{ courses }, { courses: enrolled }] = await Promise.all([
    api('/api/courses'), api('/api/enrollments/mine'),
  ]);
  const enrolledIds = new Set(enrolled.map((c) => c.id));
  el.innerHTML = `
    <div class="section-head"><h2>Available courses (${courses.length})</h2></div>
    <div class="grid">
      ${courses.length ? courses.map((c) => `<div class="card">
        ${c.category ? `<span class="cat">${esc(c.category)}</span>` : ''}
        <h3>${esc(c.title)}</h3>
        <p class="desc">${esc(c.description) || 'No description.'}</p>
        <div class="meta"><span>By ${esc(c.educator_name)}</span><span>${c.enrolled_count ?? 0} enrolled</span></div>
        <div class="card-actions">
          ${enrolledIds.has(c.id)
            ? '<button class="btn ghost small" disabled>Enrolled ✓</button>'
            : `<button class="btn amber small" data-enrol="${c.id}">Enrol</button>`}
        </div>
      </div>`).join('') : '<div class="empty">No courses available yet.</div>'}
    </div>`;
  el.querySelectorAll('[data-enrol]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/enrollments', { method: 'POST', body: { course_id: Number(b.dataset.enrol) } }); toast('Enrolled.'); render('browse'); }
    catch (err) { toast(err.message, true); }
  }));
}

// ---------- Learner: My Learning ----------
async function viewEnrolled(el) {
  const { courses } = await api('/api/enrollments/mine');
  el.innerHTML = `
    <div class="section-head"><h2>My learning (${courses.length})</h2></div>
    <div class="grid">
      ${courses.length ? courses.map((c) => `<div class="card">
        ${c.category ? `<span class="cat">${esc(c.category)}</span>` : ''}
        <h3>${esc(c.title)}</h3>
        <p class="desc">${esc(c.description) || 'No description.'}</p>
        <div class="meta"><span>By ${esc(c.educator_name)}</span></div>
        <div class="card-actions"><button class="btn danger small" data-drop="${c.id}">Drop course</button></div>
      </div>`).join('') : '<div class="empty">You have not enrolled in any courses yet.</div>'}
    </div>`;
  el.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/enrollments/${b.dataset.drop}`, { method: 'DELETE' }); toast('Dropped course.'); render('enrolled'); }
    catch (err) { toast(err.message, true); }
  }));
}

// ---------- Profile (Update / Delete account) ----------
async function viewProfile(el) {
  const u = store.user;
  el.innerHTML = `
    <div class="section-head"><h2>My profile</h2></div>
    <div class="panel">
      <label>Name<input id="p-name" value="${esc(u.name)}" /></label>
      <label>Email<input value="${esc(u.email)}" disabled /></label>
      <label>New password (leave blank to keep current)<input id="p-pass" type="password" placeholder="••••••" /></label>
      <button class="btn primary" id="p-save" style="width:auto">Save changes</button>
    </div>
    <div class="panel">
      <h3>Danger zone</h3>
      <p class="desc" style="color:var(--ink-soft)">Permanently delete your account and related data.</p>
      <button class="btn danger" id="p-del" style="width:auto">Delete my account</button>
    </div>`;
  document.getElementById('p-save').addEventListener('click', async () => {
    const body = { name: document.getElementById('p-name').value.trim() };
    const pass = document.getElementById('p-pass').value;
    if (pass) body.password = pass;
    try {
      const { user } = await api(`/api/users/${u.id}`, { method: 'PUT', body });
      store.user = { ...store.user, name: user.name };
      document.getElementById('user-name').textContent = user.name;
      toast('Profile updated.');
    } catch (err) { toast(err.message, true); }
  });
  document.getElementById('p-del').addEventListener('click', async () => {
    if (!confirm('Delete your account permanently?')) return;
    try { await api(`/api/users/${u.id}`, { method: 'DELETE' }); store.token = null; store.user = null; location.reload(); }
    catch (err) { toast(err.message, true); }
  });
}

// ---------- Boot ----------
setupAuth();
if (store.token && store.user) {
  api('/api/auth/me').then(enterApp).catch(() => { store.token = null; store.user = null; });
}
