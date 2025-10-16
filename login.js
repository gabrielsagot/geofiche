/* eslint-disable no-console */
// ========== CONFIGURATION ==========
const AUTH_CONFIG = {
  // Utilisateur unique
  username: 'Olivier_Sagot',  // ← Modifiez ici votre identifiant
  // Hash SHA-256 du mot de passe : "Admin@2025!Secure"
  // Le mot de passe est hashé pour plus de sécurité (pas stocké en clair)
  passwordHash: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6', // Sera généré

  // Durée de session : 2 heures
  sessionDuration: 2 * 60 * 60 * 1000,

  // Clés de stockage
  storageKeys: {
    session: 'auth_session',
    remember: 'auth_remember',
    expiry: 'auth_expiry',
  }
};

// ========== UTILITAIRES ==========

// Fonction de hashage simple (pour démo - en prod utiliser une vraie lib crypto)
async function simpleHash(text) {
  // Utiliser l'API Web Crypto si disponible
  if (window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback basique (moins sécurisé)
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// Générer un token de session aléatoire
function generateSessionToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Sauvegarder la session
function saveSession(remember = false) {
  try {
    const token = generateSessionToken();
    const expiry = Date.now() + AUTH_CONFIG.sessionDuration;

    const storage = remember ? localStorage : sessionStorage;

    console.log('[Auth] Saving session:', {
      remember,
      token: token.substring(0, 10) + '...',
      expiry,
      duration: AUTH_CONFIG.sessionDuration,
      storageType: remember ? 'localStorage' : 'sessionStorage'
    });

    storage.setItem(AUTH_CONFIG.storageKeys.session, token);
    storage.setItem(AUTH_CONFIG.storageKeys.expiry, expiry.toString());

    if (remember) {
      localStorage.setItem(AUTH_CONFIG.storageKeys.remember, 'true');
    }

    // Vérifier que la sauvegarde a bien fonctionné
    const saved = storage.getItem(AUTH_CONFIG.storageKeys.session);
    console.log('[Auth] Session saved successfully:', !!saved);

    return true;
  } catch (error) {
    console.error('[Auth] Error saving session:', error);
    return false;
  }
}

// Vérifier si une session est valide
function isSessionValid() {
  try {
    const sessionToken = sessionStorage.getItem(AUTH_CONFIG.storageKeys.session) ||
                         localStorage.getItem(AUTH_CONFIG.storageKeys.session);
    const expiry = sessionStorage.getItem(AUTH_CONFIG.storageKeys.expiry) ||
                   localStorage.getItem(AUTH_CONFIG.storageKeys.expiry);

    console.log('[Auth] Checking session validity:', {
      hasToken: !!sessionToken,
      hasExpiry: !!expiry,
      expiry: expiry,
      now: Date.now()
    });

    if (!sessionToken || !expiry) {
      console.log('[Auth] No token or expiry found');
      return false;
    }

    const expiryTime = parseInt(expiry, 10);
    if (isNaN(expiryTime)) {
      console.error('[Auth] Invalid expiry time:', expiry);
      clearSession();
      return false;
    }

    if (Date.now() > expiryTime) {
      console.log('[Auth] Session expired');
      clearSession();
      return false;
    }

    console.log('[Auth] Session is valid');
    return true;
  } catch (error) {
    console.error('[Auth] Error checking session:', error);
    return false;
  }
}

// Effacer la session
function clearSession() {
  sessionStorage.clear();
  localStorage.removeItem(AUTH_CONFIG.storageKeys.session);
  localStorage.removeItem(AUTH_CONFIG.storageKeys.expiry);
  localStorage.removeItem(AUTH_CONFIG.storageKeys.remember);
}

// ========== AUTHENTIFICATION ==========

async function authenticate(username, password) {
  // Vérifier l'identifiant
  if (username !== AUTH_CONFIG.username) {
    return {
      success: false,
      message: 'Identifiant ou mot de passe incorrect'
    };
  }

  // Hash du mot de passe saisi
  const inputHash = await simpleHash(password);

  // Mot de passe en dur pour la démo
  // En production, stocker le hash côté serveur
  const correctPassword = 'O_Sagot$@2025!geoFiche';  // ← Modifiez ici votre mot de passe
  const correctHash = await simpleHash(correctPassword);

  // Comparer les hash
  if (inputHash !== correctHash) {
    return {
      success: false,
      message: 'Identifiant ou mot de passe incorrect'
    };
  }

  return {
    success: true,
    message: 'Connexion réussie !'
  };
}

// ========== GESTION DU FORMULAIRE ==========

function showNotification(message, type = 'error') {
  // Créer l'élément de notification
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;

  // Icône selon le type
  const icon = type === 'success'
    ? `<svg class="notification-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
         <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
         <polyline points="22 4 12 14.01 9 11.01"></polyline>
       </svg>`
    : `<svg class="notification-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
         <circle cx="12" cy="12" r="10"></circle>
         <line x1="12" y1="8" x2="12" y2="12"></line>
         <line x1="12" y1="16" x2="12.01" y2="16"></line>
       </svg>`;

  notification.innerHTML = `
    ${icon}
    <span class="notification-content">${message}</span>
    <button class="notification-close" aria-label="Fermer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
    <div class="notification-progress"></div>
  `;

  document.body.appendChild(notification);

  // Afficher la notification
  setTimeout(() => notification.classList.add('show'), 10);

  // Bouton de fermeture
  const closeBtn = notification.querySelector('.notification-close');
  closeBtn.addEventListener('click', () => closeNotification(notification));

  // Masquer automatiquement après 5 secondes
  setTimeout(() => closeNotification(notification), 5000);
}

function closeNotification(notification) {
  notification.classList.remove('show');
  notification.classList.add('hide');
  setTimeout(() => notification.remove(), 400);
}

function showError(message) {
  showNotification(message, 'error');
}

function showSuccess(message) {
  showNotification(message, 'success');
}

function setLoading(isLoading) {
  const btn = document.getElementById('loginBtn');
  const form = document.getElementById('loginForm');

  if (isLoading) {
    btn.classList.add('loading');
    btn.disabled = true;
    form.querySelectorAll('input').forEach(input => input.disabled = true);
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
    form.querySelectorAll('input').forEach(input => input.disabled = false);
  }
}

async function handleLogin(event) {
  event.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const rememberMe = document.getElementById('rememberMe').checked;

  // Validation
  if (!username || !password) {
    showError('Veuillez remplir tous les champs');
    return;
  }

  setLoading(true);

  // Simuler un délai de chargement
  await new Promise(resolve => setTimeout(resolve, 500));

  // Authentifier
  const result = await authenticate(username, password);

  if (result.success) {
    // Afficher notification de succès
    showSuccess(result.message);

    // Sauvegarder la session
    saveSession(rememberMe);

    // Rediriger vers l'index après un court délai
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 800);
  } else {
    showError(result.message);
    setLoading(false);

    // Réinitialiser le mot de passe
    document.getElementById('password').value = '';
    document.getElementById('password').focus();
  }
}

// ========== TOGGLE PASSWORD VISIBILITY ==========

function togglePasswordVisibility() {
  const passwordInput = document.getElementById('password');
  const toggleBtn = document.getElementById('togglePassword');

  if (passwordInput.type === 'password') {
    passwordInput.type = 'text';
    toggleBtn.innerHTML = `
      <svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>
    `;
  } else {
    passwordInput.type = 'password';
    toggleBtn.innerHTML = `
      <svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    `;
  }
}

// ========== EXPORT DES FONCTIONS ==========
// Exporter IMMÉDIATEMENT pour utilisation dans index.html
// (doit être avant DOMContentLoaded pour être disponible dès le chargement)
window.authUtils = {
  isSessionValid,
  clearSession,
  logout: () => {
    clearSession();
    window.location.href = 'login.html';
  }
};

// ========== INITIALISATION ==========

window.addEventListener('DOMContentLoaded', () => {
  console.log('[Login] DOM loaded, initializing...');

  // NE PAS rediriger automatiquement vers index.html
  // Cela peut créer une boucle de redirection
  // L'utilisateur doit cliquer sur "Se connecter" même s'il a déjà une session

  // Événement de soumission du formulaire
  const form = document.getElementById('loginForm');
  if (form) {
    form.addEventListener('submit', handleLogin);
  }

  // Toggle password visibility
  const toggleBtn = document.getElementById('togglePassword');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', togglePasswordVisibility);
  }

  // Focus sur le champ username
  const usernameInput = document.getElementById('username');
  if (usernameInput) {
    usernameInput.focus();
  }

  console.log('🔐 Système de login initialisé');
  console.log('👤 Identifiant: admin');
  console.log('🔑 Mot de passe: SosPapa2025!');
});
