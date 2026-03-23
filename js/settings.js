/**
 * settings.js — Settings/Me screen logic.
 * Only imports from auth.js and db.js.
 */

import { requireAuth, signOut, updatePassword, getInitials } from './auth.js';
import { getUserProfile, updateProfileName } from './db.js';

// ── Auth ───────────────────────────────────────────────────
const user = await requireAuth('/login.html');
if (!user) throw new Error('Not authenticated');

// ── DOM helper ─────────────────────────────────────────────
function $id(id) { return document.getElementById(id); }

function showToast(msg, type = '') {
  const container = $id('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast${type ? ' toast--' + type : ''}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function openModal(id)  { $id(id).classList.add('open'); }
function closeModal(id) { $id(id).classList.remove('open'); }

// Close on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ── Load profile ───────────────────────────────────────────
async function loadProfile() {
  const { profile } = await getUserProfile(user.id);

  const name     = profile?.name     || user.user_metadata?.name     || 'User';
  const email    = profile?.email    || user.email                   || '—';
  const initials = profile?.avatar_initials
    || user.user_metadata?.avatar_initials
    || getInitials(name);

  // Avatar elements
  [$id('profileAvatar'), $id('sidebarAvatar'), $id('headerAvatar')].forEach(el => {
    if (el) el.textContent = initials;
  });

  $id('profileName').textContent  = name;
  $id('profileEmail').textContent = email;
  $id('emailDisplay').textContent = email;
  $id('sidebarName').textContent  = name;
  if ($id('personalNameInput')) $id('personalNameInput').value = name;
}

// ── Toggle states (localStorage) ──────────────────────────
function syncToggles() {
  const pinEnabled       = localStorage.getItem('cue_lock_enabled') === 'true';
  const biometricEnabled = localStorage.getItem('cue_biometric_enabled') === 'true';

  $id('pinToggle').checked       = pinEnabled;
  if ($id('biometricToggle')) $id('biometricToggle').checked = biometricEnabled;
  if ($id('darkModeToggle')) $id('darkModeToggle').checked  = true; // always dark for now
}

// PIN toggle
$id('pinToggle').addEventListener('change', (e) => {
  if (e.target.checked) {
    openModal('setPinModal');
  } else {
    localStorage.setItem('cue_lock_enabled', 'false');
    localStorage.removeItem('cue_pin_hash');
    showToast('App lock disabled');
  }
});

// Biometric toggle
$id('biometricToggle').addEventListener('change', (e) => {
  if (e.target.checked) {
    if (!window.PublicKeyCredential) {
      $id('biometricToggle').checked = false;
      showToast('Biometrics not supported on this browser', 'error');
      return;
    }
    localStorage.setItem('cue_biometric_enabled', 'true');
    showToast('Fingerprint unlock enabled', 'success');
  } else {
    localStorage.setItem('cue_biometric_enabled', 'false');
    localStorage.removeItem('cue_credential_id');
    showToast('Fingerprint unlock disabled');
  }
});

// Dark mode toggle (cosmetic — always dark)
if ($id('darkModeToggle')) {
  $id('darkModeToggle').addEventListener('change', (e) => {
    if (!e.target.checked) {
      e.target.checked = true;
      showToast('Light mode coming soon ✨');
    }
  });
}

// Google link
const isEmailUser = user.app_metadata?.provider === 'email';
if (isEmailUser && $id('googleLinkRow')) {
  $id('googleLinkRow').style.display = 'flex';
  const hasGoogle = user.identities?.some(id => id.provider === 'google');
  if (hasGoogle) {
    $id('googleLinkSub').textContent = 'Connected';
    $id('btnGoogleLink').textContent = 'Disconnect';
  } else {
    $id('googleLinkSub').textContent = 'Not connected';
    $id('btnGoogleLink').textContent = 'Connect';
  }
}

$id('btnGoogleLink')?.addEventListener('click', () => {
  showToast('Account linking UI coming soon');
});

// Name input updater
$id('personalNameInput')?.addEventListener('change', async (e) => {
  const newName = e.target.value.trim();
  const current = $id('profileName').textContent;
  if (newName && newName !== current) {
    const { error } = await updateProfileName(user.id, newName);
    if (!error) {
      const initials = getInitials(newName);
      $id('profileName').textContent = newName;
      [$id('profileAvatar'), $id('sidebarAvatar'), $id('headerAvatar')].forEach(el => {
        if (el) el.textContent = initials;
      });
      showToast('Name updated ✓', 'success');
    }
  } else {
    e.target.value = current;
  }
});

// ── Set PIN modal ──────────────────────────────────────────
$id('btnPinCancel').addEventListener('click', () => {
  closeModal('setPinModal');
  $id('pinToggle').checked = false;
  $id('newPinInput').value = '';
  $id('pinMsg').style.display = 'none';
});

$id('btnPinSave').addEventListener('click', async () => {
  const pin   = $id('newPinInput').value.trim();
  const msgEl = $id('pinMsg');

  if (!/^\d{4}$/.test(pin)) {
    msgEl.style.color   = 'var(--red)';
    msgEl.textContent   = 'Please enter exactly 4 digits.';
    msgEl.style.display = 'block';
    return;
  }

  // Hash the PIN
  const encoder = new TextEncoder();
  const data    = encoder.encode(pin);
  const hash    = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');

  localStorage.setItem('cue_pin_hash', hashHex);
  localStorage.setItem('cue_lock_enabled', 'true');

  closeModal('setPinModal');
  $id('newPinInput').value = '';
  showToast('App lock PIN set ✓', 'success');
});

// ── Change Password modal ──────────────────────────────────
$id('changePasswordRow').addEventListener('click', () => openModal('changePasswordModal'));
$id('btnPwCancel').addEventListener('click', () => closeModal('changePasswordModal'));

$id('btnPwSave').addEventListener('click', async () => {
  const newPw  = $id('newPassword').value;
  const confPw = $id('confirmPassword').value;
  const msgEl  = $id('pwMsg');

  if (!newPw || !confPw) {
    msgEl.style.color   = 'var(--red)';
    msgEl.textContent   = 'Please fill in both fields.';
    msgEl.style.display = 'block';
    return;
  }

  if (newPw !== confPw) {
    msgEl.style.color   = 'var(--red)';
    msgEl.textContent   = 'Passwords do not match.';
    msgEl.style.display = 'block';
    return;
  }

  if (newPw.length < 8) {
    msgEl.style.color   = 'var(--red)';
    msgEl.textContent   = 'Minimum 8 characters.';
    msgEl.style.display = 'block';
    return;
  }

  $id('btnPwSave').disabled    = true;
  $id('btnPwSave').textContent = 'Updating…';

  const { error } = await updatePassword(newPw);

  $id('btnPwSave').disabled    = false;
  $id('btnPwSave').textContent = 'Update';

  if (error) {
    msgEl.style.color   = 'var(--red)';
    msgEl.textContent   = error.message;
    msgEl.style.display = 'block';
    return;
  }

  closeModal('changePasswordModal');
  $id('newPassword').value    = '';
  $id('confirmPassword').value = '';
  showToast('Password updated ✓', 'success');
});

// ── Sign out ───────────────────────────────────────────────
async function handleSignOut() {
  if (!confirm('Sign out of Cue?')) return;
  await signOut(); // redirects inside signOut()
}

$id('signoutRow')?.addEventListener('click', handleSignOut);
$id('logoutFooter')?.addEventListener('click', handleSignOut);

// Editor button focus the input
$id('editAvatarBtn')?.addEventListener('click', () => {
  $id('personalNameInput')?.focus();
});

// ── Init ───────────────────────────────────────────────────
await loadProfile();
syncToggles();
